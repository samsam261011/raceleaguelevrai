import { encodeMap, hashText } from "./code";
export { MAX_LEVEL } from "./pieces";
import { buildTrack, SUBDIV } from "../race/track/build";
import type { ControlPoint, MapDefinition } from "../race/track/types";
import { LEVEL_H, opposite, PIECES, rotSide, rotXZ, SIDE_DIR, TILE, type PieceKind, type Side } from "./pieces";

/** Une pièce posée sur la grille. */
export interface Tile {
  kind: PieceKind;
  x: number;
  z: number;
  level: number;
  /** Quarts de tour, sens horaire vu du dessus (0 à 3). */
  rot: number;
}

/** Une map de l'éditeur. */
export interface EditorMap {
  name: string;
  /** Meilleur temps du créateur en test (secondes), sert de temps auteur. */
  authorTime: number | null;
  tiles: Tile[];
}



export interface WorldPort {
  x: number;
  z: number;
  side: Side;
  level: number;
}

export function tileCells(t: Tile): [number, number][] {
  return PIECES[t.kind].cells.map(([cx, cz]) => {
    const [rx, rz] = rotXZ(cx, cz, t.rot);
    return [t.x + rx, t.z + rz];
  });
}

export function tilePort(t: Tile, which: "a" | "b"): WorldPort | null {
  const p = PIECES[t.kind][which];
  if (!p) return null;
  const [rx, rz] = rotXZ(p.cell[0], p.cell[1], t.rot);
  return { x: t.x + rx, z: t.z + rz, side: rotSide(p.side, t.rot), level: t.level + p.h };
}

/** Tracé de la pièce en coordonnées du monde, dans le sens de a vers b (ou l'inverse). */
export function tilePoints(t: Tile, reversed = false): { x: number; y: number; z: number }[] {
  const pts = PIECES[t.kind].path.map((p) => {
    const [rx, rz] = rotXZ(p.x, p.z, t.rot);
    return { x: t.x * TILE + rx, y: t.level * LEVEL_H + p.y, z: t.z * TILE + rz };
  });
  return reversed ? pts.reverse() : pts;
}

/** Deux pièces au même étage qui partagent une case se remplacent. */
export function overlaps(a: Tile, b: Tile): boolean {
  if (a.level !== b.level) return false;
  const cb = tileCells(b);
  return tileCells(a).some(([x, z]) => cb.some(([x2, z2]) => x === x2 && z === z2));
}

export type WalkResult =
  | { ok: true; def: MapDefinition; order: number[]; length: number }
  | { ok: false; error: string; at: WorldPort | null; order: number[] };

/**
 * Suit le circuit depuis le départ, pièce par pièce, jusqu'à l'arrivée.
 * Chaque sortie doit tomber sur l'entrée (ou la sortie, la pièce se prend alors à l'envers) d'une pièce voisine.
 */
export function walk(map: EditorMap, id = "editeur"): WalkResult {
  const tiles = map.tiles;
  const starts = tiles.map((t, i) => (t.kind === "depart" ? i : -1)).filter((i) => i >= 0);
  if (starts.length === 0) return { ok: false, error: "Pose une pièce Départ", at: null, order: [] };
  if (starts.length > 1) return { ok: false, error: "Il faut un seul Départ", at: null, order: [] };
  if (!tiles.some((t) => t.kind === "arrivee")) return { ok: false, error: "Pose une pièce Arrivée", at: null, order: [] };

  const order: number[] = [];
  const reversedFlags: boolean[] = [];
  const used = new Set<number>();
  let cur = starts[0]!;
  let rev = false;
  for (;;) {
    order.push(cur);
    reversedFlags.push(rev);
    used.add(cur);
    const t = tiles[cur]!;
    if (t.kind === "arrivee") break;
    const out = tilePort(t, rev ? "a" : "b");
    if (!out) return { ok: false, error: "Cette pièce ne mène nulle part", at: tilePort(t, rev ? "b" : "a"), order };
    const [dx, dz] = SIDE_DIR[out.side]!;
    const nx = out.x + dx;
    const nz = out.z + dz;
    const want = opposite(out.side);
    // Après un vide, on peut atterrir plus bas
    const lowest = PIECES[t.kind].gap ? 0 : out.level;
    let found = -1;
    let foundRev = false;
    for (let lv = out.level; lv >= lowest && found < 0; lv--) {
      for (let i = 0; i < tiles.length; i++) {
        const c = tiles[i]!;
        for (const which of ["a", "b"] as const) {
          const p = tilePort(c, which);
          if (p && p.x === nx && p.z === nz && p.side === want && p.level === lv) {
            if (c.kind === "depart" || (c.kind === "arrivee" && which === "b")) continue;
            found = i;
            foundRev = which === "b";
          }
        }
      }
    }
    if (found < 0) return { ok: false, error: "Le circuit s'arrête ici", at: out, order };
    if (used.has(found)) return { ok: false, error: "Le circuit repasse sur une pièce déjà prise", at: out, order };
    cur = found;
    rev = foundRev;
  }

  // Points de contrôle, pièce après pièce
  const points: ControlPoint[] = [];
  const checkpointPoints: number[] = [];
  order.forEach((ti, k) => {
    const t = tiles[ti]!;
    const def = PIECES[t.kind];
    const pts = tilePoints(t, reversedFlags[k]);
    const gap = def.gap === true;
    let first = 0;
    if (points.length > 0) {
      // Point partagé avec la pièce précédente
      const prevGap = PIECES[tiles[order[k - 1]!]!.kind].gap === true;
      if (prevGap) points.pop(); // atterrissage : la hauteur de la nouvelle pièce compte
      else {
        // décollage ou raccord : on garde la hauteur de la pièce précédente (bout du tremplin)
        const last = points[points.length - 1]!;
        if (gap) last.gap = true;
        else delete last.gap;
        first = 1;
      }
    }
    const base = points.length - first;
    pts.slice(first).forEach((p) => points.push({ x: p.x, y: p.y, z: p.z, gap: gap || undefined }));
    if (def.gate === "checkpoint") checkpointPoints.push(base + 2);
  });
  delete points[points.length - 1]!.gap;

  const def: MapDefinition = {
    id,
    name: map.name || "Sans nom",
    points,
    checkpoints: [],
    medals: { auteur: 0, or: 0, argent: 0, bronze: 0 },
  };
  const track = buildTrack(def);
  def.checkpoints = checkpointPoints.map((j) => track.dist[j * SUBDIV]! / track.length);
  def.medals = medalsFrom(map.authorTime ?? Math.round((track.length / 42) * 10) / 10);
  return { ok: true, def, order, length: track.length };
}

/** Médailles à partir du temps auteur : or +5 %, argent +15 %, bronze +35 %. */
export function medalsFrom(auteur: number): MapDefinition["medals"] {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { auteur: r(auteur), or: r(auteur * 1.05), argent: r(auteur * 1.15), bronze: r(auteur * 1.35) };
}

/** Identifiant stable d'une map d'éditeur : ne dépend que des pièces (pas du nom ni du temps auteur). */
export function customMapId(map: EditorMap): string {
  return "custom-" + hashText(encodeMap({ name: "", authorTime: null, tiles: map.tiles }));
}
