import { HALF, SLAB_UNDER } from "../world/pieces";
import { CAP, PILLAR_RADIUS, pillarSpots } from "../world/pillars";
import { groundAt, type CompiledBlock, type World } from "../world/world";
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

/** Direction « droite » du tracé en chaque point (moyenne des segments voisins), pour des bords sans trou dans les virages. */
function rightAt(cb: CompiledBlock, i: number): [number, number] {
  const n = cb.px.length;
  const a = Math.max(0, i - 1);
  const b = Math.min(n - 2, i);
  let tx = cb.tx[a]! + cb.tx[b]!;
  let tz = cb.tz[a]! + cb.tz[b]!;
  const L = Math.sqrt(tx * tx + tz * tz) || 1;
  tx /= L;
  tz /= L;
  // Droite du tracé : (-tz, tx). Mise à l'échelle pour garder la largeur dans les virages.
  const s = 1 / Math.sqrt((cb.tx[a]! * tx + cb.tz[a]! * tz) * (cb.tx[b]! * tx + cb.tz[b]! * tz) || 1);
  return [-tz * s, tx * s];
}

/** Extrude un profil [écart latéral, hauteur] le long de la pièce ; ferme les deux bouts si demandé. */
function extrude(B: Builder, cb: CompiledBlock, rights: [number, number][], profile: [number, number][], caps: [boolean, boolean] = [false, false]): void {
  const n = cb.px.length;
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const [rx, rz] = rights[i]!;
    rows.push(profile.map(([lat, h]) => B.vert(cb.px[i]! + rx * lat, cb.py[i]! + h, cb.pz[i]! + rz * lat)));
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
 */
function wallEndsHere(world: World, cb: CompiledBlock, end: 0 | 1, side: 1 | -1): boolean {
  const n = cb.px.length;
  const i = end === 0 ? 0 : n - 1;
  const seg = end === 0 ? 0 : n - 2;
  const dir = end === 0 ? -1 : 1;
  const lat = (HALF - WALL_INSET / 2) * side;
  const x = cb.px[i]! + cb.tx[seg]! * dir * 1 - cb.tz[seg]! * lat;
  const z = cb.pz[i]! + cb.tz[seg]! * dir * 1 + cb.tx[seg]! * lat;
  const h = groundAt(world, x, z, cb.py[i]! + 0.5, 1);
  if (!h || h.block === cb) return true;
  const other = h.block;
  return Math.abs(h.groundY - cb.py[i]!) > 0.5 || !(other.borderPos || other.borderNeg);
}

function blockCollision(world: World, cb: CompiledBlock, U: Builder, W: Builder): TriangleSoup {
  const n = cb.px.length;
  const rights = Array.from({ length: n }, (_, i) => rightAt(cb, i));

  // Dessus roulable
  const S = new Builder();
  extrude(S, cb, rights, [
    [-HALF, 0],
    [HALF, 0],
  ]);

  // Flancs et dessous profilé, d'un bord à l'autre en passant sous la poutre
  const under: [number, number][] = [[HALF, 0], ...SLAB_UNDER.map(([l, h]) => [l, h] as [number, number])];
  extrude(U, cb, rights, [...under, ...[...under].reverse().map(([l, h]) => [-l, h] as [number, number])]);

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
    extrude(W, cb, rights, side > 0 ? prof : prof.map(([l, h]) => [-l, h] as [number, number]).reverse(), [wallEndsHere(world, cb, 0, side), wallEndsHere(world, cb, 1, side)]);
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
