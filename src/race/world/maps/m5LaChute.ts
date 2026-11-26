import { Chain } from "../chain";
import { medalsFrom, type MapDefinition } from "../world";

/**
 * Map 5 : « La Chute » (moyen). Départ au sommet, à 60 m : longues descentes sans cassure,
 * deux grands sauts vers le bas et de grands virages pris à pleine vitesse.
 */
const c = new Chain({ kind: "depart", x: 0, z: 0, level: 30, rot: 0 })
  .times(2, "route")
  .add("penteHaut", true)
  .times(3, "pente", true)
  .add("penteBas", true)
  .add("virage3", true)
  .add("checkpoint")
  .times(4, "route")
  .add("tremplin")
  .gap(2, 4)
  .times(9, "route")
  .add("virage4")
  .add("penteHaut", true)
  .times(2, "pente", true)
  .add("penteBas", true)
  .add("checkpoint")
  .add("virage3")
  .times(3, "route")
  .add("tremplin")
  .gap(2, 4)
  .times(9, "route")
  .add("checkpoint")
  .add("virage3", true)
  .add("penteHaut", true)
  .add("penteBas", true)
  .times(2, "route")
  .add("arrivee");

export const M5_LA_CHUTE: MapDefinition = {
  id: "la-chute",
  name: "La Chute",
  blocks: c.blocks,
  // Temps auteur : meilleur temps du pilote automatique (tests/maps.test.ts le vérifie)
  medals: medalsFrom(30.9),
};
