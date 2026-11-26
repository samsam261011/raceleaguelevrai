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
/** Accélération moteur (m/s²). Elle reste forte longtemps et ne s'éteint qu'en approchant de VMAX. */
export const ENGINE = 19;
/** Temps pour que l'accélérateur donne toute sa poussée (s) : le départ monte en puissance au lieu de bondir. */
export const THROTTLE_RAMP = 0.45;
/** Freinage (m/s²). */
export const BRAKE = 60;
/** Marche arrière. */
export const REVERSE_ACCEL = 14;
export const REVERSE_MAX = 12;
/** Frottements quand on roule (fraction de vitesse perdue par pas de jeu). */
export const ROLL_DRAG = 0.001;
/** Au-dessus de VMAX (en descente), la vitesse redescend doucement (par seconde). */
export const OVERSPEED_DRAG = 0.35;

/** Vitesse de rotation max visée au volant (rad/s) ; l'angle des roues en découle selon la vitesse. */
export const STEER_MAX = 1.3;
/** Temps pour braquer à fond (le volant n'est pas instantané). */
export const STEER_RESPONSE = 6;
/** Empattement (m) et braquage max des roues (rad). */
export const WHEELBASE = 3;
export const MAX_WHEEL_ANGLE = 0.55;
/** Adhérence des pneus (rapport entre force latérale max et charge). */
export const TIRE_GRIP = 3.2;

/** Gravité au sol (un peu plus forte que la vraie : la voiture colle à la piste). */
export const GRAVITY = 26;
/** Gravité ressentie en l'air : bien plus faible, pour des sauts longs et planés. */
export const AIR_GRAVITY = 13;
/** Appui aérodynamique : accélération vers la piste par m/s de vitesse. */
export const DOWNFORCE = 0.3;
/** Contrôle en l'air : vitesse de rotation visée au volant (rad/s), et redressement automatique. */
export const AIR_STEER = 0.7;
/** Vitesse à laquelle la rotation en l'air rejoint celle demandée (par seconde) : basse = doux. */
export const AIR_STEER_RESPONSE = 3;
/** Frein en l'air : la voiture cesse de tourner, se met à plat et s'aligne sur sa trajectoire, sans perdre de vitesse (par seconde). */
export const AIR_BRAKE_RESPONSE = 4;
export const AIR_LEVEL = 3;
/** En l'air, vitesse à laquelle le tangage est annulé (pas de plongeon) et le roulis corrigé (par seconde). */
export const AIR_PITCH_RESPONSE = 40;
export const AIR_ROLL_RESPONSE = 6;
export const ANGULAR_DAMPING = 0.6;
/** Anti-roulis au sol : vitesse de redressement par unité d'inclinaison (rad/s), et réactivité (par seconde). */
export const ANTI_ROLL = 12;
export const ANTI_ROLL_RESPONSE = 20;

/** Voiture retournée : sous ce « haut » (1 = à plat, 0 = sur le flanc) et cette vitesse (m/s) pendant ce temps (s), on la remet sur ses roues, un peu plus haut (m). */
export const STUCK_UP = 0.3;
export const STUCK_SPEED = 3;
export const STUCK_TIME = 1;
export const STUCK_LIFT = 1.2;

/** Caisse : masse (kg), boîte de collision [demi-largeur, demi-hauteur, demi-longueur, hauteur du centre]. */
export const MASS = 1000;
export const HULL: readonly [number, number, number, number] = [1.1, 0.3, 2.4, 0.85];
/** Centre de gravité bas : la voiture ne bascule pas en virage. */
export const CENTER_OF_MASS_Y = 0.3;
/** Inertie [tangage, lacet, roulis] : un roulis très résistant, pour une voiture qui reste à plat. */
export const INERTIA: readonly [number, number, number] = [2600, 2600, 2600];
export const HULL_FRICTION = 0.25;
/** Arrondi des arêtes de la caisse (m). */
export const HULL_ROUND = 0.2;
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
/** Choc contre un parapet : part de la vitesse perdue en le prenant de face (moins en biais). */
export const WALL_IMPACT = 0.4;
/** Vitesse conservée à chaque pas passé contre un parapet. */
export const WALL_SPEED_KEEP = 0.994;

/** Roues dans le repère de la voiture (+x à gauche, +z vers l'avant) : avant gauche, avant droite, arrière gauche, arrière droite. Rayon et largeur (m). */
export const WHEELS = [
  { x: 1.0, z: 1.55, r: 0.47, w: 0.42, front: true },
  { x: -1.0, z: 1.55, r: 0.47, w: 0.42, front: true },
  { x: 0.98, z: -1.45, r: 0.51, w: 0.5, front: false },
  { x: -0.98, z: -1.45, r: 0.51, w: 0.5, front: false },
] as const;
