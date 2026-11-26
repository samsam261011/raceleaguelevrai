import { pathFrames } from "./frames";
import { HALF, halfWidth, PIECES, rotSide, rotXZ, SIDE_DIR, STEP, TILE, W, E, type PathPoint, type PieceDef, type PieceKind } from "./pieces";

/** Une pièce posée : type, case, hauteur (en crans de 2 m), quarts de tour. */
export interface Block {
  kind: PieceKind;
  x: number;
  z: number;
  level: number;
  rot: number;
}

export interface Medals {
  auteur: number;
  or: number;
  argent: number;
  bronze: number;
}

/** Une map : une liste de pièces posées. */
export interface MapDefinition {
  id: string;
  name: string;
  blocks: Block[];
  medals: Medals;
}

/** Une pièce prête pour la physique : sa ligne centrale en coordonnées du monde. */
export interface CompiledBlock {
  index: number;
  def: PieceDef;
  block: Block;
  /** Points de la ligne centrale. */
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  /** Distance cumulée au début de chaque point. */
  cum: Float64Array;
  /** Repère en chaque point : droite de la route (mise à l'échelle dans les coudes) et haut de la surface. */
  rx: Float64Array;
  ry: Float64Array;
  rz: Float64Array;
  ux: Float64Array;
  uy: Float64Array;
  uz: Float64Array;
  /** Direction (au sol) et pente de chaque segment (nulles pour un segment vertical). */
  tx: Float64Array;
  tz: Float64Array;
  slope: Float64Array;
  segLen: Float64Array;
  /** Demi-largeur de la chaussée en chaque point (10 m, 20 m pour une double voie). */
  hw: Float64Array;
  length: number;
  /** Rebords après fusion avec les voisins (deux routes côte à côte n'ont pas de rebord entre elles). */
  borderPos: boolean;
  borderNeg: boolean;
  cells: [number, number][];
}

export interface Gate {
  block: number;
  kind: "start" | "finish" | "checkpoint";
  x: number;
  y: number;
  z: number;
  /** Direction de passage. */
  dx: number;
  dz: number;
  /** Demi-largeur du passage. */
  half: number;
}

export interface World {
  def: MapDefinition;
  blocks: CompiledBlock[];
  /** Pièces présentes dans chaque case ("x,z"). */
  cells: Map<string, number[]>;
  gates: Gate[];
  checkpointCount: number;
  spawn: { x: number; y: number; z: number; heading: number };
  /** Sol (herbe) : la voiture qui le touche est sortie. */
  groundY: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
}

export const GROUND_Y = -1;
const EDGE_EPS = 0.06;

export const cellKey = (x: number, z: number) => `${x},${z}`;

export function blockCells(b: Block): [number, number][] {
  return PIECES[b.kind].cells.map(([cx, cz]) => {
    const [rx, rz] = rotXZ(cx, cz, b.rot);
    return [b.x + rx, b.z + rz];
  });
}

/** Ligne centrale d'une pièce en coordonnées du monde (avec le haut de la surface, tourné lui aussi). */
export function blockPath(b: Block): PathPoint[] {
  return PIECES[b.kind].path.map((p) => {
    const [rx, rz] = rotXZ(p.x, p.z, b.rot);
    const q: PathPoint = { x: b.x * TILE + rx, y: b.level * STEP + p.y, z: b.z * TILE + rz };
    if (p.uy !== undefined) {
      const [ux, uz] = rotXZ(p.ux ?? 0, p.uz ?? 0, b.rot);
      q.ux = ux;
      q.uy = p.uy;
      q.uz = uz;
    }
    return q;
  });
}

/** Deux pièces à la même hauteur qui se partagent une case se remplacent dans l'éditeur. */
export function blocksOverlap(a: Block, b: Block): boolean {
  if (a.level !== b.level) return false;
  const cb = blockCells(b);
  return blockCells(a).some(([x, z]) => cb.some(([x2, z2]) => x === x2 && z === z2));
}

/** Prépare une map pour la physique et l'affichage. Uniquement + - * / et Math.sqrt : identique partout. */
export function buildWorld(def: MapDefinition): World {
  const cells = new Map<string, number[]>();
  const levelAt = new Map<string, number[]>();
  def.blocks.forEach((b, i) => {
    for (const [x, z] of blockCells(b)) {
      const k = cellKey(x, z);
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
      (levelAt.get(k) ?? levelAt.set(k, []).get(k)!).push(b.level);
    }
  });

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
  const blocks: CompiledBlock[] = def.blocks.map((b, index) => {
    const d = PIECES[b.kind];
    const pts = blockPath(b);
    const n = pts.length;
    const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n), cum = new Float64Array(n);
    const tx = new Float64Array(n - 1), tz = new Float64Array(n - 1), slope = new Float64Array(n - 1), segLen = new Float64Array(n - 1);
    const fr = pathFrames(pts);
    const rx = Float64Array.from(fr, (f) => f.rx), ry = Float64Array.from(fr, (f) => f.ry), rz = Float64Array.from(fr, (f) => f.rz);
    const ux = Float64Array.from(fr, (f) => f.ux), uy = Float64Array.from(fr, (f) => f.uy), uz = Float64Array.from(fr, (f) => f.uz);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      px[i] = pts[i]!.x;
      py[i] = pts[i]!.y;
      pz[i] = pts[i]!.z;
      maxY = Math.max(maxY, pts[i]!.y);
      if (i > 0) {
        const dx = px[i]! - px[i - 1]!;
        const dz = pz[i]! - pz[i - 1]!;
        const dy = py[i]! - py[i - 1]!;
        const L = Math.sqrt(dx * dx + dz * dz);
        segLen[i - 1] = L;
        tx[i - 1] = L > 1e-9 ? dx / L : 0;
        tz[i - 1] = L > 1e-9 ? dz / L : 0;
        slope[i - 1] = L > 1e-9 ? dy / L : 0;
        // Longueur réelle (un looping monte et redescend)
        acc += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      cum[i] = acc;
    }
    const hw = new Float64Array(n);
    for (let i = 0; i < n; i++) hw[i] = halfWidth(d, acc > 0 ? cum[i]! / acc : 0);
    // Rebords des pièces droites : supprimés si une autre pièce est collée de ce côté, à la même hauteur
    let borderPos = d.borders.pos;
    let borderNeg = d.borders.neg;
    if (d.cells.length === 1 && !d.plate && (borderPos || borderNeg)) {
      const neighbourHere = (side: number) => {
        const s = rotSide(side as 0, b.rot);
        const [dx, dz] = SIDE_DIR[s]!;
        return (levelAt.get(cellKey(b.x + dx, b.z + dz)) ?? []).includes(b.level);
      };
      // Pour une pièce droite, le côté « + » est à l'ouest (W) dans son repère, le côté « - » à l'est (E)
      if (borderPos && neighbourHere(W)) borderPos = false;
      if (borderNeg && neighbourHere(E)) borderNeg = false;
    }
    const bc = blockCells(b);
    for (const [x, z] of bc) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return { index, def: d, block: b, px, py, pz, cum, rx, ry, rz, ux, uy, uz, tx, tz, slope, segLen, hw, length: acc, borderPos, borderNeg, cells: bc };
  });

  const gates: Gate[] = [];
  for (const cb of blocks) {
    if (!cb.def.gate) continue;
    // Le portique est au milieu de la pièce (droite) : entre ses deux bouts
    const [fx, fz] = rotXZ(0, 1, cb.block.rot);
    const m = cb.px.length - 1;
    gates.push({
      block: cb.index,
      kind: cb.def.gate,
      x: (cb.px[0]! + cb.px[m]!) / 2,
      y: cb.block.level * STEP,
      z: (cb.pz[0]! + cb.pz[m]!) / 2,
      dx: fx,
      dz: fz,
      half: cb.hw[0]!,
    });
  }

  const start = gates.find((g) => g.kind === "start");
  const spawn = start
    ? { x: start.x - start.dx * 5, y: start.y, z: start.z - start.dz * 5, heading: headingOfDir(start.dx, start.dz) }
    : { x: 0, y: 0, z: 0, heading: 0 };

  if (!isFinite(minX)) minX = maxX = minZ = maxZ = 0;
  return {
    def,
    blocks,
    cells,
    gates,
    checkpointCount: gates.filter((g) => g.kind === "checkpoint").length,
    spawn,
    groundY: GROUND_Y,
    bounds: { minX: minX * TILE - HALF, maxX: maxX * TILE + HALF, minZ: minZ * TILE - HALF, maxZ: maxZ * TILE + HALF, maxY },
  };
}

/** Cap exact pour les 4 directions de la grille (cap 0 = +z, π/2 = +x). */
function headingOfDir(dx: number, dz: number): number {
  if (dz > 0.5) return 0;
  if (dx > 0.5) return Math.PI / 2;
  if (dz < -0.5) return Math.PI;
  return -Math.PI / 2;
}

export interface SurfaceHit {
  block: CompiledBlock;
  groundY: number;
  /** Écart à la ligne centrale (+ = à droite en suivant le tracé). */
  lateral: number;
  /** Direction du tracé et pente à cet endroit. */
  tx: number;
  tz: number;
  slope: number;
}

/** Position (x, z) sur une pièce : dedans ou pas, hauteur du sol, écart au centre. */
export function onBlock(cb: CompiledBlock, x: number, z: number): SurfaceHit | null {
  // Une surface penchée ou enroulée n'a pas une seule hauteur par point vu de dessus
  if (cb.def.twisted) return null;
  const n = cb.px.length;
  let best = -1;
  let bestD = Infinity;
  let bestT = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = cb.px[i]!;
    const az = cb.pz[i]!;
    const L = cb.segLen[i]!;
    let t = ((x - ax) * cb.tx[i]! + (z - az) * cb.tz[i]!) / L;
    const raw = t;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + cb.tx[i]! * L * t;
    const cz = az + cb.tz[i]! * L * t;
    const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (d < bestD) {
      bestD = d;
      best = i;
      bestT = raw;
    }
  }
  if (best < 0) return null;
  const L = cb.segLen[best]!;
  if (best === 0 && bestT * L < -EDGE_EPS) return null;
  if (best === n - 2 && (bestT - 1) * L > EDGE_EPS) return null;
  const t = bestT < 0 ? 0 : bestT > 1 ? 1 : bestT;
  const tx = cb.tx[best]!;
  const tz = cb.tz[best]!;
  const lateral = (x - cb.px[best]!) * -tz + (z - cb.pz[best]!) * tx;
  const half = cb.hw[best]! + (cb.hw[best + 1]! - cb.hw[best]!) * t;
  if (lateral > half || lateral < -half) return null;
  const groundY = cb.py[best]! + (cb.py[best + 1]! - cb.py[best]!) * t;
  return { block: cb, groundY, lateral, tx, tz, slope: cb.slope[best]! };
}

/** Le sol sous la voiture : la surface la plus haute qui n'est pas au-dessus d'elle (tolérance `up`). */
export function groundAt(world: World, x: number, z: number, y: number, up = 1): SurfaceHit | null {
  const cx = Math.round(x / TILE);
  const cz = Math.round(z / TILE);
  const list = world.cells.get(cellKey(cx, cz));
  if (!list) return null;
  let best: SurfaceHit | null = null;
  for (const i of list) {
    const h = onBlock(world.blocks[i]!, x, z);
    if (!h || h.groundY > y + up) continue;
    if (!best || h.groundY > best.groundY) best = h;
  }
  return best;
}

/**
 * Pièces qui se gênent : deux pièces dans une même case à moins de 3 crans (6 m) l'une de l'autre en hauteur.
 * En dessous, la dalle du dessus toucherait la voiture qui passe dessous. Renvoie les paires d'indices.
 */
export function blockClashes(blocks: Block[]): [number, number][] {
  const occ = new Map<string, { i: number; lo: number; hi: number }[]>();
  const out: [number, number][] = [];
  blocks.forEach((b, i) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of blockPath(b)) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
    lo /= STEP;
    hi /= STEP;
    for (const [x, z] of blockCells(b)) {
      const k = cellKey(x, z);
      const list = occ.get(k) ?? occ.set(k, []).get(k)!;
      for (const o of list) if (lo < o.hi + 3 && o.lo < hi + 3 && !out.some(([a, c]) => a === o.i && c === i)) out.push([o.i, i]);
      list.push({ i, lo, hi });
    }
  });
  return out;
}

/** Vérifie qu'une map est jouable : un seul départ, au moins une arrivée. */
export function validateMap(blocks: Block[]): string | null {
  const starts = blocks.filter((b) => PIECES[b.kind].gate === "start").length;
  if (starts === 0) return "Pose une pièce Départ";
  if (starts > 1) return "Il faut un seul Départ";
  if (!blocks.some((b) => PIECES[b.kind].gate === "finish")) return "Pose une pièce Arrivée";
  return null;
}

/** Médailles à partir du temps auteur : or +5 %, argent +15 %, bronze +35 %. */
export function medalsFrom(auteur: number): Medals {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { auteur: r(auteur), or: r(auteur * 1.05), argent: r(auteur * 1.15), bronze: r(auteur * 1.35) };
}
