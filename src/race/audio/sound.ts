import type { CarState } from "../physics/car";
import { VMAX } from "../physics/constants";
import { engineLoop, rollLoop, squealLoop } from "./samples";

/**
 * Tous les sons de la course, fabriqués par le code avec la Web Audio API (aucun fichier à charger) :
 * moteur (une boucle jouée plus ou moins vite, sans rapports), roulement et crissement des pneus roue par roue, chocs contre les parapets, réceptions de saut, checkpoints, arrivée, chute.
 * Le son ne lit que l'état de la voiture : il ne change jamais la physique.
 */

const VOLUME_KEY = "raceleague.volume";


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

interface Loop {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  // Moteur : une boucle jouée plus ou moins vite, dans un filtre qui s'ouvre quand on accélère
  private engine: Loop | null = null;
  private engFilter: BiquadFilterNode | null = null;
  // Une boucle de roulement et une de crissement par roue, placées à gauche ou à droite
  private roll: Loop[] = [];
  private squeal: Loop[] = [];
  // Frottement contre un parapet
  private scrapeGain: GainNode | null = null;
  private rate = 0.6;
  private volume = loadVolume();
  private running = false;

  get level(): number {
    return this.volume;
  }

  private loop(buffer: AudioBuffer, dest: AudioNode, rate: number, offset: number): Loop {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(dest);
    src.start(0, offset);
    return { src, gain };
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
    engFilter.Q.value = 0.8;
    engFilter.frequency.value = 1200;
    engFilter.connect(master);
    this.engFilter = engFilter;
    this.engine = this.loop(engineLoop(ctx), engFilter, this.rate, 0);

    // Roues : 0 avant gauche, 1 avant droite, 2 arrière gauche, 3 arrière droite (comme la physique)
    const roll = rollLoop(ctx);
    const squeal = squealLoop(ctx);
    for (let i = 0; i < 4; i++) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = i % 2 === 0 ? -0.45 : 0.45;
      pan.connect(master);
      // Départs décalés dans la boucle : les quatre roues ne sonnent jamais exactement pareil
      this.roll.push(this.loop(roll, pan, 0.6, (i / 4) * 2.2));
      this.squeal.push(this.loop(squeal, pan, 1, (i / 4) * 1.7));
    }

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

  /** Course en cours ou non : à l'arrêt sur la ligne, le moteur tourne au ralenti. */
  setRunning(on: boolean): void {
    this.running = on;
  }

  /** Mise à jour continue, à chaque image, d'après l'état affiché de la voiture. */
  update(car: CarState, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine || !this.engFilter || !this.scrapeGain) return;
    const t = ctx.currentTime;
    const speed = Math.abs(car.speed);
    const on = active && !car.fell;
    const gas = this.running && car.throttle > 0.05;

    // Moteur : une seule courbe douce, sans rapports. La hauteur monte avec la vitesse (racine : vite au début,
    // puis de moins en moins). Gaz relâchés, elle redescend vers le grave ; en l'air sous les gaz, elle s'emballe un peu.
    const v = Math.min(1.2, speed / VMAX);
    let rate = 0.6 + 0.85 * Math.sqrt(v);
    if (!gas) rate = Math.max(0.6, rate * 0.82);
    else if (!car.grounded) rate *= 1.1;
    this.rate = rate;
    this.engine.src.playbackRate.setTargetAtTime(rate, t, 0.08);
    // Sous les gaz le son est plus fort et plus brillant (le moteur force)
    this.engFilter.frequency.setTargetAtTime(gas ? 1400 + 2600 * v : 700 + 900 * v, t, 0.12);
    this.engine.gain.gain.setTargetAtTime(on ? (gas ? 0.2 + 0.08 * v : 0.12 + 0.04 * v) : 0, t, 0.08);

    // Pneus, roue par roue : roulement selon la vitesse, crissement quand la roue glisse
    const slide = Math.abs(car.slide);
    const hardBrake = car.braking && car.speed > 8;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i]!;
      const rear = i >= 2;
      const touching = on && w.contact;
      this.roll[i]!.gain.gain.setTargetAtTime(touching ? Math.min(0.1, 0.012 + speed * 0.0013) : 0, t, 0.15);
      this.roll[i]!.src.playbackRate.setTargetAtTime(0.5 + Math.min(0.7, speed / 80), t, 0.15);
      // L'arrière décroche en premier ; l'avant crisse aussi dans les grosses glisses ; les quatre au freinage appuyé
      const skid = hardBrake ? 0.7 : Math.min(1, Math.max(0, (slide - (rear ? 2.5 : 5)) / 3));
      this.squeal[i]!.gain.gain.setTargetAtTime(touching ? skid * 0.05 : 0, t, 0.08);
      this.squeal[i]!.src.playbackRate.setTargetAtTime(0.92 + Math.min(0.16, speed / 400) + (i % 2) * 0.03, t, 0.2);
    }

    // Parapet : frottement tant qu'on touche
    this.scrapeGain.gain.setTargetAtTime(on && car.onWall ? Math.min(0.12, 0.02 + speed * 0.002) : 0, t, 0.04);
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
