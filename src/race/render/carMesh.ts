import * as THREE from "three";

export interface CarMesh {
  root: THREE.Group;
  wheels: THREE.Mesh[];
  /** Matériaux transparents du fantôme (pour le faire apparaître ou s'effacer). */
  fade: { mat: THREE.Material & { opacity: number }; base: number }[];
}

const SCALE = 1.35;

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

  add(new THREE.BoxGeometry(2.1, 0.7, 4.3), body, 0, 0.75, 0);
  add(new THREE.BoxGeometry(1.9, 0.35, 1.2), body, 0, 0.55, 2.4);
  add(new THREE.BoxGeometry(1.6, 0.65, 1.8), dark, 0, 1.4, -0.3);
  add(new THREE.BoxGeometry(2.3, 0.12, 0.5), body, 0, 1.45, -2.1);
  add(new THREE.BoxGeometry(0.12, 0.45, 0.4), dark, -0.8, 1.2, -2.1);
  add(new THREE.BoxGeometry(0.12, 0.45, 0.4), dark, 0.8, 1.2, -2.1);
  if (!edges) for (const x of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.45, 0.18, 0.1), light, x, 0.8, 2.16);

  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1.1, 1.45], [1.1, 1.45], [-1.1, -1.45], [1.1, -1.45]] as const) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.5, z);
    car.add(w);
    wheels.push(w);
  }

  const fade: CarMesh["fade"] = [];
  for (const m of [body, dark, edges]) {
    if (m && m.transparent) fade.push({ mat: m, base: m.opacity });
  }
  return { root, wheels, fade };
}
