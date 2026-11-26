import * as THREE from "three";
import { col, loft, Mesher, mirrored } from "./geom";

/**
 * Voiture de la ligue : un prototype bas et large, roues avant découvertes (on les voit braquer),
 * monocoque profilée, pontons latéraux, aileron arrière sur deux mâts.
 * Dimensions réelles en mètres (environ 4,9 m de long, 2,6 m de large aux roues), sans mise à l'échelle.
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

const FRONT_Z = 1.55;
const REAR_Z = -1.45;

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

/** Bras de suspension : fin tube entre deux points. */
function rod(m: Mesher, a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.Color) {
  const d = b.clone().sub(a);
  const geo = new THREE.CylinderGeometry(r, r, d.length(), 5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.addGeometry(geo, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), color);
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
  // Monocoque : museau bas et pointu, cockpit reculé, capot moteur bossu
  loft(
    body,
    [
      section(2.78, 0.13, 0.19, 0.29, 0.35),
      section(2.25, 0.25, 0.16, 0.33, 0.45),
      section(1.5, 0.35, 0.14, 0.37, 0.55),
      section(0.75, 0.43, 0.13, 0.41, 0.66),
      section(0.0, 0.47, 0.12, 0.43, 0.7),
      section(-0.7, 0.45, 0.12, 0.45, 0.9),
      section(-1.5, 0.39, 0.14, 0.43, 0.7),
      section(-2.1, 0.27, 0.19, 0.38, 0.5),
    ],
    livery(primary, true),
  );
  // Pontons latéraux, prise d'air sombre à l'avant
  for (const s of [1, -1]) {
    loft(
      body,
      [section(0.62, 0.2, 0.17, 0.38, 0.47), section(0.25, 0.3, 0.14, 0.42, 0.54), section(-0.85, 0.28, 0.14, 0.41, 0.5), section(-1.55, 0.13, 0.2, 0.32, 0.37)],
      (i, k) => (i < 0 ? CARBON : livery(primary, false)(i, k)),
      new THREE.Vector3(s * 0.66, 0, 0),
    );
    // Rétroviseurs
    box(body, 0.16, 0.08, 0.06, s * 0.6, 0.66, 0.55, CARBON);
    rod(body, new THREE.Vector3(s * 0.45, 0.6, 0.55), new THREE.Vector3(s * 0.56, 0.66, 0.55), 0.015, CARBON);
  }
  // Pilote : casque blanc à visière sombre
  {
    const helmet = new THREE.IcosahedronGeometry(0.2, 1);
    body.addGeometry(helmet, new THREE.Matrix4().makeTranslation(0, 0.82, -0.1), STRIPE);
  }
  // Aileron avant : lame fine et dérives orange
  box(body, 2.2, 0.05, 0.5, 0, 0.15, 2.5, CARBON_LIGHT, -0.08);
  box(body, 2.0, 0.04, 0.24, 0, 0.24, 2.36, primary, -0.25);
  for (const s of [1, -1]) box(body, 0.04, 0.26, 0.62, s * 1.1, 0.22, 2.48, primary);
  // Aileron arrière sur deux mâts
  box(body, 1.95, 0.07, 0.52, 0, 1.0, -2.02, primary, 0.14);
  box(body, 1.95, 0.05, 0.26, 0, 1.13, -2.3, STRIPE, 0.42);
  for (const s of [1, -1]) {
    box(body, 0.05, 0.55, 0.78, s * 0.98, 0.98, -2.12, primary);
    box(body, 0.06, 0.5, 0.22, s * 0.22, 0.72, -1.95, CARBON, 0.12);
  }
  // Diffuseur et échappements
  box(body, 1.0, 0.1, 0.34, 0, 0.2, -2.02, CARBON);
  for (const s of [1, -1]) {
    const pipe = new THREE.CylinderGeometry(0.07, 0.08, 0.32, 8);
    body.addGeometry(pipe, new THREE.Matrix4().compose(new THREE.Vector3(s * 0.17, 0.47, -2.12), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)), CARBON_LIGHT);
  }
  // Suspensions : triangles fins entre la coque et les moyeux
  for (const s of [1, -1]) {
    for (const [z, hx] of [
      [FRONT_Z, 1.12],
      [REAR_Z, 1.08],
    ] as const) {
      const hub = new THREE.Vector3(s * (hx - 0.12), 0.42, z);
      rod(body, new THREE.Vector3(s * 0.36, 0.5, z + 0.25), hub, 0.025, CARBON);
      rod(body, new THREE.Vector3(s * 0.36, 0.5, z - 0.25), hub, 0.025, CARBON);
      rod(body, new THREE.Vector3(s * 0.36, 0.22, z + 0.2), hub.clone().setY(0.34), 0.025, CARBON);
      rod(body, new THREE.Vector3(s * 0.36, 0.22, z - 0.2), hub.clone().setY(0.34), 0.025, CARBON);
    }
  }

  // Pare-brise teinté autour du cockpit
  const glass = new Mesher();
  const gs = (z: number, w: number, y0: number, y1: number) => ({
    z,
    pts: mirrored([
      [w, y0],
      [w * 0.92, y1 - 0.06],
      [w * 0.55, y1],
      [w * 0.2, y1 + 0.01],
    ]),
  });
  loft(glass, [gs(0.95, 0.12, 0.6, 0.66), gs(0.62, 0.34, 0.63, 0.78), gs(0.4, 0.38, 0.65, 0.8)], col(0x1c1430));

  // Barre de feux arrière, pleine largeur
  const lights = new Mesher();
  box(lights, 1.0, 0.07, 0.03, 0, 0.37, -2.12, col(0xffffff));
  box(lights, 0.12, 0.12, 0.03, 0, 0.82, -2.33, col(0xffffff));

  return {
    body: body.geometry(),
    glass: glass.geometry(),
    lights: lights.geometry(),
    frontWheel: wheel(0.4, 0.34, col(0xffb23e)),
    rearWheel: wheel(0.44, 0.44, col(0xffb23e)),
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
  for (const [x, z, front] of [
    [-1.12, FRONT_Z, true],
    [1.12, FRONT_Z, true],
    [-1.08, REAR_Z, false],
    [1.08, REAR_Z, false],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, front ? 0.4 : 0.44, z);
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
