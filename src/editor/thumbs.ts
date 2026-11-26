import * as THREE from "three";
import { buildPieceMesh } from "../race/render/blockMesh";
import type { PieceKind } from "../race/world/pieces";

/**
 * Vignettes de la palette : chaque pièce est rendue en 3D, vue de trois quarts, dans une petite image.
 * Un seul moteur de rendu hors écran, utilisé une fois par pièce au chargement, puis libéré.
 */
export function renderThumbs(kinds: PieceKind[], size = 112, onEach: (kind: PieceKind, url: string) => void): void {
  const canvas = document.createElement("canvas");
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size * 2, size * 2, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x6a5a6a, 1.6));
  const sun = new THREE.DirectionalLight(0xffe2c0, 2.2);
  sun.position.set(-40, 80, -30);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);

  const queue = [...kinds];
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  // Une vignette par image d'animation : la page reste fluide pendant le chargement
  const next = () => {
    const kind = queue.shift();
    if (!kind) {
      renderer.dispose();
      return;
    }
    const piece = buildPieceMesh(kind);
    scene.add(piece);
    box.setFromObject(piece);
    box.getBoundingSphere(sphere);
    // Vue de trois quarts, depuis l'arrière gauche et en hauteur, comme dans l'éditeur
    const dir = new THREE.Vector3(0.55, 0.75, -0.65).normalize();
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.92;
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    camera.lookAt(sphere.center);
    renderer.render(scene, camera);
    onEach(kind, canvas.toDataURL("image/png"));
    scene.remove(piece);
    piece.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    requestAnimationFrame(next);
  };
  requestAnimationFrame(next);
}
