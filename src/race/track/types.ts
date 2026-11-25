/** Un point de contrôle posé à la main par le créateur de la map. */
export interface ControlPoint {
  x: number;
  y: number;
  z: number;
  /** Largeur de la piste en mètres (22 par défaut). */
  width?: number;
  /** Le tronçon qui part de ce point est un trou : il faut le sauter. */
  gap?: boolean;
}

export interface MapDefinition {
  id: string;
  name: string;
  /** Points de passage de la piste, du départ à l'arrivée. */
  points: ControlPoint[];
  /** Position des checkpoints, en fraction de la longueur totale (0 à 1). */
  checkpoints: number[];
  /** Temps des médailles, en secondes. */
  medals: { auteur: number; or: number; argent: number; bronze: number };
}

/** La piste échantillonnée, prête pour la physique et l'affichage. */
export interface Track {
  def: MapDefinition;
  count: number;
  /** Position du centre de la piste. */
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  /** Direction de la piste (vecteur unitaire au sol). */
  tx: Float64Array;
  tz: Float64Array;
  /** Distance depuis le départ, en mètres. */
  dist: Float64Array;
  width: Float64Array;
  /** 1 si le tronçon [i, i+1] a un sol, 0 si c'est un trou. */
  solid: Uint8Array;
  length: number;
  /** Distance de chaque checkpoint depuis le départ. */
  checkpointDist: number[];
  /** Point le plus bas de la piste (sert à détecter les chutes). */
  minY: number;
}
