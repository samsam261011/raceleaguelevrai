import { HALF } from "../world/pieces";
import type { CompiledBlock, World } from "../world/world";
import { WALL_HEIGHT, WALL_INSET } from "./constants";

/**
 * Formes de collision des pièces, tirées de la même ligne centrale que l'affichage.
 * Chaque pièce donne une surface roulable (la dalle) et, s'il y en a, ses parapets en volume.
 * Uniquement + - * / et Math.sqrt : les mêmes triangles sur toutes les machines.
 */
export interface TriangleSoup {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface BlockCollision {
  block: number;
  surface: TriangleSoup;
  walls: TriangleSoup | null;
}

/** Les parapets arrêtent la caisse un peu plus haut qu'ils n'en ont l'air : on ne passe jamais par-dessus. */
const WALL_STOP = WALL_HEIGHT + 0.9;

/** Épaisseur de la dalle : ses flancs arrêtent une voiture qui arrive trop bas. */
const SLAB = 0.8;

class Builder {
  v: number[] = [];
  i: number[] = [];
  vert(x: number, y: number, z: number): number {
    this.v.push(x, y, z);
    return this.v.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.i.push(a, b, c, a, c, d);
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

function blockCollision(cb: CompiledBlock): BlockCollision {
  const n = cb.px.length;
  const S = new Builder();
  const rights = Array.from({ length: n }, (_, i) => rightAt(cb, i));

  // Dalle : dessus et flancs
  const top: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [rx, rz] = rights[i]!;
    const x = cb.px[i]!;
    const y = cb.py[i]!;
    const z = cb.pz[i]!;
    top.push([S.vert(x - rx * HALF, y, z - rz * HALF), S.vert(x + rx * HALF, y, z + rz * HALF)]);
  }
  const bottomL: number[] = [];
  const bottomR: number[] = [];
  for (let i = 0; i < n; i++) {
    const [rx, rz] = rights[i]!;
    bottomL.push(S.vert(cb.px[i]! - rx * HALF, cb.py[i]! - SLAB, cb.pz[i]! - rz * HALF));
    bottomR.push(S.vert(cb.px[i]! + rx * HALF, cb.py[i]! - SLAB, cb.pz[i]! + rz * HALF));
  }
  for (let i = 0; i < n - 1; i++) {
    const [l0, r0] = top[i]!;
    const [l1, r1] = top[i + 1]!;
    S.quad(l0, l1, r1, r0);
    S.quad(bottomL[i]!, bottomL[i + 1]!, l1, l0);
    S.quad(r0, r1, bottomR[i + 1]!, bottomR[i]!);
  }

  // Parapets : face intérieure, dessus, face extérieure
  const W = new Builder();
  for (const side of [1, -1] as const) {
    const has = side > 0 ? cb.borderPos : cb.borderNeg;
    if (!has) continue;
    const inner = HALF - WALL_INSET;
    const rows: number[][] = [];
    for (let i = 0; i < n; i++) {
      const [rx, rz] = rights[i]!;
      const x = cb.px[i]!;
      const y = cb.py[i]!;
      const z = cb.pz[i]!;
      const at = (lat: number, h: number) => W.vert(x + rx * lat * side, y + h, z + rz * lat * side);
      rows.push([at(inner, -0.2), at(inner, WALL_STOP), at(HALF, WALL_STOP), at(HALF, -SLAB)]);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = rows[i]!;
      const b = rows[i + 1]!;
      for (let k = 0; k < 3; k++) W.quad(a[k]!, b[k]!, b[k + 1]!, a[k + 1]!);
    }
  }

  return { block: cb.index, surface: S.soup()!, walls: W.soup() };
}

export function buildCollision(world: World): BlockCollision[] {
  return world.blocks.map(blockCollision);
}
