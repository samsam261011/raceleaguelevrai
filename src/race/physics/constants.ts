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
export const STEER_MAX = 2.3;
/** Temps pour braquer à fond (le volant n'est pas instantané). */
export const STEER_RESPONSE = 9;
/** Adhérence latérale : part de la glisse conservée à chaque pas. */
export const GRIP_KEEP = 0.86;
/** Adhérence pendant un drift. */
export const DRIFT_GRIP_KEEP = 0.988;
export const DRIFT_STEER_BOOST = 1.45;
export const DRIFT_DRAG = 0.0009;
/** Gravité (un peu plus forte que la vraie, pour des sauts nerveux). */
export const GRAVITY = 26;
/** Contrôle en l'air (rotation). */
export const AIR_STEER = 0.6;
/** Distance sous la piste à partir de laquelle on considère que la voiture est tombée. */
export const FALL_DEPTH = 25;
