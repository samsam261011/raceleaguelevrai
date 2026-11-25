import type { MapDefinition } from "../types";
import { GRAND_SAUT } from "./grandSaut";

/** Les maps jouables. Les 19 autres maps du menu arriveront ici au fur et à mesure. */
export const MAPS: Record<string, MapDefinition> = {
  [GRAND_SAUT.id]: GRAND_SAUT,
};

export const DEFAULT_MAP = GRAND_SAUT.id;
