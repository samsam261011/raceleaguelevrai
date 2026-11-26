import { Chain } from "../chain";
import { medalsFrom, type MapDefinition } from "../world";

/**
 * Map 7 : « Pont Cassé » (difficile). Un viaduc à 20 m dont il manque des morceaux :
 * il faut arriver vite à chaque trou pour sauter par-dessus, en restant dans l'axe.
 */
const c = new Chain({ kind: "depart", x: 0, z: 0, level: 10, rot: 0 })
  .times(5, "route")
  .gap(1, 1)
  .times(3, "route")
  .add("virage3", true)
  .add("checkpoint")
  .times(2, "route")
  .add("tremplin")
  .gap(2, 1)
  .times(8, "route")
  .add("virage3")
  .add("route")
  .gap(1, 1)
  .add("checkpoint")
  .times(2, "route")
  .add("virage4", true)
  .times(3, "route")
  .gap(1, 1)
  .times(2, "route")
  .add("checkpoint")
  .add("route")
  .add("tremplin")
  .gap(2, 1)
  .times(8, "route")
  .add("arrivee");

export const M7_PONT_CASSE: MapDefinition = {
  id: "pont-casse",
  name: "Pont Cassé",
  blocks: c.blocks,
  // Temps auteur : meilleur temps du pilote automatique (tests/maps.test.ts le vérifie)
  medals: medalsFrom(25.2),
};
