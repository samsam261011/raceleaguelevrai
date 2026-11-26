/**
 * Réglages de la voiture. Toute la sensation de pilotage se joue ici.
 * Le jeu avance à 120 pas par seconde (une entrée clavier par pas), quel que soit l'écran ;
 * chaque pas est découpé en sous-pas de physique pour des contacts précis à haute vitesse.
 */
export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;
export const SUBSTEPS = 2;

/** Vitesse max au moteur en m/s (75 m/s = 270 km/h). */
export const VMAX = 75;
/** Accélération moteur à l'arrêt (m/s²). Elle diminue en approchant de VMAX. */
export const ENGINE = 36;
/** Freinage (m/s²). */
export const BRAKE = 60;
/** Marche arrière. */
export const REVERSE_ACCEL = 14;
export const REVERSE_MAX = 12;
/** Frottements quand on roule (fraction de vitesse perdue par pas de jeu). */
export const ROLL_DRAG = 0.001;
/** Au-dessus de VMAX (après un booster), la vitesse redescend doucement (par seconde). */
export const OVERSPEED_DRAG = 0.35;
/** Booster : poussée (m/s²) et vitesse max atteignable. */
export const BOOST_ACCEL = 70;
export const VMAX_BOOST = 100;

/** Vitesse de rotation max visée au volant (rad/s) ; l'angle des roues en découle selon la vitesse. */
export const STEER_MAX = 1.3;
/** Temps pour braquer à fond (le volant n'est pas instantané). */
export const STEER_RESPONSE = 6;
/** Empattement (m) et braquage max des roues (rad). */
export const WHEELBASE = 3;
export const MAX_WHEEL_ANGLE = 0.55;
/** Adhérence des pneus (rapport entre force latérale max et charge). */
export const TIRE_GRIP = 3.2;

/** Gravité (un peu plus forte que la vraie, pour des sauts nerveux). */
export const GRAVITY = 26;
/** Appui aérodynamique : accélération vers la piste par m/s de vitesse. */
export const DOWNFORCE = 0.3;
/** Contrôle en l'air : vitesse de rotation visée au volant (rad/s), et redressement automatique. */
export const AIR_STEER = 1.2;
export const AIR_LEVEL = 3;
export const ANGULAR_DAMPING = 0.6;

/** Caisse : masse (kg), boîte de collision [demi-largeur, demi-hauteur, demi-longueur, hauteur du centre]. */
export const MASS = 1000;
export const HULL: readonly [number, number, number, number] = [1.25, 0.3, 2.4, 0.8];
/** Centre de gravité bas : la voiture ne bascule pas en virage. */
export const CENTER_OF_MASS_Y = 0.3;
/** Inertie [tangage, lacet, roulis] : un roulis très résistant, pour une voiture qui reste à plat. */
export const INERTIA: readonly [number, number, number] = [2600, 2600, 2600];
export const HULL_FRICTION = 0.25;
export const ROAD_FRICTION = 0.6;

/** Suspension : longueur au repos, enfoncement au repos, raideur, amortissement, débattement (m). */
export const SUSPENSION_REST = 0.35;
export const SUSPENSION_SAG = 0.1;
export const SUSPENSION_STIFFNESS = 65;
export const SUSPENSION_COMPRESSION = 4.5;
export const SUSPENSION_RELAXATION = 5.5;
export const SUSPENSION_TRAVEL = 0.3;

/** Épaisseur des parapets, pris sur la largeur de la route, et leur hauteur. */
export const WALL_INSET = 0.6;
export const WALL_HEIGHT = 1;
/** Contact avec un parapet : glisse et rebond. */
export const WALL_FRICTION = 0.15;
export const WALL_BOUNCE = 0.15;
