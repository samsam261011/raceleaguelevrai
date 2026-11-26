import type { EditorMap } from "../race/world/code";
import { M1_GRAND_SAUT } from "../race/world/maps/m1GrandSaut";

/** Map de départ de l'éditeur : une copie du Grand Saut, pour voir les pièces en place. */
export function exampleMap(): EditorMap {
  return { name: "Mon circuit", authorTime: null, blocks: M1_GRAND_SAUT.blocks.map((b) => ({ ...b })) };
}
