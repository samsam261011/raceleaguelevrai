import { TILE } from "./pieces";
import { cellKey, onBlock, type World } from "./world";

/** Profondeur de la poutre sous la route : le haut d'un pylône est à cette distance sous la dalle. */
export const GIRDER_DEPTH = 1.8;
/** Rayon du fût et taille du chapeau (demi-largeur en travers, demi-épaisseur, hauteur). */
export const PILLAR_RADIUS = 1.2;
export const CAP = { halfWidth: 4.6, halfDepth: 1.1, height: 1.8 } as const;

export interface PillarSpot {
  x: number;
  z: number;
  /** Haut du pylône (sous la poutre) et pied (au sol). */
  top: number;
  bottom: number;
  /** Direction du tracé au-dessus (normalisée). */
  dx: number;
  dz: number;
}

/**
 * Où poser les pylônes : environ un tous les 20 m sous chaque pièce surélevée.
 * Partagé par l'affichage et les collisions. Uniquement + - * / et Math.sqrt.
 */
export function pillarSpots(world: World): PillarSpot[] {
  const list: PillarSpot[] = [];
  for (const cb of world.blocks) {
    // Pas de pylônes sous une surface penchée, verticale ou enroulée
    if (cb.def.twisted) continue;
    const len = cb.length;
    const count = Math.max(1, Math.round(len / TILE));
    for (let k = 0; k < count; k++) {
      const target = ((k + 0.5) * len) / count;
      let i = 0;
      while (i < cb.segLen.length - 1 && cb.cum[i + 1]! < target) i++;
      const t = (target - cb.cum[i]!) / Math.max(1e-6, cb.cum[i + 1]! - cb.cum[i]!);
      const x = cb.px[i]! + (cb.px[i + 1]! - cb.px[i]!) * t;
      const y = cb.py[i]! + (cb.py[i + 1]! - cb.py[i]!) * t;
      const z = cb.pz[i]! + (cb.pz[i + 1]! - cb.pz[i]!) * t;
      const top = y - GIRDER_DEPTH;
      // Le pylône descend jusqu'au sol. S'il tomberait sur une autre pièce (un pont au-dessus d'une route),
      // on n'en met pas : il boucherait la route du dessous.
      const bottom = world.groundY - 0.2;
      let blocked = false;
      for (const j of world.cells.get(cellKey(Math.round(x / TILE), Math.round(z / TILE))) ?? []) {
        const o = world.blocks[j]!;
        if (o === cb) continue;
        const h = onBlock(o, x, z);
        if (h && h.groundY < top - 0.5) blocked = true;
      }
      if (blocked || top - bottom < 0.6) continue;
      list.push({ x, z, top, bottom, dx: cb.tx[i]!, dz: cb.tz[i]! });
    }
  }
  return list;
}
