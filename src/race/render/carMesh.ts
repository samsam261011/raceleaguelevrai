import * as THREE from "three";

export interface CarMesh {
  root: THREE.Group;
  /** La caisse (penche un peu en montée et en descente, jamais sur le côté). */
  body: THREE.Group;
  wheels: THREE.Mesh[];
  /** Pivots des roues avant : ils tournent avec le volant. */
  steerPivots: THREE.Group[];
  /** Matériaux transparents du fantôme (pour le faire apparaître ou s'effacer). */
  fade: { mat: THREE.Material & { opacity: number }; base: number }[];
}

const SCALE = 1.35;
const rimMat = new THREE.MeshLambertMaterial({ color: 0xc9ccd4, flatShading: true });

/** Voiture low-poly. Elle regarde vers +z. */
export function buildCarMesh(color: number): CarMesh {
  return build(
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x1c1430, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0xfff1c0, emissive: 0x806020 }),
    null,
  );
}

/** Fantôme : voiture bleutée translucide avec un contour lumineux. */
export function buildGhostMesh(): CarMesh {
  const body = new THREE.MeshLambertMaterial({ color: 0x7fd4ff, emissive: 0x1a4a70, transparent: true, opacity: 0.38, depthWrite: false });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a7fb0, emissive: 0x0a2a40, transparent: true, opacity: 0.3, depthWrite: false });
  const edges = new THREE.LineBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.85, depthWrite: false });
  return build(body, dark, body, edges);
}

function build(body: THREE.Material, dark: THREE.Material, light: THREE.Material, edges: THREE.LineBasicMaterial | null): CarMesh {
  const root = new THREE.Group();
  root.rotation.order = "YXZ";
  const car = new THREE.Group();
  car.scale.setScalar(SCALE);
  root.add(car);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    car.add(m);
    if (edges) {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edges);
      l.position.copy(m.position);
      car.add(l);
    }
    return m;
  };

  // Caisse étroite à l'avant (museau) : les roues avant sont à l'air libre et visibles depuis la caméra
  add(new THREE.BoxGeometry(1.7, 0.7, 3.0), body, 0, 0.75, -0.65);
  add(new THREE.BoxGeometry(1.05, 0.5, 1.9), body, 0, 0.65, 1.75);
  add(new THREE.BoxGeometry(2.0, 0.12, 0.55), body, 0, 0.42, 2.55);
  add(new THREE.BoxGeometry(1.2, 0.5, 1.6), body, 0, 1.33, -0.7);
  add(new THREE.BoxGeometry(1.0, 0.32, 0.08), dark, 0, 1.36, 0.12);
  add(new THREE.BoxGeometry(2.1, 0.12, 0.5), body, 0, 1.3, -2.1);
  add(new THREE.BoxGeometry(0.12, 0.3, 0.4), dark, -0.7, 1.1, -2.1);
  add(new THREE.BoxGeometry(0.12, 0.3, 0.4), dark, 0.7, 1.1, -2.1);
  if (!edges) for (const x of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.3, 0.14, 0.1), light, x, 0.72, 2.71);

  // Roues larges qui dépassent de la caisse : on voit les roues avant tourner depuis la caméra
  const wheels: THREE.Mesh[] = [];
  const steerPivots: THREE.Group[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.62, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.64, 8);
  rimGeo.rotateZ(Math.PI / 2);
  for (const [x, z, front] of [[-1.5, 1.5, true], [1.5, 1.5, true], [-1.35, -1.5, false], [1.35, -1.5, false]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.55, z);
    const w = new THREE.Mesh(wheelGeo, dark);
    const rim = new THREE.Mesh(rimGeo, edges ? dark : rimMat);
    w.add(rim);
    pivot.add(w);
    car.add(pivot);
    wheels.push(w);
    if (front) steerPivots.push(pivot);
  }

  const fade: CarMesh["fade"] = [];
  for (const m of [body, dark, edges]) {
    if (m && m.transparent) fade.push({ mat: m, base: m.opacity });
  }
  return { root, body: car, wheels, steerPivots, fade };
}
