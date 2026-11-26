import { Chain } from "../chain";
import { medalsFrom, type MapDefinition } from "../world";

/**
 * Map 2 : « Spirale » (facile). Deux tours de spirale qui montent à 32 m, une longue descente
 * à pleine vitesse, puis de grands virages relevés pour revenir.
 */
const c = new Chain({ kind: "depart", x: 0, z: 0, level: 0, rot: 0 })
  .times(4, "route")
  .add("checkpoint")
  .add("route")
  .times(4, "virageMontant")
  .add("route")
  .times(4, "virageMontant")
  .add("route")
  .add("checkpoint")
  .add("penteHaut", true)
  .times(6, "pente", true)
  .add("penteBas", true)
  .times(2, "route")
  .add("grandVirageReleve", true)
  .times(2, "route")
  .add("grandVirageReleve", true)
  .add("checkpoint")
  .times(2, "route")
  .add("virage3")
  .add("chicane")
  .times(2, "route")
  .add("arrivee");

export const M2_SPIRALE: MapDefinition = {
  id: "spirale",
  name: "Spirale",
  blocks: c.blocks,
  // Temps auteur : meilleur temps du pilote automatique (tests/maps.test.ts le vérifie)
  medals: medalsFrom(32.1),
};
