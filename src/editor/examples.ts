import type { EditorMap, Tile } from "./layout";

const T = (kind: Tile["kind"], x: number, z: number, rot = 0, level = 0): Tile => ({ kind, x, z, rot, level });

/** Map de départ de l'éditeur : un petit circuit complet avec tremplin, grand virage, pont en montée et descente. */
export function exampleMap(): EditorMap {
  return {
    name: "Mon circuit",
    authorTime: null,
    tiles: [
      T("depart", 0, 0),
      T("droite", 0, 1),
      T("droite", 0, 2),
      T("tremplin", 0, 3),
      T("vide", 0, 4),
      T("droite", 0, 5),
      T("checkpoint", 0, 6),
      T("grandVirage", 0, 7),
      T("droite", 2, 8, 1),
      T("pente", 3, 8, 1),
      T("droite", 4, 8, 1, 1),
      T("virage", 5, 8, 1, 1),
      // Pente prise à l'envers : ça redescend
      T("pente", 5, 7, 0, 0),
      T("droite", 5, 6, 2),
      T("arrivee", 5, 5, 2),
    ],
  };
}
