import { Chain } from "../chain";
import { medalsFrom, type MapDefinition } from "../world";

/**
 * Map 4 : « Double Boucle » (moyen). Deux loopings, un mur à prendre en appui et de grandes courbes
 * entre les deux. Il faut arriver vite dans chaque boucle.
 */
const c = new Chain({ kind: "depart", x: 0, z: 0, level: 0, rot: 0 })
  .times(5, "route")
  .add("looping")
  .times(2, "route")
  .add("checkpoint")
  .add("virage3")
  .times(2, "route")
  .add("mur")
  .add("route")
  .add("virage3")
  .add("checkpoint")
  .times(4, "route")
  .add("looping")
  .times(2, "route")
  .add("virage4", true)
  .add("checkpoint")
  .times(2, "route")
  .add("arrivee");

export const M4_DOUBLE_BOUCLE: MapDefinition = {
  id: "double-boucle",
  name: "Double Boucle",
  blocks: c.blocks,
  // Temps auteur : meilleur temps du pilote automatique (tests/maps.test.ts le vérifie)
  medals: medalsFrom(23.6),
};
