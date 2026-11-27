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
/**
 * Temps pour que l'accélérateur donne toute sa poussée (s).
 * À l'arrêt, la réponse est quasi immédiate ; lancée, la poussée monte plus doucement
 * pour que l'arrière (propulsion) ne décroche pas quand on remet les gaz, par exemple à la réception d'un saut.
 */
export const THROTTLE_RAMP_START = 0.12;
export const THROTTLE_RAMP = 0.45;
/** Vitesse (m/s) à partir de laquelle la montée des gaz est la plus douce. */
export const THROTTLE_RAMP_SPEED = 20;
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
/** Un peu plus d'adhérence à l'arrière : à la limite, la voiture élargit (sous-virage) au lieu de partir en tête-à-queue. */
export const TIRE_GRIP_REAR = 3.6;

/** Gravité (m/s²), la même partout. Assez faible pour des sauts longs ; l'adhérence à vitesse vient de l'appui. */
export const GRAVITY = 13;
/** Appui aérodynamique : accélération vers le bas de la voiture, par m/s de vitesse (roues au sol). */
export const DOWNFORCE = 0.3;
/** Aide au contre-braquage : angle de roue ajouté par unité de dérive, et plafond (rad). */
export const COUNTER_STEER = 0.6;
export const COUNTER_STEER_MAX = 0.25;
/** En l'air : vitesse de lacet visée au volant (rad/s) et réactivité (par seconde). */
export const AIR_STEER = 0.7;
export const AIR_STEER_RESPONSE = 3;
/**
 * En l'air, le volant ne peut pas écarter le nez de la trajectoire de plus de cet angle (sinus de ~12°).
 * Sans limite, tenir une touche pendant un long saut faisait tourner la voiture de 60 à 80° :
 * elle se posait en travers et perdait presque toute sa vitesse.
 */
export const AIR_YAW_LIMIT = 0.2;
/** En l'air : amortissement du tangage et du roulis (par seconde), et de toutes les rotations quand on freine. */
export const AIR_PITCH_DAMPING = 30;
export const AIR_ROLL_DAMPING = 4;
export const AIR_BRAKE_DAMPING = 6;
export const ANGULAR_DAMPING = 0.6;
/** Barres anti-roulis : force par mètre d'écart de suspension entre la roue gauche et la droite (en g/m). */
export const ANTI_ROLL_BAR = 60;

/** Voiture retournée : sous ce « haut » (1 = à plat, 0 = sur le flanc) et cette vitesse (m/s) pendant ce temps (s), on la remet sur ses roues, un peu plus haut (m). */
export const STUCK_UP = 0.3;
export const STUCK_SPEED = 3;
export const STUCK_TIME = 1;
export const STUCK_LIFT = 1.2;

/** Caisse : masse (kg), boîte de collision [demi-largeur, demi-hauteur, demi-longueur, hauteur du centre]. */
export const MASS = 1000;
export const HULL: readonly [number, number, number, number] = [1.1, 0.3, 2.4, 0.85];
/**
 * Pare-chocs : deux boudins le long des flancs, à hauteur des roues, qui ne touchent que les obstacles (parapets, pylônes), jamais la route.
 * Comme une vraie voiture, ce sont eux (roues et boucliers) qui heurtent un mur, près du centre de gravité :
 * le choc fait pivoter et rebondir la voiture sans la coucher. [demi-largeur hors tout, rayon, demi-longueur, hauteur du centre]
 */
export const BUMPER: readonly [number, number, number, number] = [1.22, 0.25, 2.45, 0.47];
/** Centre de gravité bas : la voiture ne bascule pas en virage. */
export const CENTER_OF_MASS_Y = 0.3;
/** Inertie [tangage, lacet, roulis] : un roulis très résistant, pour une voiture qui reste à plat. */
export const INERTIA: readonly [number, number, number] = [2600, 2600, 2600];
export const HULL_FRICTION = 0.25;
/** Arrondi des arêtes de la caisse (m). */
export const HULL_ROUND = 0.2;
export const ROAD_FRICTION = 0.6;

/**
 * Suspension : longueur libre, enfoncement au repos (= GRAVITY / (4 × raideur)), raideur, amortissement, débattement (m).
 * La roue ne touche plus le sol au-delà de la longueur libre : l'enfoncement au repos est donc aussi
 * ce que la roue peut descendre pour suivre un creux ou une crête sans décoller.
 */
export const SUSPENSION_REST = 0.45;
export const SUSPENSION_SAG = 0.2;
export const SUSPENSION_STIFFNESS = 16.25;
/** Butée : sous cette longueur de suspension (m), la suspension durcit et amortit beaucoup plus (elle absorbe le choc au lieu de le renvoyer). */
export const BUMP_STOP = 0.12;
export const BUMP_STIFFNESS = 2.5;
export const BUMP_DAMPING = 4;
export const SUSPENSION_COMPRESSION = 4;
export const SUSPENSION_RELAXATION = 6;
export const SUSPENSION_TRAVEL = 0.42;

/** Épaisseur des parapets, pris sur la largeur de la route, et leur hauteur. */
export const WALL_INSET = 0.6;
export const WALL_HEIGHT = 1;
/** Contact avec un parapet : glisse et rebond. */
export const WALL_FRICTION = 0.15;
export const WALL_BOUNCE = 0.25;
/*
 * Pas de règle spéciale pour les chocs : la perte de vitesse, le rebond et la rotation viennent du moteur physique
 * (rebond et frottement ci-dessus, pare-chocs bas BUMPER, adhérence des pneus). Ancien réglage retiré le 27/11 :
 * perte de vitesse forcée au choc, ralentissement forcé contre le mur, montée et roulis bridés.
 */

/** Roues dans le repère de la voiture (+x à gauche, +z vers l'avant) : avant gauche, avant droite, arrière gauche, arrière droite. Rayon et largeur (m). */
export const WHEELS = [
  { x: 1.0, z: 1.55, r: 0.47, w: 0.42, front: true },
  { x: -1.0, z: 1.55, r: 0.47, w: 0.42, front: true },
  { x: 0.98, z: -1.45, r: 0.51, w: 0.5, front: false },
  { x: -0.98, z: -1.45, r: 0.51, w: 0.5, front: false },
] as const;
