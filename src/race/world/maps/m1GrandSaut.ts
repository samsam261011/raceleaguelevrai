import { Chain } from "../chain";
import { medalsFrom, type MapDefinition } from "../world";

/**
 * Map 1 : « Le Grand Saut » (facile). Départ sur une double voie, grande courbe à fond,
 * montée douce vers le tremplin, long vol au-dessus du vide, enchaînement de grands virages et sprint final.
 */
const c = new Chain({ kind: "departLarge", x: 0, z: 0, level: 0, rot: 0 })
  .times(3, "routeLarge")
  .add("virageLarge", true)
  .times(2, "routeLarge")
  .add("checkpointLarge")
  .add("elargir", true)
  .add("route")
  .add("penteBas")
  .add("penteHaut")
  .times(6, "route")
  .add("tremplin")
  .gap(2)
  .times(8, "route")
  .add("virage3", true)
  .add("checkpoint")
  .add("chicaneG")
  .add("virage4", true)
  .add("route")
  .add("penteHaut", true)
  .add("penteBas", true)
  .add("virage3")
  .add("checkpoint")
  .times(2, "route")
  .add("virage2", true)
  .times(3, "route")
  .add("arrivee");

export const M1_GRAND_SAUT: MapDefinition = {
  id: "le-grand-saut",
  name: "Le Grand Saut",
  blocks: c.blocks,
  // Temps auteur : meilleur temps du pilote automatique (tests/maps.test.ts le vérifie)
  medals: medalsFrom(28.2),
};
