import { Chain } from "../chain";
import { medalsFrom, type MapDefinition } from "../world";

/**
 * Map 6 : « Serpentin » (moyen). Des courbes qui s'enchaînent sans fin, à gauche, à droite,
 * avec une section à double voie pour choisir sa trajectoire.
 */
const c = new Chain({ kind: "departLarge", x: 0, z: 0, level: 0, rot: 0 })
  .times(2, "routeLarge")
  .add("grandVirageLarge")
  .add("grandVirageLarge", true)
  .add("checkpointLarge")
  .add("virageLarge", true)
  .add("virageLarge")
  .add("elargir", true)
  .add("chicane")
  .add("virage3")
  .add("checkpoint")
  .add("virage3", true)
  .add("chicaneG")
  .add("virage4", true)
  .add("virage2")
  .add("checkpoint")
  .add("virage3")
  .add("route")
  .add("elargir")
  .add("grandVirageLarge", true)
  .add("routeLarge")
  .add("arriveeLarge");

export const M6_SERPENTIN: MapDefinition = {
  id: "serpentin",
  name: "Serpentin",
  blocks: c.blocks,
  // Temps auteur : meilleur temps du pilote automatique (tests/maps.test.ts le vérifie)
  medals: medalsFrom(28.4),
};
