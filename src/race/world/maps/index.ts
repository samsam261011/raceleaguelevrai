import type { MapDefinition } from "../world";
import { GRAND_SAUT } from "./grandSaut";

/** Les maps officielles jouables. Les autres arriveront ici au fur et à mesure (faites avec l'éditeur). */
export const MAPS: Record<string, MapDefinition> = {
  [GRAND_SAUT.id]: GRAND_SAUT,
};

export const DEFAULT_MAP = GRAND_SAUT.id;
