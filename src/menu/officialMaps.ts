import { OFFICIAL_MAPS } from "../race/world/maps";
import { findRoute } from "../race/world/route";

/** Ce que le menu affiche d'une map officielle : nom, médailles, et son tracé vu de dessus (chemin SVG). */
export interface MenuMap {
  id: string;
  name: string;
  medals: { auteur: number; or: number; argent: number; bronze: number };
  /** Tracé dans une boîte de 200 × 150, nord en haut. */
  path: string;
  start: [number, number];
  end: [number, number];
}

export function menuMaps(): MenuMap[] {
  return OFFICIAL_MAPS.map((m) => {
    const r = findRoute(m.blocks);
    // Vue de dessus comme dans le jeu : en roulant vers le nord (+z), +x est à gauche
    const pts: [number, number][] = r ? r.px.map((x, i) => [-x, -r.pz[i]!]) : [[0, 0]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const k = Math.min(170 / Math.max(1, x1 - x0), 120 / Math.max(1, y1 - y0));
    const ox = 100 - ((x0 + x1) / 2) * k;
    const oy = 75 - ((y0 + y1) / 2) * k;
    const P = pts.map(([x, y]) => [x * k + ox, y * k + oy] as [number, number]);
    // Un point tous les ~2 px suffit
    const keep: [number, number][] = [];
    for (const p of P) {
      const l = keep[keep.length - 1];
      if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 2) keep.push(p);
    }
    const last = P[P.length - 1]!;
    if (keep[keep.length - 1] !== last) keep.push(last);
    const path = keep.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
    return { id: m.id, name: m.name, medals: m.medals, path, start: P[0]!, end: last };
  });
}
