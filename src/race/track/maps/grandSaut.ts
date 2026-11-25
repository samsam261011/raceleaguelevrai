import type { MapDefinition } from "../types";

/**
 * Map 1 : « Le Grand Saut ».
 * Ligne droite, grande courbe, S rapide, tremplin au-dessus du vide, puis un long virage jusqu'à l'arrivée.
 */
export const GRAND_SAUT: MapDefinition = {
  id: "grand-saut",
  name: "Le Grand Saut",
  points: [
    { x: 0, y: 0, z: -10 },
    { x: 0, y: 0, z: 30 },
    { x: 0, y: 0, z: 80 },
    { x: 8, y: 0.5, z: 120 },
    { x: 35, y: 1, z: 150 },
    { x: 75, y: 1.5, z: 162 },
    { x: 115, y: 2, z: 172 },
    { x: 145, y: 2.5, z: 198 },
    { x: 152, y: 3, z: 235 },
    { x: 135, y: 3, z: 268 },
    { x: 100, y: 3, z: 288 },
    { x: 65, y: 3, z: 300 },
    { x: 44, y: 4, z: 304, width: 12 },
    // Tremplin : le point suivant (invisible, au-dessus du vide) donne l'angle de décollage.
    { x: 28, y: 7.5, z: 305, width: 12, gap: true },
    { x: 14, y: 10, z: 305, width: 12, gap: true },
    { x: 2, y: 6, z: 305, width: 18 },
    { x: -22, y: 4.5, z: 304 },
    { x: -44, y: 4, z: 300 },
    { x: -72, y: 4, z: 288 },
    { x: -92, y: 4, z: 258 },
    { x: -98, y: 3, z: 220 },
    { x: -112, y: 2.5, z: 182 },
    { x: -138, y: 2, z: 150 },
    { x: -150, y: 1.5, z: 112 },
    { x: -140, y: 1, z: 76 },
    { x: -112, y: 0.5, z: 52 },
    { x: -80, y: 0, z: 40 },
    { x: -55, y: 0, z: 36 },
  ],
  checkpoints: [0.24, 0.5, 0.74],
  // Calibrées avec le pilote automatique (≈ 21,1 s) : l'Auteur demande une trajectoire parfaite.
  medals: { auteur: 20.2, or: 21.4, argent: 23, bronze: 26 },
};
