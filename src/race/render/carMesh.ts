import * as THREE from "three";

export interface CarMesh {
  root: THREE.Group;
  wheels: THREE.Mesh[];
}

/** Voiture low-poly. Elle regarde vers +z. */
export function buildCarMesh(color: number, ghost = false): CarMesh {
  const root = new THREE.Group();
  root.rotation.order = "YXZ";
  const body = ghost
    ? new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.35, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color, flatShading: true });
  const dark = ghost ? body : new THREE.MeshLambertMaterial({ color: 0x1c1430, flatShading: true });
  const light = ghost ? body : new THREE.MeshLambertMaterial({ color: 0xfff1c0, emissive: 0x806020 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 4.3), body);
  chassis.position.y = 0.75;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.35, 1.2), body);
  nose.position.set(0, 0.55, 2.4);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.65, 1.8), dark);
  cabin.position.set(0, 1.4, -0.3);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 0.5), body);
  wing.position.set(0, 1.45, -2.1);
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.4), dark);
  wingL.position.set(-0.8, 1.2, -2.1);
  const wingR = wingL.clone();
  wingR.position.x = 0.8;
  root.add(chassis, nose, cabin, wing, wingL, wingR);
  for (const x of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.1), light);
    l.position.set(x, 0.8, 2.16);
    root.add(l);
  }

  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.45, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1.1, 1.45], [1.1, 1.45], [-1.1, -1.45], [1.1, -1.45]] as const) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.48, z);
    root.add(w);
    wheels.push(w);
  }
  return { root, wheels };
}
