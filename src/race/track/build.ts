import type { MapDefinition, Track } from "./types";

export const SUBDIV = 32;
const DEFAULT_WIDTH = 22;

/** Catmull-Rom uniforme sur une composante. */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Transforme les points de contrôle d'une map en une piste échantillonnée finement.
 * Uniquement de l'arithmétique simple et Math.sqrt : le résultat est identique sur toutes les machines.
 */
export function buildTrack(def: MapDefinition): Track {
  const pts = def.points;
  const n = pts.length;
  if (n < 2) throw new Error(`La map ${def.id} doit avoir au moins 2 points`);
  const get = (i: number) => pts[Math.max(0, Math.min(n - 1, i))]!;

  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const ws: number[] = [];
  const solids: number[] = [];

  for (let s = 0; s < n - 1; s++) {
    const p0 = get(s - 1);
    const p1 = get(s);
    const p2 = get(s + 1);
    const p3 = get(s + 2);
    const w1 = p1.width ?? DEFAULT_WIDTH;
    const w2 = p2.width ?? DEFAULT_WIDTH;
    for (let k = 0; k < SUBDIV; k++) {
      const t = k / SUBDIV;
      xs.push(cr(p0.x, p1.x, p2.x, p3.x, t));
      ys.push(cr(p0.y, p1.y, p2.y, p3.y, t));
      zs.push(cr(p0.z, p1.z, p2.z, p3.z, t));
      ws.push(w1 + (w2 - w1) * t);
      solids.push(p1.gap ? 0 : 1);
    }
  }
  const last = pts[n - 1]!;
  xs.push(last.x);
  ys.push(last.y);
  zs.push(last.z);
  ws.push(last.width ?? DEFAULT_WIDTH);
  solids.push(1);

  const count = xs.length;
  const track: Track = {
    def,
    count,
    px: Float64Array.from(xs),
    py: Float64Array.from(ys),
    pz: Float64Array.from(zs),
    tx: new Float64Array(count),
    tz: new Float64Array(count),
    dist: new Float64Array(count),
    width: Float64Array.from(ws),
    solid: Uint8Array.from(solids),
    length: 0,
    checkpointDist: [],
    minY: Infinity,
  };

  let d = 0;
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(count - 1, i + 1);
    const dx = track.px[b]! - track.px[a]!;
    const dz = track.pz[b]! - track.pz[a]!;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    track.tx[i] = dx / len;
    track.tz[i] = dz / len;
    if (i > 0) {
      const sx = track.px[i]! - track.px[i - 1]!;
      const sz = track.pz[i]! - track.pz[i - 1]!;
      d += Math.sqrt(sx * sx + sz * sz);
    }
    track.dist[i] = d;
    if (track.py[i]! < track.minY) track.minY = track.py[i]!;
  }
  track.length = d;
  track.checkpointDist = def.checkpoints.map((f) => f * d);
  return track;
}

export interface TrackHit {
  /** Indice du point de piste juste avant la projection. */
  index: number;
  /** Distance parcourue le long de la piste. */
  along: number;
  /** Décalage latéral par rapport au centre (positif = à droite). */
  lateral: number;
  /** Hauteur du sol à cet endroit. */
  groundY: number;
  /** La voiture est au-dessus d'une partie solide de la piste. */
  onSurface: boolean;
  /** Le tronçon le plus proche a un sol (pas un trou). */
  solid: boolean;
  /** Demi-largeur de la piste à cet endroit. */
  halfWidth: number;
}

/**
 * Cherche le point de piste le plus proche autour de l'indice `hint`.
 * La recherche reste locale : une piste qui passe au-dessus d'elle-même ne pose pas de problème.
 */
export function queryTrack(track: Track, x: number, z: number, y: number, hint: number): TrackHit {
  const from = Math.max(0, hint - 24);
  const to = Math.min(track.count - 2, hint + 48);
  let best = -1;
  let bestScore = Infinity;
  let bestT = 0;
  for (let i = from; i <= to; i++) {
    const ax = track.px[i]!;
    const az = track.pz[i]!;
    const bx = track.px[i + 1]!;
    const bz = track.pz[i + 1]!;
    const sx = bx - ax;
    const sz = bz - az;
    const l2 = sx * sx + sz * sz;
    let t = l2 > 0 ? ((x - ax) * sx + (z - az) * sz) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + sx * t - x;
    const cz = az + sz * t - z;
    const cy = track.py[i]! + (track.py[i + 1]! - track.py[i]!) * t - y;
    // On favorise le tronçon à la bonne hauteur (piste qui se croise).
    const score = cx * cx + cz * cz + cy * cy * 0.25;
    if (score < bestScore) {
      bestScore = score;
      best = i;
      bestT = t;
    }
  }
  const i = best;
  const t = bestT;
  const cxp = track.px[i]! + (track.px[i + 1]! - track.px[i]!) * t;
  const czp = track.pz[i]! + (track.pz[i + 1]! - track.pz[i]!) * t;
  const tx = track.tx[i]!;
  const tz = track.tz[i]!;
  // Droite de la piste (vue de derrière) : (-tz, tx)
  const lateral = (x - cxp) * -tz + (z - czp) * tx;
  const w = track.width[i]! + (track.width[i + 1]! - track.width[i]!) * t;
  const groundY = track.py[i]! + (track.py[i + 1]! - track.py[i]!) * t;
  const along = track.dist[i]! + (track.dist[i + 1]! - track.dist[i]!) * t;
  const solid = track.solid[i] === 1;
  const onSurface = solid && Math.abs(lateral) <= w / 2;
  return { index: i, along, lateral, groundY, onSurface, solid, halfWidth: w / 2 };
}
