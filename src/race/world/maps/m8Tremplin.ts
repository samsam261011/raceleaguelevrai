import { Chain } from "../chain";
import { medalsFrom, type MapDefinition } from "../world";

/**
 * Map 8 : « Tremplin » (difficile). Une suite de sauts et de bosses, des réceptions qui enchaînent
 * sur des virages relevés, et un mur à prendre en appui à mi-parcours.
 */
const c = new Chain({ kind: "depart", x: 0, z: 0, level: 0, rot: 0 })
  .times(5, "route")
  .add("tremplin")
  .gap(2)
  .times(7, "route")
  .add("grandVirageReleve")
  .add("checkpoint")
  .times(2, "route")
  .add("bosse")
  .times(4, "route")
  .add("penteBas")
  .add("penteHaut")
  .times(6, "route")
  .add("tremplin")
  .gap(2, 2)
  .times(8, "route")
  .add("virage3", true)
  .add("checkpoint")
  .times(2, "route")
  .add("mur", true)
  .add("route")
  .add("grandVirageReleve", true)
  .add("checkpoint")
  .times(3, "route")
  .add("tremplin")
  .gap(3)
  .times(6, "route")
  .add("arrivee");

export const M8_TREMPLIN: MapDefinition = {
  id: "tremplin",
  name: "Tremplin",
  blocks: c.blocks,
  // Temps auteur : meilleur temps du pilote automatique (tests/maps.test.ts le vérifie)
  medals: medalsFrom(31.2),
};
