import * as THREE from "three";
import { WHEELS } from "../physics/constants";
import { col, loft, Mesher, mirrored } from "./geom";

/**
 * Voiture de la ligue : un bloc compact et anguleux, nez en coin, épaules larges sur de grosses roues,
 * bulle de cockpit sombre et aileron intégré à la poupe. Rien de fin ni de fragile.
 * Dimensions réelles en mètres (environ 4,6 m de long, 2,4 m de large aux roues).
 * Peu d'appels de dessin : carrosserie, vitrage, feux, 4 roues.
 */
export interface CarMesh {
  root: THREE.Group;
  /** La caisse (tangage léger à l'accélération et au freinage, jamais de roulis). */
  body: THREE.Group;
  wheels: THREE.Mesh[];
  /** Pivots des roues avant : ils tournent avec le volant. */
  steerPivots: THREE.Group[];
  /** Feux arrière (plus vifs au freinage). */
  lights: THREE.MeshBasicMaterial | null;
  /** Matériaux transparents du fantôme (pour le faire apparaître ou s'effacer). */
  fade: { mat: THREE.Material & { opacity: number }; base: number }[];
}

/** Couleur de carrosserie par rang (direction artistique). */
export const RANK_COLORS: Record<string, number> = {
  bronze: 0xc27a3c,
  argent: 0xc9d1db,
  or: 0xf2b632,
  diamant: 0x6fd3ff,
  emeraude: 0x2fbf71,
  master: 0x9b5cf6,
  pro: 0xff3d6e,
};

const CARBON = col(0x24232b);
const CARBON_LIGHT = col(0x3a3942);
const STRIPE = col(0xf6f3ee);

const FRONT_Z = WHEELS[0].z;
const REAR_Z = WHEELS[2].z;

interface Shapes {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  frontWheel: THREE.BufferGeometry;
  rearWheel: THREE.BufferGeometry;
}

function section(z: number, hw: number, yb: number, ym: number, yt: number) {
  return {
    z,
    pts: mirrored([
      [hw * 0.72, yb],
      [hw, yb + 0.1],
      [hw, ym],
      [hw * 0.7, yt],
      [hw * 0.28, yt + 0.025],
    ]),
  };
}

/** Couleur d'une face de coque selon sa place dans la section (bas carbone, flancs, bande blanche au centre). */
function livery(primary: THREE.Color, stripe: boolean) {
  return (_i: number, k: number) => {
    if (k === 4 && stripe) return STRIPE;
    if (k === 0 || k === 8 || k === 9) return CARBON;
    return primary;
  };
}

function box(m: Mesher, w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.Color, rx = 0, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1));
  m.addGeometry(geo, mat, color);
}

function wheel(r: number, w: number, accent: THREE.Color): THREE.BufferGeometry {
  const m = new Mesher();
  // Pneu : profil arrondi tourné autour de l'axe, à facettes
  const prof = [
    new THREE.Vector2(r * 0.64, -w / 2),
    new THREE.Vector2(r * 0.9, -w / 2),
    new THREE.Vector2(r, -w / 2 + 0.06),
    new THREE.Vector2(r, w / 2 - 0.06),
    new THREE.Vector2(r * 0.9, w / 2),
    new THREE.Vector2(r * 0.64, w / 2),
  ];
  const toAxisX = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
  m.addGeometry(new THREE.LatheGeometry(prof, 18), toAxisX, col(0x1d1c22));
  // Liseré orange sur le flanc extérieur
  const stripe = new THREE.LatheGeometry([new THREE.Vector2(r * 0.8, w / 2 + 0.004), new THREE.Vector2(r * 0.86, w / 2 + 0.004)], 18);
  m.addGeometry(stripe, toAxisX, accent);
  // Jante : disque en retrait, 5 branches, moyeu
  const disc = new THREE.CylinderGeometry(r * 0.64, r * 0.64, w * 0.8, 10, 1);
  m.addGeometry(disc, new THREE.Matrix4().makeRotationZ(Math.PI / 2), col(0x55545e));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(0.05, r * 0.55, 0.11);
    const mat = new THREE.Matrix4().compose(
      new THREE.Vector3(w * 0.42, Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-a, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    m.addGeometry(spoke, mat, col(0xe9e6e0));
  }
  const hub = new THREE.CylinderGeometry(r * 0.15, r * 0.18, 0.08, 8);
  m.addGeometry(hub, new THREE.Matrix4().compose(new THREE.Vector3(w * 0.44, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)), new THREE.Vector3(1, 1, 1)), accent);
  return m.geometry();
}

function shapes(primary: THREE.Color): Shapes {
  const body = new Mesher();
  // Un seul bloc : coin bas à l'avant, épaules larges posées sur les roues, poupe haute et carrée.
  // Les roues sont rentrées sous la carrosserie : seuls le bas et le flanc des pneus dépassent.
  loft(
    body,
    [
      section(2.36, 0.8, 0.26, 0.42, 0.48),
      section(2.0, 1.02, 0.22, 0.66, 0.72),
      section(1.2, 1.08, 0.2, 0.9, 0.96),
      section(0.5, 1.04, 0.2, 0.92, 1.0),
      section(-0.5, 1.04, 0.2, 0.94, 1.04),
      section(-1.3, 1.1, 0.2, 1.0, 1.08),
      section(-2.0, 1.04, 0.24, 0.98, 1.04),
      section(-2.24, 0.86, 0.3, 0.86, 0.92),
    ],
    livery(primary, true),
  );
  // Bas de caisse sombre : lame avant, prises d'air latérales entre les roues, diffuseur
  box(body, 1.8, 0.06, 0.42, 0, 0.2, 2.2, CARBON, -0.06);
  for (const s of [1, -1]) {
    box(body, 0.06, 0.26, 1.1, s * 1.05, 0.46, 0.0, CARBON);
    box(body, 0.05, 0.05, 1.7, s * 1.07, 0.72, 0.0, STRIPE);
  }
  box(body, 1.6, 0.18, 0.12, 0, 0.38, -2.25, CARBON);
  // Aileron court posé sur la poupe, sur deux dérives pleines
  box(body, 2.0, 0.08, 0.4, 0, 1.28, -1.98, primary, 0.1);
  box(body, 2.0, 0.05, 0.16, 0, 1.32, -2.17, STRIPE, 0.35);
  for (const s of [1, -1]) box(body, 0.1, 0.3, 0.6, s * 0.95, 1.14, -1.98, CARBON_LIGHT);

  // Bulle du cockpit, basse et fuyante, en verre sombre
  const glass = new Mesher();
  const gs = (z: number, w: number, y0: number, y1: number) => ({
    z,
    pts: mirrored([
      [w, y0],
      [w * 0.9, y1 - 0.05],
      [w * 0.55, y1],
      [w * 0.2, y1 + 0.01],
    ]),
  });
  loft(glass, [gs(1.0, 0.34, 0.97, 0.99), gs(0.5, 0.62, 0.99, 1.24), gs(-0.3, 0.64, 1.02, 1.28), gs(-0.9, 0.44, 1.04, 1.1)], col(0x1c1430));

  // Feux arrière : un bandeau sur toute la largeur
  const lights = new Mesher();
  box(lights, 1.6, 0.09, 0.03, 0, 0.66, -2.26, col(0xffffff));

  return {
    body: body.geometry(),
    glass: glass.geometry(),
    lights: lights.geometry(),
    frontWheel: wheel(WHEELS[0].r, WHEELS[0].w, col(0xffb23e)),
    rearWheel: wheel(WHEELS[2].r, WHEELS[2].w, col(0xffb23e)),
  };
}

interface Mats {
  body: THREE.Material;
  glass: THREE.Material;
  wheel: THREE.Material;
  lights: THREE.Material;
}

function assemble(sh: Shapes, mats: Mats, shadows: boolean): Omit<CarMesh, "fade" | "lights"> {
  const root = new THREE.Group();
  root.rotation.order = "YXZ";
  const body = new THREE.Group();
  root.add(body);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadows;
    parent.add(mesh);
    return mesh;
  };
  add(sh.body, mats.body, body);
  add(sh.glass, mats.glass, body);
  const l = add(sh.lights, mats.lights, body);
  l.castShadow = false;

  // Roues : en dehors de la caisse, pour qu'elles restent posées quand la caisse bouge
  const wheels: THREE.Mesh[] = [];
  const steerPivots: THREE.Group[] = [];
  for (const [x, z, front, r] of [
    [-WHEELS[0].x, FRONT_Z, true, WHEELS[0].r],
    [WHEELS[0].x, FRONT_Z, true, WHEELS[0].r],
    [-WHEELS[2].x, REAR_Z, false, WHEELS[2].r],
    [WHEELS[2].x, REAR_Z, false, WHEELS[2].r],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const w = add(front ? sh.frontWheel : sh.rearWheel, mats.wheel, pivot);
    // La géométrie de roue a sa face extérieure vers +x : on retourne celles de gauche
    if (x < 0) pivot.scale.x = -1;
    root.add(pivot);
    wheels.push(w);
    if (front) steerPivots.push(pivot);
  }
  return { root, body, wheels, steerPivots };
}

const shapeCache = new Map<number, Shapes>();
function shapesFor(color: number): Shapes {
  let s = shapeCache.get(color);
  if (!s) shapeCache.set(color, (s = shapes(col(color))));
  return s;
}

/** Voiture du joueur. Elle regarde vers +z. */
export function buildCarMesh(color: number = RANK_COLORS.or!): CarMesh {
  const sh = shapesFor(color);
  const lights = new THREE.MeshBasicMaterial({ color: 0xff2a1f, toneMapped: false });
  const parts = assemble(
    sh,
    {
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.12, flatShading: true }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.4, flatShading: true }),
      wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.2, flatShading: true }),
      lights,
    },
    true,
  );
  return { ...parts, lights, fade: [] };
}

/** Fantôme : la même voiture, bleutée et translucente, sans ombre. */
export function buildGhostMesh(): CarMesh {
  const sh = shapesFor(0x7fd4ff);
  const ghost = (opacity: number) =>
    new THREE.MeshLambertMaterial({ color: 0x9fe2ff, emissive: 0x1d5a80, transparent: true, opacity, depthWrite: false, vertexColors: true });
  const mats = { body: ghost(0.4), glass: ghost(0.3), wheel: ghost(0.3), lights: ghost(0.4) };
  const parts = assemble(sh, mats, false);
  const fade: CarMesh["fade"] = [];
  for (const m of new Set(Object.values(mats))) fade.push({ mat: m, base: m.opacity });
  return { ...parts, lights: null, fade };
}
