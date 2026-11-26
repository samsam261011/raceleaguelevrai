/**
 * Boucles sonores fabriquées par le code au démarrage (aucun fichier) : on les joue ensuite en boucle,
 * en changeant leur vitesse de lecture, comme on le ferait avec un enregistrement.
 * Chaque boucle est raccordée par un fondu entre sa fin et son début : pas de clic au bouclage.
 */

/** Tirage pseudo-aléatoire répétable : les mêmes boucles à chaque partie. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Rend une boucle sans couture : on fabrique `len + fade` échantillons et on fond la fin dans le début. */
function seamless(ctx: BaseAudioContext, len: number, fade: number, fill: (out: Float32Array) => void): AudioBuffer {
  const raw = new Float32Array(len + fade);
  fill(raw);
  // Normalisation douce
  let peak = 0;
  for (const v of raw) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.9 / peak : 1;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i]! * k;
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[i] = (raw[i]! * a + raw[len + i]! * (1 - a)) * k;
  }
  return buf;
}

/**
 * Moteur : une suite d'explosions (4 cylindres, chacun un peu différent), chacune fait résonner
 * l'échappement et la caisse (quelques résonances qui s'éteignent vite), plus un souffle d'admission.
 * À vitesse de lecture 1, 50 explosions par seconde.
 */
export function engineLoop(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const f0 = 50;
  const seconds = 2;
  const len = Math.round(sr * seconds);
  const fade = Math.round(sr * 0.05);
  const r = rng(7);
  const modes = [
    { f: 92, tau: 0.02, a: 1 },
    { f: 185, tau: 0.011, a: 0.55 },
    { f: 470, tau: 0.005, a: 0.32 },
    { f: 1150, tau: 0.0025, a: 0.14 },
  ];
  const cyl = [1, 0.82, 0.93, 0.78];
  return seamless(ctx, len, fade, (out) => {
    const total = out.length;
    const pulses = Math.ceil((total / sr) * f0) + 1;
    const ring = Math.round(sr * 0.06);
    for (let k = 0; k < pulses; k++) {
      const t0 = Math.round(((k + (r() - 0.5) * 0.06) / f0) * sr);
      const amp = cyl[k % 4]! * (0.85 + r() * 0.3);
      for (let j = 0; j < ring; j++) {
        const i = t0 + j;
        if (i < 0 || i >= total) continue;
        const t = j / sr;
        let v = 0;
        for (const m of modes) v += m.a * Math.exp(-t / m.tau) * Math.sin(2 * Math.PI * m.f * t);
        // Claquement de l'explosion : un peu de bruit au tout début
        v += 0.25 * Math.exp(-t / 0.002) * (r() * 2 - 1);
        out[i]! += amp * v;
      }
    }
    // Souffle d'admission, grave
    let lp = 0;
    for (let i = 0; i < total; i++) {
      lp += ((r() * 2 - 1) - lp) * 0.05;
      out[i]! += lp * 0.22;
    }
    // Un peu de saturation (le grain d'un échappement), puis on retire la composante continue
    let mean = 0;
    for (let i = 0; i < total; i++) {
      out[i] = Math.tanh(out[i]! * 1.4);
      mean += out[i]!;
    }
    mean /= total;
    for (let i = 0; i < total; i++) out[i]! -= mean;
  });
}

/** Roulement des pneus sur l'asphalte : un grondement sourd et granuleux. */
export function rollLoop(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * 2.5);
  const fade = Math.round(sr * 0.1);
  const r = rng(21);
  return seamless(ctx, len, fade, (out) => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      const w = r() * 2 - 1;
      a += (w - a) * 0.08;
      b += (a - b) * 0.08;
      // Grain de la route : de petits chocs au hasard
      const grit = r() < 0.004 ? (r() - 0.5) * 2 : 0;
      out[i] = b * 3 + a * 0.6 + grit * 0.3;
    }
  });
}

/**
 * Crissement : la gomme qui frotte, un son aigu qui ondule (sa hauteur varie lentement et un peu au hasard),
 * avec ses harmoniques et un léger souffle.
 */
export function squealLoop(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * 2);
  const fade = Math.round(sr * 0.15);
  const r = rng(33);
  return seamless(ctx, len, fade, (out) => {
    let phase = 0;
    let wob = 0;
    let wobT = 0;
    let n = 0;
    for (let i = 0; i < out.length; i++) {
      // La hauteur dérive au hasard autour de 900 Hz
      if (i % 600 === 0) wobT = (r() - 0.5) * 2;
      wob += (wobT - wob) * 0.0015;
      const f = 900 * (1 + 0.06 * wob + 0.015 * Math.sin((2 * Math.PI * 7 * i) / sr));
      phase += (2 * Math.PI * f) / sr;
      // Le frottement « broute » : petites variations rapides de l'intensité
      const chatter = 0.75 + 0.25 * Math.sin((2 * Math.PI * 31 * i) / sr + Math.sin((2 * Math.PI * 3 * i) / sr));
      n += ((r() * 2 - 1) - n) * 0.35;
      out[i] = chatter * (Math.sin(phase) + 0.45 * Math.sin(2 * phase + 0.4) + 0.2 * Math.sin(3 * phase + 1.1)) + n * 0.25;
    }
  });
}
