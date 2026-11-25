/**
 * Réglages de la voiture. Toute la sensation de pilotage se joue ici.
 * La physique tourne à 120 pas par seconde, quel que soit l'écran.
 */
export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;

/** Vitesse max en m/s (60 m/s = 216 km/h). */
export const VMAX = 60;
/** Accélération moteur à l'arrêt (m/s²). Elle diminue en approchant de VMAX. */
export const ENGINE = 30;
/** Freinage (m/s²). */
export const BRAKE = 55;
/** Marche arrière. */
export const REVERSE_ACCEL = 14;
export const REVERSE_MAX = 12;
/** Frottements quand on lâche tout (fraction de vitesse perdue par pas). */
export const ROLL_DRAG = 0.0012;
/** Vitesse de rotation max du volant (rad/s). */
export const STEER_MAX = 1.25;
/** Temps pour braquer à fond (le volant n'est pas instantané). */
export const STEER_RESPONSE = 6;
/** Adhérence latérale : part de la glisse conservée à chaque pas. */
export const GRIP_KEEP = 0.88;
/** Gravité (un peu plus forte que la vraie, pour des sauts nerveux). */
export const GRAVITY = 26;
/** Contrôle en l'air (rotation). */
export const AIR_STEER = 0.4;
/** Distance sous la piste à partir de laquelle on considère que la voiture est tombée. */
export const FALL_DEPTH = 25;

/** Demi-largeur de la voiture : distance entre son centre et un rebord quand elle le touche. */
export const CAR_HALF_WIDTH = 1.4;
/** Hauteur des rebords sur les côtés de la piste. */
export const WALL_HEIGHT = 1.1;
/** Vitesse conservée à chaque pas passé contre un rebord. */
export const WALL_SPEED_KEEP = 0.994;
/** Rebond quand on tape un rebord (part de la vitesse latérale renvoyée). */
export const WALL_BOUNCE = 0.15;
