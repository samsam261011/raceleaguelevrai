import type { EditorMap } from "../race/world/code";
import { GRAND_SAUT } from "../race/world/maps/grandSaut";

/** Map de départ de l'éditeur : une copie du Grand Saut, pour voir chaque pièce en place. */
export function exampleMap(): EditorMap {
  return { name: "Mon circuit", authorTime: null, blocks: GRAND_SAUT.blocks.map((b) => ({ ...b })) };
}
