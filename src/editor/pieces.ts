import { dcos, dsin, PI } from "../race/math/dmath";

/** Taille d'une case de la grille, en mètres. */
export const TILE = 32;
/** Hauteur d'un étage, en mètres. */
export const LEVEL_H = 5;

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

/** Une entrée ou sortie de pièce : sur quel côté de quelle case, à quelle hauteur (en étages). */
export interface Port {
  cell: readonly [number, number];
  side: Side;
  h: number;
}

/** Point du tracé d'une pièce, en mètres, par rapport au centre de sa case d'ancrage. */
export interface PiecePoint {
  x: number;
  y: number;
  z: number;
}

export type PieceKind =
  | "depart"
  | "arrivee"
  | "droite"
  | "checkpoint"
  | "virage"
  | "grandVirage"
  | "pente"
  | "tremplin"
  | "vide";

export interface PieceDef {
  kind: PieceKind;
  label: string;
  /** Cases occupées, par rapport à la case d'ancrage (0, 0). */
  cells: ReadonlyArray<readonly [number, number]>;
  /** Entrée (null pour le départ). */
  a: Port | null;
  /** Sortie (null pour l'arrivée). */
  b: Port | null;
  /** Tracé de a vers b. */
  path: PiecePoint[];
  /** Le tracé est un trou à sauter. */
  gap?: boolean;
  gate?: "start" | "finish" | "checkpoint";
}

const H = TILE / 2;

function straight(): PiecePoint[] {
  const pts: PiecePoint[] = [];
  for (let k = 0; k <= 4; k++) pts.push({ x: 0, y: 0, z: -H + (TILE * k) / 4 });
  return pts;
}

/** Arc de cercle de centre (cx, cz), de l'angle a0 à a1, en `steps` morceaux. */
function arc(cx: number, cz: number, r: number, a0: number, a1: number, steps: number): PiecePoint[] {
  const pts: PiecePoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = a0 + ((a1 - a0) * k) / steps;
    pts.push({ x: cx + r * dcos(a), y: 0, z: cz + r * dsin(a) });
  }
  // Extrémités exactes, pour que les pièces se raccordent au millimètre
  pts[0] = { x: cx + r * Math.round(dcos(a0)), y: 0, z: cz + r * Math.round(dsin(a0)) };
  pts[steps] = { x: cx + r * Math.round(dcos(a1)), y: 0, z: cz + r * Math.round(dsin(a1)) };
  return pts;
}

function withHeights(pts: PiecePoint[], ys: number[]): PiecePoint[] {
  return pts.map((p, i) => ({ ...p, y: ys[i]! }));
}

const one = [[0, 0]] as const;

export const PIECES: Record<PieceKind, PieceDef> = {
  depart: {
    kind: "depart",
    label: "Départ",
    cells: one,
    a: null,
    b: { cell: [0, 0], side: N, h: 0 },
    path: straight(),
    gate: "start",
  },
  arrivee: {
    kind: "arrivee",
    label: "Arrivée",
    cells: one,
    a: { cell: [0, 0], side: S, h: 0 },
    b: null,
    path: straight(),
    gate: "finish",
  },
  droite: {
    kind: "droite",
    label: "Ligne droite",
    cells: one,
    a: { cell: [0, 0], side: S, h: 0 },
    b: { cell: [0, 0], side: N, h: 0 },
    path: straight(),
  },
  checkpoint: {
    kind: "checkpoint",
    label: "Checkpoint",
    cells: one,
    a: { cell: [0, 0], side: S, h: 0 },
    b: { cell: [0, 0], side: N, h: 0 },
    path: straight(),
    gate: "checkpoint",
  },
  virage: {
    kind: "virage",
    label: "Virage",
    cells: one,
    a: { cell: [0, 0], side: S, h: 0 },
    b: { cell: [0, 0], side: E, h: 0 },
    path: arc(H, -H, H, PI, PI / 2, 4),
  },
  grandVirage: {
    kind: "grandVirage",
    label: "Grand virage",
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    a: { cell: [0, 0], side: S, h: 0 },
    b: { cell: [1, 1], side: E, h: 0 },
    path: arc(TILE + H, -H, TILE + H, PI, PI / 2, 10),
  },
  pente: {
    kind: "pente",
    label: "Pente",
    cells: one,
    a: { cell: [0, 0], side: S, h: 0 },
    b: { cell: [0, 0], side: N, h: 1 },
    // Montée douce en S : 0 → 1 étage
    path: withHeights(straight(), [0, 0.146, 0.5, 0.854, 1].map((f) => f * LEVEL_H)),
  },
  tremplin: {
    kind: "tremplin",
    label: "Tremplin",
    cells: one,
    a: { cell: [0, 0], side: S, h: 0 },
    b: { cell: [0, 0], side: N, h: 0 },
    path: withHeights(straight(), [0, 0.3, 1.0, 2.1, 3.5]),
  },
  vide: {
    kind: "vide",
    label: "Vide",
    cells: one,
    a: { cell: [0, 0], side: S, h: 0 },
    b: { cell: [0, 0], side: N, h: 0 },
    // Tracé invisible au-dessus du trou : il garde l'élan du tremplin dans la courbe
    path: withHeights(straight(), [0, 4.9, 5.6, 5.2, 0]),
    gap: true,
  },
};

/** Ordre de la palette de l'éditeur. */
export const PALETTE: PieceKind[] = ["depart", "droite", "virage", "grandVirage", "pente", "tremplin", "vide", "checkpoint", "arrivee"];

/** Rotation d'un quart de tour (sens horaire vu du dessus) : N → E → S → W. */
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

export const rotSide = (s: Side, rot: number): Side => ((s + rot) % 4) as Side;

/** Étage le plus haut (le code texte en garde 4 bits). */
export const MAX_LEVEL = 15;
