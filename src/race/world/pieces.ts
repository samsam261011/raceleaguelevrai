import { dcos, dsin, PI } from "../math/dmath";

/** Taille d'une case de la grille (m). La route fait toute la largeur d'une case. */
export const TILE = 20;
export const HALF = TILE / 2;
/** Hauteur d'un cran de hauteur (m). */
export const STEP = 2;
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
  | "arrivee";

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
  "checkpoint",
  "arrivee",
];
