import { densify, type PathFrame } from "../world/frames";
import { crossSection, HALF, SLAB_UNDER } from "../world/pieces";
import { CAP, PILLAR_RADIUS, pillarSpots } from "../world/pillars";
import type { CompiledBlock, World } from "../world/world";
import { WALL_HEIGHT, WALL_INSET } from "./constants";

/**
 * Formes de collision des pièces, tirées de la même ligne centrale que l'affichage.
 * Chaque pièce donne sa dalle (dessus roulable, flancs et dessous profilé) et ses parapets en volume.
 * Les pylônes sous les pièces surélevées sont aussi solides.
 * Uniquement + - * / et Math.sqrt : les mêmes formes sur toutes les machines.
 */
export interface TriangleSoup {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface TrackCollision {
  /** Dessus roulable de chaque pièce. */
  surfaces: { block: number; soup: TriangleSoup }[];
  /** Flancs et dessous des dalles, pour tout le circuit : solides, mais les roues n'y roulent pas. */
  underside: TriangleSoup | null;
  /** Tous les parapets du circuit en un seul maillage soudé : la voiture glisse le long sans accrocher aux jonctions. */
  walls: TriangleSoup | null;
  pillars: PillarCollision[];
}

export interface PillarCollision {
  x: number;
  z: number;
  /** Fût vertical : centre en hauteur, demi-hauteur, rayon. */
  shaftY: number;
  shaftHalf: number;
  radius: number;
  /** Chapeau sous la poutre : boîte orientée selon le tracé (quaternion autour de la verticale). */
  capY: number;
  capHalf: [number, number, number];
  capRot: { x: number; y: number; z: number; w: number };
}

/** Les parapets arrêtent la caisse un peu plus haut qu'ils n'en ont l'air : on ne passe jamais par-dessus. */
const WALL_STOP = WALL_HEIGHT + 0.9;

class Builder {
  v: number[] = [];
  i: number[] = [];
  private readonly index = new Map<string, number>();
  /** Les sommets sont soudés au millimètre : deux pièces voisines partagent exactement leurs bords. */
  vert(x: number, y: number, z: number): number {
    const qx = Math.round(x * 1000) / 1000;
    const qy = Math.round(y * 1000) / 1000;
    const qz = Math.round(z * 1000) / 1000;
    const key = `${qx},${qy},${qz}`;
    let i = this.index.get(key);
    if (i === undefined) {
      this.v.push(qx, qy, qz);
      i = this.v.length / 3 - 1;
      this.index.set(key, i);
    }
    return i;
  }
  quad(a: number, b: number, c: number, d: number): void {
    // Triangles dégénérés (centre d'un virage serré) écartés
    if (a !== b && b !== c && a !== c) this.i.push(a, b, c);
    if (a !== c && c !== d && a !== d) this.i.push(a, c, d);
  }
  soup(): TriangleSoup | null {
    if (this.i.length === 0) return null;
    return { vertices: Float32Array.from(this.v), indices: Uint32Array.from(this.i) };
  }
}

/** Repères de la pièce, découpés comme à l'affichage (pas de 2 m au plus). */
function blockFrames(cb: CompiledBlock): PathFrame[] {
  const out: PathFrame[] = [];
  for (let i = 0; i < cb.px.length; i++) {
    out.push({ x: cb.px[i]!, y: cb.py[i]!, z: cb.pz[i]!, tx: 0, ty: 0, tz: 0, rx: cb.rx[i]!, ry: cb.ry[i]!, rz: cb.rz[i]!, ux: cb.ux[i]!, uy: cb.uy[i]!, uz: cb.uz[i]! });
  }
  return densify(out);
}

/** Extrude un profil [écart latéral, hauteur au-dessus de la surface] le long de la pièce, dans ses repères ; ferme les bouts si demandé. */
function extrude(B: Builder, frames: readonly PathFrame[], section: [number, number][] | ((i: number) => [number, number][]), caps: [boolean, boolean] = [false, false]): void {
  const n = frames.length;
  const rows: number[][] = [];
  const profile = typeof section === "function" ? section(0) : section;
  for (let i = 0; i < n; i++) {
    const f = frames[i]!;
    const prof = typeof section === "function" ? section(i) : section;
    rows.push(prof.map(([lat, h]) => B.vert(f.x + f.rx * lat + f.ux * h, f.y + f.ry * lat + f.uy * h, f.z + f.rz * lat + f.uz * h)));
  }
  for (let i = 0; i < n - 1; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    for (let k = 0; k < profile.length - 1; k++) B.quad(a[k]!, b[k]!, b[k + 1]!, a[k + 1]!);
  }
  if (profile.length === 4) {
    const [a, b] = [rows[0]!, rows[n - 1]!];
    if (caps[0]) B.quad(a[0]!, a[1]!, a[2]!, a[3]!);
    if (caps[1]) B.quad(b[3]!, b[2]!, b[1]!, b[0]!);
  }
}

/**
 * Faut-il fermer le bout du parapet ? Seulement si aucune pièce ne prolonge la route de ce côté :
 * un bout fermé au milieu d'une ligne droite accrocherait la voiture qui frotte le mur.
 * On cherche une autre pièce dont un bout touche celui-ci (à 0,5 m près), avec un parapet du même côté.
 */
function wallEndsHere(world: World, cb: CompiledBlock, end: 0 | 1, side: 1 | -1): boolean {
  const i = end === 0 ? 0 : cb.px.length - 1;
  const x = cb.px[i]!;
  const y = cb.py[i]!;
  const z = cb.pz[i]!;
  for (const o of world.blocks) {
    if (o === cb) continue;
    const m = o.px.length;
    for (const j of [0, m - 1]) {
      const dx = o.px[j]! - x;
      const dy = o.py[j]! - y;
      const dz = o.pz[j]! - z;
      if (dx * dx + dy * dy + dz * dz > 0.25) continue;
      // Même sens de « droite » : même côté ; sinon le côté est inversé
      const same = o.rx[j]! * cb.rx[i]! + o.ry[j]! * cb.ry[i]! + o.rz[j]! * cb.rz[i]! > 0;
      const s = same ? side : -side;
      if (s > 0 ? o.borderPos : o.borderNeg) return false;
    }
  }
  return true;
}

function blockCollision(world: World, cb: CompiledBlock, U: Builder, W: Builder): TriangleSoup {
  // Dessus roulable
  const frames = blockFrames(cb);
  const S = new Builder();
  // Avancement le long de la pièce, pour la coupe (un mur sort du sol puis y rentre)
  const along = [0];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    along.push(along[i - 1]! + Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) + (b.z - a.z) * (b.z - a.z)));
  }
  const total = along[along.length - 1]!;
  extrude(S, frames, (i) => crossSection(cb.def, along[i]! / total));

  // Flancs et dessous profilé, d'un bord à l'autre en passant sous la poutre
  const under: [number, number][] = [[HALF, 0], ...SLAB_UNDER.map(([l, h]) => [l, h] as [number, number])];
  extrude(U, frames, [...under, ...[...under].reverse().map(([l, h]) => [-l, h] as [number, number])]);

  // Parapets : face intérieure, dessus, face extérieure, bouts fermés
  const inner = HALF - WALL_INSET;
  for (const side of [1, -1] as const) {
    const has = side > 0 ? cb.borderPos : cb.borderNeg;
    if (!has) continue;
    const prof: [number, number][] = [
      [inner, -0.2],
      [inner, WALL_STOP],
      [HALF, WALL_STOP],
      [HALF, -0.5],
    ];
    extrude(W, frames, side > 0 ? prof : prof.map(([l, h]) => [-l, h] as [number, number]).reverse(), [wallEndsHere(world, cb, 0, side), wallEndsHere(world, cb, 1, side)]);
  }

  return S.soup()!;
}

export function buildCollision(world: World): TrackCollision {
  const U = new Builder();
  const W = new Builder();
  const surfaces = world.blocks.map((cb) => ({ block: cb.index, soup: blockCollision(world, cb, U, W) }));
  return { surfaces, underside: U.soup(), walls: W.soup(), pillars: buildPillarCollision(world) };
}

/** Pylônes solides : un fût et un chapeau par pylône. */
function buildPillarCollision(world: World): PillarCollision[] {
  return pillarSpots(world).map((p) => {
    const capY = p.top - CAP.height / 2;
    const shaftTop = p.top - CAP.height;
    const shaftHalf = Math.max(0.05, (shaftTop - p.bottom) / 2);
    // Rotation autour de la verticale qui amène +z sur la direction du tracé (demi-angle par racines carrées)
    const c = p.dz;
    const sHalf = Math.sqrt(Math.max(0, (1 - c) / 2));
    const cHalf = Math.sqrt(Math.max(0, (1 + c) / 2));
    return {
      x: p.x,
      z: p.z,
      shaftY: p.bottom + shaftHalf,
      shaftHalf,
      radius: PILLAR_RADIUS,
      capY,
      capHalf: [CAP.halfWidth, CAP.height / 2, CAP.halfDepth],
      capRot: { x: 0, y: p.dx < 0 ? -sHalf : sHalf, z: 0, w: cHalf },
    };
  });
}
