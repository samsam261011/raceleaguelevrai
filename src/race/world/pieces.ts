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
/**
 * Coupe du dessous d'une dalle de demi-largeur `hw` : bord, sous-face inclinée, poutre centrale.
 * Une double voie garde le même dessin, élargi.
 */
export function underProfile(hw: number): [number, number][] {
  const k = hw / HALF;
  const half: [number, number][] = [[hw, 0], ...SLAB_UNDER.map(([l, h]) => [l * k, h] as [number, number])];
  return [...half, ...[...half].reverse().map(([l, h]) => [-l, h] as [number, number])];
}

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
  | "looping"
  // Pièces ajoutées avec la refonte de l'éditeur
  | "virage4"
  | "chicane"
  | "chicaneG"
  | "penteLongue"
  | "bosse"
  | "virageMontant"
  | "virageMontantD"
  | "penteBas"
  | "penteHaut"
  | "grandVirageReleve"
  | "routeLarge"
  | "elargir"
  | "virageLargeCourt"
  | "virageLarge"
  | "grandVirageLarge"
  | "penteLarge"
  | "departLarge"
  | "checkpointLarge"
  | "arriveeLarge";

export interface PieceDef {
  kind: PieceKind;
  label: string;
  /** Cases occupées, par rapport à la case d'ancrage. */
  cells: ReadonlyArray<readonly [number, number]>;
  /**
   * Ligne centrale de la surface, en mètres, depuis le centre de la case d'ancrage.
   * La surface fait 20 m de large autour de cette ligne (40 m pour une pièce à double voie).
   * Les raccords de la pièce sont les deux bouts de cette ligne.
   */
  path: PathPoint[];
  /**
   * Double voie : demi-largeur de la chaussée au début et à la fin de la pièce (m), symétrique autour
   * de la ligne centrale, avec une transition douce entre les deux. Absent : 10 m (une case).
   */
  width?: readonly [number, number];
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
  const hw = halfWidth(def, u);
  const cols = columnsOf(def);
  for (let k = 0; k <= cols; k++) pts.push([-hw + (2 * hw * k) / cols, 0]);
  const w = def.sideWall;
  if (!w) return pts;
  const e = wallRise(u);
  const r = w.radius * e;
  // Quart de tube : centre au-dessus du bord de la route, la surface tourne de 0 à 90°
  for (let k = 1; k <= WALL_ARC; k++) {
    const a = (PI / 2) * (k / WALL_ARC);
    pts.push([hw + r * dsin(a), r * (1 - dcos(a))]);
  }
  // Paroi verticale
  pts.push([hw + r, w.height * e]);
  return pts;
}

/** Demi-largeur de la chaussée à l'avancement u ∈ [0, 1] (10 m, ou 20 m pour une double voie). */
export function halfWidth(def: PieceDef, u: number): number {
  const w = def.width;
  if (!w) return HALF;
  return w[0] + (w[1] - w[0]) * ease(u, 0, 1);
}

/** Plus grande demi-largeur d'une pièce. */
export function maxHalfWidth(def: PieceDef): number {
  return def.width ? Math.max(def.width[0], def.width[1]) : HALF;
}

/** Nombre de bandes en travers de la chaussée : 8 par voie, pour que les surfaces vrillées restent lisses. */
export function columnsOf(def: PieceDef): number {
  return SURFACE_COLUMNS * Math.max(1, Math.round(maxHalfWidth(def) / HALF));
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

/** Rampe douce : de 0 à `rise` mètres sur `cells` cases, pente nulle aux deux bouts (pas de bosse au raccord). */
function smoothRamp(cells: number, rise: number, x = 0): PathPoint[] {
  const n = 10 * cells;
  const pts: PathPoint[] = [];
  for (let k = 0; k <= n; k++) pts.push({ x, y: rise * ease(k / n, 0, 1), z: -HALF + (cells * TILE * k) / n });
  return pts;
}

/**
 * Raccord de pente sur 2 cases : la pente passe en douceur de 0 à celle de la pièce « Pente » (20 %),
 * en montant de 2 crans. `top` : bombé (le haut d'une côte), sinon creux (le pied d'une côte).
 * Mises bout à bout avec des « Pente », elles font une longue côte sans aucune cassure.
 */
function slopeJoin(top: boolean): PathPoint[] {
  const n = 20;
  const rise = 2 * STEP;
  const pts: PathPoint[] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    pts.push({ x: 0, y: top ? rise * (1 - (1 - u) * (1 - u)) : rise * u * u, z: -HALF + 2 * TILE * u });
  }
  return pts;
}

/** Bosse : la route monte de `height` mètres puis redescend, sur `cells` cases. */
function hump(cells: number, height: number): PathPoint[] {
  const n = 12 * cells;
  const pts: PathPoint[] = [];
  for (let k = 0; k <= n; k++) pts.push({ x: 0, y: height * bump(k / n), z: -HALF + (cells * TILE * k) / n });
  return pts;
}

/**
 * Chicane : la route se décale d'une case sur le côté en `cells` cases, sans à-coup.
 * `side` = 1 : vers la droite (-x) ; -1 : vers la gauche (+x).
 */
function chicane(cells: number, side: 1 | -1): PathPoint[] {
  const n = 12 * cells;
  const pts: PathPoint[] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    pts.push({ x: -side * TILE * ease(u, 0, 1), y: 0, z: -HALF + cells * TILE * u });
  }
  return pts;
}

/** Virage qui monte de `rise` mètres en tournant (vers +x, ou vers -x avec `mirror`). */
function climbingTurn(rise: number, mirror = false): PathPoint[] {
  const base = arc(TILE + HALF, -HALF, TILE + HALF, PI, PI / 2, 32);
  return base.map((p, k) => ({ x: mirror ? -p.x : p.x, y: rise * ease(k / 32, 0, 1), z: p.z }));
}

/** Grand virage relevé, plus penché que le moyen : on y passe à fond. */
const BANK_BIG = (16 * PI) / 180;
function bigBankedTurn(): PathPoint[] {
  const base = arc(2 * TILE + HALF, -HALF, 2 * TILE + HALF, PI, PI / 2, 52);
  return rolled(base, (u) => BANK_BIG * bump(u), -1, BANK_PIVOT);
}

// ---------- Double voie ----------
/** Une double voie fait deux cases de large : sa ligne centrale passe entre les deux. */
const WIDE = TILE;
const WIDE_X = -HALF;
function wideStraight(y1 = 0): PathPoint[] {
  return [
    { x: WIDE_X, y: 0, z: -HALF },
    { x: WIDE_X, y: y1, z: HALF },
  ];
}
/** Élargissement : la ligne centrale glisse d'une demi-case pendant que la route passe de une à deux voies. */
function widening(): PathPoint[] {
  const n = 24;
  const pts: PathPoint[] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    pts.push({ x: WIDE_X * ease(u, 0, 1), y: 0, z: -HALF + 2 * TILE * u });
  }
  return pts;
}
/** Virage à double voie de rayon `r` (mesuré sur la ligne centrale). */
function wideTurn(r: number, steps: number): PathPoint[] {
  return arc(WIDE_X + r, -HALF, r, PI, PI / 2, steps);
}

const one = [[0, 0]] as const;
const square = (n: number, x0 = 0) => {
  const c: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c.push([x0 + i, j]);
  return c;
};
const column = (x: number, n: number) => Array.from({ length: n }, (_, j) => [x, j] as [number, number]);
const BOTH = { pos: true, neg: true };
const NONE = { pos: false, neg: false };
const WIDE_ONE: [number, number][] = [
  [0, 0],
  [-1, 0],
];

export const PIECES: Record<PieceKind, PieceDef> = {
  depart: { kind: "depart", label: "Départ", cells: one, path: straight(), borders: BOTH, gate: "start", look: "road" },
  route: { kind: "route", label: "Route", cells: one, path: straight(), borders: BOTH, look: "road" },
  virage: {
    kind: "virage",
    label: "Virage serré",
    cells: one,
    path: arc(HALF, -HALF, HALF, PI, PI / 2, 12),
    // L'intérieur du virage serré n'a pas de rebord (rayon nul)
    borders: { pos: true, neg: false },
    look: "road",
  },
  virage2: { kind: "virage2", label: "Virage moyen", cells: square(2), path: arc(TILE + HALF, -HALF, TILE + HALF, PI, PI / 2, 32), borders: BOTH, look: "road" },
  virage3: { kind: "virage3", label: "Grand virage", cells: square(3), path: arc(2 * TILE + HALF, -HALF, 2 * TILE + HALF, PI, PI / 2, 52), borders: BOTH, look: "road" },
  virage4: { kind: "virage4", label: "Très grand virage", cells: square(4), path: arc(3 * TILE + HALF, -HALF, 3 * TILE + HALF, PI, PI / 2, 64), borders: BOTH, look: "road" },
  chicane: { kind: "chicane", label: "Chicane droite", cells: [...column(0, 4), ...column(-1, 4)], path: chicane(4, 1), borders: BOTH, look: "road" },
  chicaneG: { kind: "chicaneG", label: "Chicane gauche", cells: [...column(0, 4), ...column(1, 4)], path: chicane(4, -1), borders: BOTH, look: "road" },
  pente: { kind: "pente", label: "Pente", cells: one, path: straight(2 * STEP), borders: BOTH, look: "road" },
  penteRaide: { kind: "penteRaide", label: "Pente raide", cells: one, path: straight(5 * STEP), borders: BOTH, look: "road" },
  penteLongue: { kind: "penteLongue", label: "Longue pente", cells: column(0, 2), path: smoothRamp(2, 3 * STEP), borders: BOTH, look: "road" },
  bosse: { kind: "bosse", label: "Bosse", cells: column(0, 2), path: hump(2, 2), borders: BOTH, look: "road" },
  penteBas: { kind: "penteBas", label: "Pied de pente", cells: column(0, 2), path: slopeJoin(false), borders: BOTH, look: "road" },
  penteHaut: { kind: "penteHaut", label: "Haut de pente", cells: column(0, 2), path: slopeJoin(true), borders: BOTH, look: "road" },
  virageMontant: { kind: "virageMontant", label: "Virage montant gauche", cells: square(2), path: climbingTurn(2 * STEP), borders: BOTH, look: "road" },
  virageMontantD: { kind: "virageMontantD", label: "Virage montant droite", cells: square(2, -1), path: climbingTurn(2 * STEP, true), borders: BOTH, look: "road" },
  tremplin: { kind: "tremplin", label: "Tremplin", cells: one, path: kicker(), borders: BOTH, look: "road" },
  plaque: { kind: "plaque", label: "Plaque", cells: one, path: straight(), borders: NONE, plate: true, look: "plate" },
  plaquePente: { kind: "plaquePente", label: "Plaque en pente", cells: one, path: straight(2 * STEP), borders: NONE, look: "plate" },
  checkpoint: { kind: "checkpoint", label: "Checkpoint", cells: one, path: straight(), borders: BOTH, gate: "checkpoint", look: "road" },
  arrivee: { kind: "arrivee", label: "Arrivée", cells: one, path: straight(), borders: BOTH, gate: "finish", look: "road" },
  virageReleve: { kind: "virageReleve", label: "Virage relevé", cells: square(2), path: bankedTurn(), borders: BOTH, look: "road", twisted: true },
  grandVirageReleve: { kind: "grandVirageReleve", label: "Grand virage relevé", cells: square(3), path: bigBankedTurn(), borders: BOTH, look: "road", twisted: true },
  mur: {
    kind: "mur",
    label: "Mur",
    // Le mur se dresse à droite de la route (-x), sur la colonne voisine
    cells: [...column(0, 4), ...column(-1, 4)],
    path: line(4 * TILE, 2),
    // Pas de parapet côté mur : la chaussée y monte en quart de tube
    borders: { pos: false, neg: true },
    look: "road",
    sideWall: { radius: 6, height: 14 },
  },
  looping: { kind: "looping", label: "Looping", cells: [...column(0, 3), ...column(-1, 3)], path: loop(), borders: BOTH, look: "road", twisted: true },
  // Double voie : deux cases de large, la ligne centrale entre les deux
  routeLarge: { kind: "routeLarge", label: "Route double", cells: WIDE_ONE, path: wideStraight(), width: [WIDE, WIDE], borders: BOTH, look: "road" },
  elargir: {
    kind: "elargir",
    label: "Élargissement",
    cells: [...column(0, 2), ...column(-1, 2)],
    path: widening(),
    width: [HALF, WIDE],
    borders: BOTH,
    look: "road",
  },
  virageLargeCourt: {
    kind: "virageLargeCourt",
    label: "Virage double serré",
    cells: square(2, -1),
    path: wideTurn(TILE, 24),
    width: [WIDE, WIDE],
    // Rayon nul à l'intérieur, comme le virage serré
    borders: { pos: true, neg: false },
    look: "road",
  },
  virageLarge: { kind: "virageLarge", label: "Virage double", cells: square(3, -1), path: wideTurn(2 * TILE, 40), width: [WIDE, WIDE], borders: BOTH, look: "road" },
  grandVirageLarge: { kind: "grandVirageLarge", label: "Grand virage double", cells: square(4, -1), path: wideTurn(3 * TILE, 56), width: [WIDE, WIDE], borders: BOTH, look: "road" },
  penteLarge: { kind: "penteLarge", label: "Pente double", cells: WIDE_ONE, path: wideStraight(2 * STEP), width: [WIDE, WIDE], borders: BOTH, look: "road" },
  departLarge: { kind: "departLarge", label: "Départ double", cells: WIDE_ONE, path: wideStraight(), width: [WIDE, WIDE], borders: BOTH, gate: "start", look: "road" },
  checkpointLarge: { kind: "checkpointLarge", label: "Checkpoint double", cells: WIDE_ONE, path: wideStraight(), width: [WIDE, WIDE], borders: BOTH, gate: "checkpoint", look: "road" },
  arriveeLarge: { kind: "arriveeLarge", label: "Arrivée double", cells: WIDE_ONE, path: wideStraight(), width: [WIDE, WIDE], borders: BOTH, gate: "finish", look: "road" },
};

/** Familles de pièces, dans l'ordre de la palette de l'éditeur. */
export const PALETTE_GROUPS: { name: string; kinds: PieceKind[] }[] = [
  { name: "Course", kinds: ["depart", "checkpoint", "arrivee", "route"] },
  { name: "Virages", kinds: ["virage", "virage2", "virage3", "virage4", "chicane", "chicaneG"] },
  { name: "Relief", kinds: ["pente", "penteBas", "penteHaut", "penteRaide", "penteLongue", "bosse", "virageMontant", "virageMontantD", "tremplin"] },
  { name: "Double voie", kinds: ["routeLarge", "elargir", "virageLargeCourt", "virageLarge", "grandVirageLarge", "penteLarge", "departLarge", "checkpointLarge", "arriveeLarge"] },
  { name: "Figures", kinds: ["virageReleve", "grandVirageReleve", "mur", "looping"] },
  { name: "Plaques", kinds: ["plaque", "plaquePente"] },
];

/** Toutes les pièces de la palette, à plat. */
export const PALETTE: PieceKind[] = PALETTE_GROUPS.flatMap((g) => g.kinds);
