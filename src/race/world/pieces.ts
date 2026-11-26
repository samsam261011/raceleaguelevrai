import { dcos, dsin, PI } from "../math/dmath";
import { pathFrames, SURFACE_COLUMNS } from "./frames";

/** Taille d'une case de la grille (m). La route fait toute la largeur d'une case. */
export const TILE = 20;
export const HALF = TILE / 2;
/** Hauteur d'un cran de hauteur (m). */
export const STEP = 2;
/**
 * Dessous d'une dalle, du bord vers le centre : [écart au centre, hauteur sous la route] (m).
 * Partagé par l'affichage et les collisions : la voiture touche exactement ce qu'on voit.
 */
export const SLAB_UNDER: ReadonlyArray<readonly [number, number]> = [
  [HALF, -0.55],
  [6.6, -0.95],
  [5.4, -1.8],
];
/** Hauteur maximale, en crans (le code texte en garde 6 bits). */
export const MAX_LEVEL = 63;

/** Côtés d'une case : N = +z, E = +x, S = -z, W = -x. */
export type Side = 0 | 1 | 2 | 3;
export const N: Side = 0;
export const E: Side = 1;
export const S: Side = 2;
export const W: Side = 3;
export const SIDE_DIR: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
export const opposite = (s: Side): Side => ((s + 2) % 4) as Side;
export const rotSide = (s: Side, rot: number): Side => ((s + rot) % 4) as Side;

/** Rotation d'un quart de tour, sens horaire vu du dessus : N → E → S → W. */
export function rotXZ(x: number, z: number, rot: number): [number, number] {
  let a = x;
  let b = z;
  for (let k = 0; k < (rot & 3); k++) {
    const t = a;
    a = b;
    b = -t;
  }
  return [a, b];
}

/** Entrée ou sortie d'une pièce : côté d'une case, et hauteur en crans. */
export interface Port {
  cell: readonly [number, number];
  side: Side;
  h: number;
}

export interface PathPoint {
  x: number;
  y: number;
  z: number;
  /** Haut de la surface en ce point, si elle n'est pas horizontale (virage relevé, mur, looping). */
  ux?: number;
  uy?: number;
  uz?: number;
}

export type PieceKind =
  | "depart"
  | "route"
  | "virage"
  | "virage2"
  | "virage3"
  | "pente"
  | "penteRaide"
  | "tremplin"
  | "plaque"
  | "plaquePente"
  | "checkpoint"
  | "arrivee"
  | "virageReleve"
  | "mur"
  | "looping";

export interface PieceDef {
  kind: PieceKind;
  label: string;
  /** Cases occupées, par rapport à la case d'ancrage. */
  cells: ReadonlyArray<readonly [number, number]>;
  /** Raccords (sert au pilote automatique et au calcul de la longueur). */
  ports: Port[];
  /**
   * Ligne centrale de la surface, en mètres, depuis le centre de la case d'ancrage.
   * La surface fait 20 m de large autour de cette ligne.
   */
  path: PathPoint[];
  /** Rebords de chaque côté de la ligne (côté « + » = à droite en roulant dans le sens du tracé). */
  borders: { pos: boolean; neg: boolean };
  /** Plaque : surface sans rebords, qui se traverse dans tous les sens. */
  plate?: boolean;
  gate?: "start" | "finish" | "checkpoint";
  /** Couleur de surface : route ou plaque. */
  look: "road" | "plate";
  /**
   * Surface qui n'est pas horizontale partout (penchée, verticale ou à l'envers) :
   * pas de pylônes dessous, et on ne la cherche pas « sous » un point vu de dessus.
   */
  twisted?: boolean;
  /**
   * Mur roulable du côté « + » : la chaussée se relève en quart de tube (rayon `radius`) puis monte
   * à la verticale jusqu'à `height` mètres. Il sort du sol en douceur au début de la pièce et y rentre à la fin.
   */
  sideWall?: { radius: number; height: number };
}

function straight(y1 = 0): PathPoint[] {
  return [
    { x: 0, y: 0, z: -HALF },
    { x: 0, y: y1, z: HALF },
  ];
}

/** Arc de cercle de centre (cx, cz), de l'angle a0 à a1. Extrémités exactes pour bien raccorder les pièces. */
function arc(cx: number, cz: number, r: number, a0: number, a1: number, steps: number): PathPoint[] {
  const pts: PathPoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = a0 + ((a1 - a0) * k) / steps;
    pts.push({ x: cx + r * dcos(a), y: 0, z: cz + r * dsin(a) });
  }
  pts[0] = { x: cx + r * Math.round(dcos(a0)), y: 0, z: cz + r * Math.round(dsin(a0)) };
  pts[steps] = { x: cx + r * Math.round(dcos(a1)), y: 0, z: cz + r * Math.round(dsin(a1)) };
  return pts;
}

function kicker(): PathPoint[] {
  const pts: PathPoint[] = [];
  for (let k = 0; k <= 10; k++) {
    const u = k / 10;
    pts.push({ x: 0, y: 3 * u * u, z: -HALF + TILE * u });
  }
  return pts;
}

/** Ligne droite dense de (0, -HALF) à (0, -HALF + len), un point tous les `step` mètres au plus. */
function line(len: number, step = 2): PathPoint[] {
  const n = Math.max(1, Math.ceil(len / step));
  const pts: PathPoint[] = [];
  for (let k = 0; k <= n; k++) pts.push({ x: 0, y: 0, z: -HALF + (len * k) / n });
  return pts;
}

/** 0 → 1 → 0 sans à-coup (dérivée nulle aux deux bouts). */
const bump = (u: number) => {
  const s = dsin(PI * u);
  return s * s;
};
/** 0 → 1 en douceur sur [a, b]. */
const ease = (u: number, a: number, b: number) => {
  const t = u <= a ? 0 : u >= b ? 1 : (u - a) / (b - a);
  return t * t * (3 - 2 * t);
};

/**
 * Fait pivoter la route autour d'une charnière parallèle au tracé, placée à `pivot` mètres du centre
 * du côté `side` (+1 = côté droit) : le côté opposé monte. `phi(u)` donne l'angle (rad) selon
 * l'avancement u ∈ [0, 1].
 * Plus la charnière est proche du centre, moins la trajectoire de la voiture monte et redescend :
 * c'est cette bosse qui la ferait décoller à haute vitesse. Au-delà de la charnière, le bord descend
 * légèrement sous le niveau de la pièce.
 */
function rolled(base: PathPoint[], phi: (u: number) => number, side: 1 | -1, pivot = HALF): PathPoint[] {
  const fr = pathFrames(base);
  let total = 0;
  const along = [0];
  for (let i = 1; i < base.length; i++) {
    const a = base[i - 1]!;
    const b = base[i]!;
    total += Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    along.push(total);
  }
  return base.map((p, i) => {
    const f = fr[i]!;
    const a = phi(along[i]! / total);
    const c = dcos(a);
    const sn = dsin(a);
    // Droite horizontale unitaire de la route de départ
    const rl = Math.sqrt(f.rx * f.rx + f.rz * f.rz);
    const rx = f.rx / rl;
    const rz = f.rz / rl;
    // Charnière ; nouvelle droite et nouveau haut, tournés de a autour du tracé
    const hx = p.x + rx * side * pivot;
    const hz = p.z + rz * side * pivot;
    const nrx = rx * c;
    const nry = -side * sn;
    const nrz = rz * c;
    const ux = rx * side * sn;
    const uy = c;
    const uz = rz * side * sn;
    return { x: hx - nrx * side * pivot, y: p.y - nry * side * pivot, z: hz - nrz * side * pivot, ux, uy, uz };
  });
}

/** Virage moyen relevé : le bord intérieur reste au sol, l'extérieur monte jusqu'à BANK puis redescend. */
const BANK = (20 * PI) / 180;
/** Charnière à 7,5 m du centre : le bord intérieur ne descend que de 0,9 m, le centre ne monte que de 2,6 m. */
const BANK_PIVOT = 7.5;
function bankedTurn(): PathPoint[] {
  const base = arc(TILE + HALF, -HALF, TILE + HALF, PI, PI / 2, 40);
  // Virage à droite (vers l'est) : l'intérieur est le côté « - » de la route
  return rolled(base, (u) => BANK * bump(u), -1, BANK_PIVOT);
}

/** Nombre de facettes du quart de tube d'un mur. */
const WALL_ARC = 8;
/** Hauteur relative du mur selon l'avancement : il sort du sol, reste, puis rentre. */
const wallRise = (u: number) => ease(u, 0.02, 0.2) - ease(u, 0.8, 0.98);

/**
 * Coupe transversale de la surface roulable à l'avancement u ∈ [0, 1] : points [écart latéral, hauteur]
 * dans le repère de la ligne centrale, de gauche à droite. Toujours le même nombre de points pour une pièce,
 * pour relier deux coupes voisines. L'affichage et les collisions utilisent cette même coupe.
 */
export function crossSection(def: PieceDef, u: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 0; k <= SURFACE_COLUMNS; k++) pts.push([-HALF + (TILE * k) / SURFACE_COLUMNS, 0]);
  const w = def.sideWall;
  if (!w) return pts;
  const e = wallRise(u);
  const r = w.radius * e;
  // Quart de tube : centre au-dessus du bord de la route, la surface tourne de 0 à 90°
  for (let k = 1; k <= WALL_ARC; k++) {
    const a = (PI / 2) * (k / WALL_ARC);
    pts.push([HALF + r * dsin(a), r * (1 - dcos(a))]);
  }
  // Paroi verticale
  pts.push([HALF + r, w.height * e]);
  return pts;
}

/**
 * Looping de rayon LOOP_R au milieu de 3 cases. La sortie est décalée d'une case vers la droite
 * de la route pour ne pas retomber sur l'entrée. Le haut de la surface pointe vers le centre du cercle.
 */
export const LOOP_R = 13;
function loop(): PathPoint[] {
  const pts: PathPoint[] = [];
  const cz = TILE;
  // Entrée : de -HALF au bas du cercle
  for (let k = 0; k < 15; k++) pts.push({ x: 0, y: 0, z: -HALF + ((cz + HALF) * k) / 15 });
  // Le cercle, avec un glissement latéral progressif d'une case (côté droit = -x)
  const N = 72;
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    const th = 2 * PI * u;
    const c = dcos(th);
    const sn = dsin(th);
    pts.push({ x: -TILE * ease(u, 0.08, 0.92), y: LOOP_R * (1 - c), z: cz + LOOP_R * sn, ux: 0, uy: c, uz: -sn });
  }
  // Sortie : du bas du cercle à +2 cases et demie
  for (let k = 1; k <= 15; k++) pts.push({ x: -TILE, y: 0, z: cz + ((2 * TILE + HALF - cz) * k) / 15 });
  return pts;
}

const one = [[0, 0]] as const;
const SN = (h = 0): Port[] => [
  { cell: [0, 0], side: S, h: 0 },
  { cell: [0, 0], side: N, h },
];
const ALL4: Port[] = [N, E, S, W].map((side) => ({ cell: [0, 0] as const, side, h: 0 }));
const square = (n: number) => {
  const c: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c.push([i, j]);
  return c;
};
const BOTH = { pos: true, neg: true };
const NONE = { pos: false, neg: false };

export const PIECES: Record<PieceKind, PieceDef> = {
  depart: { kind: "depart", label: "Départ", cells: one, ports: [{ cell: [0, 0], side: N, h: 0 }], path: straight(), borders: BOTH, gate: "start", look: "road" },
  route: { kind: "route", label: "Route", cells: one, ports: SN(), path: straight(), borders: BOTH, look: "road" },
  virage: {
    kind: "virage",
    label: "Virage serré",
    cells: one,
    ports: [
      { cell: [0, 0], side: S, h: 0 },
      { cell: [0, 0], side: E, h: 0 },
    ],
    path: arc(HALF, -HALF, HALF, PI, PI / 2, 12),
    // L'intérieur du virage serré n'a pas de rebord (rayon nul)
    borders: { pos: true, neg: false },
    look: "road",
  },
  virage2: {
    kind: "virage2",
    label: "Virage moyen",
    cells: square(2),
    ports: [
      { cell: [0, 0], side: S, h: 0 },
      { cell: [1, 1], side: E, h: 0 },
    ],
    path: arc(TILE + HALF, -HALF, TILE + HALF, PI, PI / 2, 32),
    borders: BOTH,
    look: "road",
  },
  virage3: {
    kind: "virage3",
    label: "Grand virage",
    cells: square(3),
    ports: [
      { cell: [0, 0], side: S, h: 0 },
      { cell: [2, 2], side: E, h: 0 },
    ],
    path: arc(2 * TILE + HALF, -HALF, 2 * TILE + HALF, PI, PI / 2, 52),
    borders: BOTH,
    look: "road",
  },
  pente: { kind: "pente", label: "Pente", cells: one, ports: SN(2), path: straight(2 * STEP), borders: BOTH, look: "road" },
  penteRaide: { kind: "penteRaide", label: "Pente raide", cells: one, ports: SN(5), path: straight(5 * STEP), borders: BOTH, look: "road" },
  tremplin: { kind: "tremplin", label: "Tremplin", cells: one, ports: SN(0), path: kicker(), borders: BOTH, look: "road" },
  plaque: { kind: "plaque", label: "Plaque", cells: one, ports: ALL4, path: straight(), borders: NONE, plate: true, look: "plate" },
  plaquePente: { kind: "plaquePente", label: "Plaque en pente", cells: one, ports: SN(2), path: straight(2 * STEP), borders: NONE, look: "plate" },
  checkpoint: { kind: "checkpoint", label: "Checkpoint", cells: one, ports: SN(), path: straight(), borders: BOTH, gate: "checkpoint", look: "road" },
  arrivee: { kind: "arrivee", label: "Arrivée", cells: one, ports: [{ cell: [0, 0], side: S, h: 0 }], path: straight(), borders: BOTH, gate: "finish", look: "road" },
  virageReleve: {
    kind: "virageReleve",
    label: "Virage relevé",
    cells: square(2),
    ports: [
      { cell: [0, 0], side: S, h: 0 },
      { cell: [1, 1], side: E, h: 0 },
    ],
    path: bankedTurn(),
    borders: BOTH,
    look: "road",
    twisted: true,
  },
  mur: {
    kind: "mur",
    label: "Mur",
    // Le mur se dresse à droite de la route (-x), sur la colonne voisine
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [-1, 0],
      [-1, 1],
      [-1, 2],
      [-1, 3],
    ],
    ports: [
      { cell: [0, 0], side: S, h: 0 },
      { cell: [0, 3], side: N, h: 0 },
    ],
    path: line(4 * TILE, 2),
    // Pas de parapet côté mur : la chaussée y monte en quart de tube
    borders: { pos: false, neg: true },
    look: "road",
    sideWall: { radius: 6, height: 14 },
  },
  looping: {
    kind: "looping",
    label: "Looping",
    cells: [
      [0, 0],
      [0, 1],
      [0, 2],
      [-1, 0],
      [-1, 1],
      [-1, 2],
    ],
    ports: [
      { cell: [0, 0], side: S, h: 0 },
      { cell: [-1, 2], side: N, h: 0 },
    ],
    path: loop(),
    borders: BOTH,
    look: "road",
    twisted: true,
  },
};

/** Ordre des pièces dans la palette de l'éditeur (et numéros du clavier). */
export const PALETTE: PieceKind[] = [
  "depart",
  "route",
  "virage",
  "virage2",
  "virage3",
  "pente",
  "penteRaide",
  "tremplin",
  "plaque",
  "plaquePente",
  "virageReleve",
  "mur",
  "looping",
  "checkpoint",
  "arrivee",
];
