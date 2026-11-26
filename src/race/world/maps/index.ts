import type { MapDefinition } from "../world";
import { LABO } from "./labo";
import { M1_GRAND_SAUT } from "./m1GrandSaut";
import { M2_SPIRALE } from "./m2Spirale";
import { M3_FIL_DU_RASOIR } from "./m3FilDuRasoir";
import { M4_DOUBLE_BOUCLE } from "./m4DoubleBoucle";
import { M5_LA_CHUTE } from "./m5LaChute";
import { M6_SERPENTIN } from "./m6Serpentin";
import { M7_PONT_CASSE } from "./m7PontCasse";
import { M8_TREMPLIN } from "./m8Tremplin";

/** Les maps officielles, dans l'ordre du menu. Les suivantes arriveront ici au fur et à mesure (faites avec l'éditeur). */
export const OFFICIAL_MAPS: MapDefinition[] = [M1_GRAND_SAUT, M2_SPIRALE, M3_FIL_DU_RASOIR, M4_DOUBLE_BOUCLE, M5_LA_CHUTE, M6_SERPENTIN, M7_PONT_CASSE, M8_TREMPLIN];

/** Toutes les maps jouables, par identifiant (race.html?map=…). Le labo sert aux essais de physique. */
export const MAPS: Record<string, MapDefinition> = Object.fromEntries([...OFFICIAL_MAPS, LABO].map((m) => [m.id, m]));

export const DEFAULT_MAP = M1_GRAND_SAUT.id;
