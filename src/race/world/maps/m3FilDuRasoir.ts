import { Chain } from "../chain";
import { medalsFrom, type MapDefinition } from "../world";

/**
 * Map 3 : « Fil du Rasoir » (moyen). Une route étroite perchée à 12 m : chicanes et virages enchaînés
 * qu'on passe à fond en frôlant les parapets. Pas une seconde de répit.
 */
const c = new Chain({ kind: "depart", x: 0, z: 0, level: 6, rot: 0 })
  .times(3, "route")
  .add("chicane")
  .add("chicaneG")
  .add("virage3", true)
  .add("virage3")
  .add("checkpoint")
  .add("virage2", true)
  .add("route")
  .add("virage2", true)
  .add("chicaneG")
  .add("virage4")
  .add("checkpoint")
  .add("virage2")
  .add("virage2", true)
  .add("route")
  .add("virage3", true)
  .add("chicane")
  .add("checkpoint")
  .add("virage3")
  .times(2, "route")
  .add("arrivee");

export const M3_FIL_DU_RASOIR: MapDefinition = {
  id: "fil-du-rasoir",
  name: "Fil du Rasoir",
  blocks: c.blocks,
  // Temps auteur : meilleur temps du pilote automatique (tests/maps.test.ts le vérifie)
  medals: medalsFrom(27.7),
};
