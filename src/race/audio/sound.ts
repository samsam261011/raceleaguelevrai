import type { CarState } from "../physics/car";
import { VMAX } from "../physics/constants";

/**
 * Tous les sons de la course, fabriqués par le code avec la Web Audio API (aucun fichier à charger) :
 * moteur, crissement des pneus, chocs contre les parapets, réceptions de saut, checkpoints, arrivée, chute.
 * Le son ne lit que l'état de la voiture : il ne change jamais la physique.
 */

const VOLUME_KEY = "raceleague.volume";

/** Rapports de boîte (vitesse en m/s où chaque rapport se termine) : le régime monte puis retombe au passage du rapport. */
const GEARS = [9, 18, 29, 41, 55, VMAX + 10];
const RPM_IDLE = 0.18;

export function loadVolume(): number {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    const n = v === null ? 0.7 : Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.7;
  } catch {
    return 0.7;
  }
}

export function saveVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    /* stockage indisponible */
  }
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

export class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  // Moteur : deux oscillateurs (grave et harmonique) dans un filtre passe-bas
  private engA: OscillatorNode | null = null;
  private engB: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private engGain: GainNode | null = null;
  // Pneus : bruit filtré en bande étroite
  private tyreFilter: BiquadFilterNode | null = null;
  private tyreGain: GainNode | null = null;
  // Frottement contre un parapet
  private scrapeGain: GainNode | null = null;
  private rpm = RPM_IDLE;
  private gear = 0;
  private volume = loadVolume();
  private running = false;

  get level(): number {
    return this.volume;
  }

  /** Le navigateur n'autorise le son qu'après un geste du joueur : on démarre au premier appui. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.noise = noiseBuffer(ctx, 2);
    const master = ctx.createGain();
    master.gain.value = this.volume * this.volume;
    // Un compresseur évite que les chocs saturent
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    const engFilter = ctx.createBiquadFilter();
    engFilter.type = "lowpass";
    engFilter.Q.value = 2;
    const engGain = ctx.createGain();
    engGain.gain.value = 0;
    const a = ctx.createOscillator();
    a.type = "sawtooth";
    const b = ctx.createOscillator();
    b.type = "square";
    const bGain = ctx.createGain();
    bGain.gain.value = 0.35;
    a.connect(engFilter);
    b.connect(bGain).connect(engFilter);
    engFilter.connect(engGain).connect(master);
    a.start();
    b.start();
    this.engA = a;
    this.engB = b;
    this.engFilter = engFilter;
    this.engGain = engGain;

    const tyreSrc = ctx.createBufferSource();
    tyreSrc.buffer = this.noise;
    tyreSrc.loop = true;
    const tyreFilter = ctx.createBiquadFilter();
    tyreFilter.type = "bandpass";
    tyreFilter.frequency.value = 1300;
    tyreFilter.Q.value = 9;
    const tyreGain = ctx.createGain();
    tyreGain.gain.value = 0;
    tyreSrc.connect(tyreFilter).connect(tyreGain).connect(master);
    tyreSrc.start();
    this.tyreFilter = tyreFilter;
    this.tyreGain = tyreGain;

    const scrapeSrc = ctx.createBufferSource();
    scrapeSrc.buffer = this.noise;
    scrapeSrc.loop = true;
    scrapeSrc.playbackRate.value = 0.7;
    const scrapeFilter = ctx.createBiquadFilter();
    scrapeFilter.type = "highpass";
    scrapeFilter.frequency.value = 2200;
    const scrapeGain = ctx.createGain();
    scrapeGain.gain.value = 0;
    scrapeSrc.connect(scrapeFilter).connect(scrapeGain).connect(master);
    scrapeSrc.start();
    this.scrapeGain = scrapeGain;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    saveVolume(this.volume);
    // Courbe au carré : le curseur paraît linéaire à l'oreille
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume * this.volume, this.ctx.currentTime, 0.02);
  }

  /** Course en cours ou non : à l'arrêt sur la ligne, le moteur tourne au ralenti ; en pause, tout se tait. */
  setRunning(on: boolean): void {
    this.running = on;
  }

  /** Mise à jour continue, à chaque image, d'après l'état affiché de la voiture. */
  update(car: CarState, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engA || !this.engB || !this.engFilter || !this.engGain || !this.tyreGain || !this.tyreFilter || !this.scrapeGain) return;
    const t = ctx.currentTime;
    const speed = Math.abs(car.speed);
    const on = active && !car.fell;

    // Régime : vitesse dans le rapport engagé ; en l'air ou en glisse sous les gaz, les roues patinent et le régime monte
    while (this.gear < GEARS.length - 1 && speed > GEARS[this.gear]!) this.gear++;
    while (this.gear > 0 && speed < GEARS[this.gear - 1]! * 0.85) this.gear--;
    const lo = this.gear === 0 ? 0 : GEARS[this.gear - 1]! * 0.85;
    const hi = GEARS[this.gear]!;
    let target = RPM_IDLE + (1 - RPM_IDLE) * Math.min(1, Math.max(0, (speed - lo) / (hi - lo)));
    if (car.throttle > 0.1 && !car.grounded) target = Math.min(1, target + 0.25 * car.throttle);
    this.rpm += (target - this.rpm) * 0.25;
    const freq = 42 + this.rpm * 150;
    this.engA.frequency.setTargetAtTime(freq, t, 0.03);
    this.engB.frequency.setTargetAtTime(freq * 2.02, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(380 + this.rpm * 1400 + car.throttle * 900, t, 0.05);
    const engVol = on ? 0.07 + 0.11 * car.throttle + 0.05 * this.rpm : 0;
    this.engGain.gain.setTargetAtTime(engVol, t, 0.06);

    // Pneus : ils crissent quand la voiture glisse sur le côté, ou au freinage appuyé
    let squeal = 0;
    if (car.grounded) {
      squeal = Math.min(1, Math.max(0, (Math.abs(car.slide) - 2.5) / 7));
      if (car.braking && car.speed > 8) squeal = Math.max(squeal, 0.55);
    }
    this.tyreGain.gain.setTargetAtTime(on ? squeal * 0.16 : 0, t, 0.05);
    this.tyreFilter.frequency.setTargetAtTime(1100 + Math.min(1, speed / VMAX) * 700, t, 0.1);

    // Parapet : frottement tant qu'on touche, coup sec au choc
    this.scrapeGain.gain.setTargetAtTime(on && car.onWall ? Math.min(0.12, 0.02 + speed * 0.002) : 0, t, 0.04);
    if (!this.running) this.gear = 0;
  }

  /** Événements d'un pas de simulation (appelé à chaque pas, pour n'en rater aucun). */
  events(car: CarState): void {
    if (!this.ctx || !this.master) return;
    if (car.impact > 1.5) this.thump(Math.min(1, car.impact / 18), 70, 0.25, 900);
    if (car.landing > 3) this.thump(Math.min(1, (car.landing - 3) / 12), 55, 0.22, 300);
  }

  /** Coup sourd (choc, réception) : bruit filtré + note grave qui retombe. */
  private thump(strength: number, pitch: number, len: number, bright: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = bright;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5, len + 0.05);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(pitch * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.6, t + len);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.6 * strength, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(og).connect(this.master!);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** Petite mélodie : une note par entrée [fréquence, début (s), durée (s)]. */
  private notes(list: [number, number, number][], type: OscillatorType, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    for (const [f, at, len] of list) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(vol, t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + at + len);
      o.connect(g).connect(this.master);
      o.start(t0 + at);
      o.stop(t0 + at + len + 0.05);
    }
  }

  /** Checkpoint : deux notes claires, plus aiguës si on est en avance sur son record. */
  checkpoint(ahead: boolean | null): void {
    const base = ahead === false ? 660 : 880;
    this.notes(
      [
        [base, 0, 0.18],
        [base * 1.5, 0.08, 0.3],
      ],
      "triangle",
      0.16,
    );
  }

  finish(record: boolean): void {
    const n: [number, number, number][] = record
      ? [
          [523, 0, 0.2],
          [659, 0.1, 0.2],
          [784, 0.2, 0.2],
          [1047, 0.3, 0.6],
        ]
      : [
          [523, 0, 0.2],
          [784, 0.12, 0.45],
        ];
    this.notes(n, "triangle", 0.18);
  }

  fall(): void {
    this.notes(
      [
        [392, 0, 0.18],
        [294, 0.12, 0.35],
      ],
      "sine",
      0.15,
    );
  }

  /** Le départ : le chrono part. */
  start(): void {
    this.notes([[1175, 0, 0.12]], "triangle", 0.1);
  }
}
