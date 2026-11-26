import type { MapDefinition } from "../world";

/**
 * Labo physique : un circuit d'essai qui enchaîne chaque comportement de la voiture.
 * Bosse (montée puis descente), virages serrés en S, tremplin et réception, virage relevé,
 * looping, mur roulable. Médailles indicatives.
 */
export const LABO: MapDefinition = {
  id: "labo",
  name: "Labo physique",
  medals: { auteur: 20, or: 22, argent: 25, bronze: 30 },
  blocks: [
    { kind: "depart", x: 0, z: 0, level: 0, rot: 0 },
    { kind: "route", x: 0, z: 1, level: 0, rot: 0 },
    // Bosse : on monte de 4 m puis on redescend
    { kind: "pente", x: 0, z: 2, level: 0, rot: 0 },
    { kind: "pente", x: 0, z: 3, level: 0, rot: 2 },
    { kind: "checkpoint", x: 0, z: 4, level: 0, rot: 0 },
    // S serré : à droite puis à gauche
    { kind: "virage", x: 0, z: 5, level: 0, rot: 0 },
    { kind: "virage", x: 1, z: 5, level: 0, rot: 2 },
    { kind: "route", x: 1, z: 6, level: 0, rot: 0 },
    // Saut : tremplin, deux cases de vide, longue réception
    { kind: "tremplin", x: 1, z: 7, level: 0, rot: 0 },
    { kind: "route", x: 1, z: 10, level: 0, rot: 0 },
    { kind: "route", x: 1, z: 11, level: 0, rot: 0 },
    { kind: "route", x: 1, z: 12, level: 0, rot: 0 },
    { kind: "route", x: 1, z: 13, level: 0, rot: 0 },
    { kind: "route", x: 1, z: 14, level: 0, rot: 0 },
    { kind: "checkpoint", x: 1, z: 15, level: 0, rot: 0 },
    // Virage relevé vers l'est
    { kind: "virageReleve", x: 1, z: 16, level: 0, rot: 0 },
    { kind: "route", x: 3, z: 17, level: 0, rot: 1 },
    // Looping
    { kind: "looping", x: 4, z: 17, level: 0, rot: 1 },
    { kind: "route", x: 7, z: 18, level: 0, rot: 1 },
    { kind: "checkpoint", x: 8, z: 18, level: 0, rot: 1 },
    // Mur roulable
    { kind: "mur", x: 9, z: 18, level: 0, rot: 1 },
    { kind: "route", x: 13, z: 18, level: 0, rot: 1 },
    { kind: "arrivee", x: 14, z: 18, level: 0, rot: 1 },
  ],
};
