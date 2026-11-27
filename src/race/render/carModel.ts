import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// Au build, ce fichier est intégré au code (voir assetsInlineLimit dans vite.config.ts)
import url from "./models/voiture.glb?url";

/**
 * Modèle 3D de la voiture, fait dans Blender (tools/voiture/modele.py, retouchable dans tools/voiture/voiture.blend).
 * Il est chargé une fois ; en attendant (ou s'il ne se charge pas), la voiture construite par le code s'affiche.
 */
export interface CarModel {
  /** Carrosserie complète (plusieurs matériaux : Peinture, Carbone, Bande, Vitre, Phares, Feux, Accent). */
  body: THREE.Object3D;
  /** Roues centrées sur leur axe (axe x), face extérieure vers +x. */
  frontWheel: THREE.Object3D;
  rearWheel: THREE.Object3D;
}

let pending: Promise<CarModel | null> | null = null;

export function loadCarModel(): Promise<CarModel | null> {
  pending ??= new GLTFLoader()
    .loadAsync(url)
    .then((gltf) => {
      const scene = gltf.scene;
      const body = scene.getObjectByName("Caisse");
      const frontWheel = scene.getObjectByName("RoueAvant");
      const rearWheel = scene.getObjectByName("RoueArriere");
      if (!body || !frontWheel || !rearWheel) return null;
      for (const o of [body, frontWheel, rearWheel]) {
        o.removeFromParent();
        o.position.set(0, 0, 0);
      }
      return { body, frontWheel, rearWheel };
    })
    .catch(() => null);
  return pending;
}

/** Copie d'un morceau du modèle, chaque matériau passant par `mat` (qui peut le remplacer). */
export function cloneWith(o: THREE.Object3D, mat: (m: THREE.MeshStandardMaterial) => THREE.Material, shadows: boolean): THREE.Object3D {
  const c = o.clone(true);
  c.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = mat(mesh.material as THREE.MeshStandardMaterial);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
  });
  return c;
}
