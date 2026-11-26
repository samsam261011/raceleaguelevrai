import type { Block, MapDefinition } from "../world";

const B = (kind: Block["kind"], x: number, z: number, rot = 0, level = 0): Block => ({ kind, x, z, rot, level });

/**
 * Map 1 : « Le Grand Saut ». Ligne droite, virage, montée, élan puis grand saut au-dessus du vide,
 * grand virage en hauteur, descente et sprint final.
 */
export const GRAND_SAUT: MapDefinition = {
  id: "grand-saut",
  name: "Le Grand Saut",
  blocks: [
    B("depart", 0, 0),
    B("route", 0, 1),
    B("route", 0, 2),
    B("virage2", 0, 3),
    B("route", 2, 4, 1),
    B("pente", 3, 4, 1),
    B("route", 4, 4, 1, 2),
    B("route", 5, 4, 1, 2),
    B("checkpoint", 6, 4, 1, 2),
    B("tremplin", 7, 4, 1, 2),
    // deux cases de vide
    B("route", 10, 4, 1, 2),
    B("route", 11, 4, 1, 2),
    B("route", 12, 4, 1, 2),
    B("virage3", 13, 4, 1, 2),
    B("pente", 15, 1, 0, 0),
    B("route", 15, 0, 2),
    B("checkpoint", 15, -1, 2),
    B("route", 15, -2, 2),
    B("route", 15, -3, 2),
    B("route", 15, -4, 2),
    B("arrivee", 15, -5, 2),
  ],
  // Sans booster depuis le moteur v3 : temps provisoires, à refaire à la main
  medals: { auteur: 12.9, or: 13.5, argent: 14.6, bronze: 16.9 },
};
