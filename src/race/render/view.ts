import * as THREE from "three";
import type { CarState } from "../physics/car";
import { formatTime } from "../session/session";
import { VMAX } from "../physics/constants";
import type { World } from "../world/world";
import { buildWorldMesh } from "./blockMesh";
import { buildCarMesh, buildGhostMesh, type CarMesh } from "./carMesh";
import { buildEnvironment } from "./environment";
import { SpeedLines } from "./speedLines";

/** La scène 3D : piste, voiture, fantôme et caméra de poursuite. Uniquement de l'affichage. */
export class RaceView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);
  private readonly car: CarMesh;
  private readonly ghost: CarMesh;
  private readonly ghostLabel: THREE.Sprite;
  private ghostLabelTime: number | null = null;
  private camYaw = 0;
  private camY = 0;
  private camReady = false;
  private shakeT = 0;
  private readonly speedLines: SpeedLines | null;
  private wheelSpin = 0;
  private ghostSpin = 0;

  constructor(canvas: HTMLCanvasElement, world: World, fx: HTMLCanvasElement | null = null) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    buildEnvironment(this.scene, world);
    this.scene.add(buildWorldMesh(world));
    this.speedLines = fx ? new SpeedLines(fx) : null;
    this.car = buildCarMesh(0xffb23e);
    this.ghost = buildGhostMesh();
    this.ghostLabel = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.ghostLabel.scale.set(4.6, 1.15, 1);
    this.ghostLabel.position.set(0, 4.1, 0);
    this.ghost.root.add(this.ghostLabel);
    this.ghost.root.visible = false;
    this.scene.add(this.car.root, this.ghost.root);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.speedLines?.resize(w, h);
  }

  /** Remet la caméra derrière la voiture (au début d'un essai). */
  snapCamera(): void {
    this.camReady = false;
  }

  render(prev: CarState, cur: CarState, alpha: number, ghost: { prev: CarState; cur: CarState; time: number } | null, dt: number): void {
    placeCar(this.car, prev, cur, alpha, dt);
    const speed = Math.hypot(cur.vx, cur.vz);
    this.wheelSpin += speed * dt * 1.8;
    for (const w of this.car.wheels) w.rotation.x = this.wheelSpin;

    if (ghost) {
      this.ghost.root.visible = true;
      placeCar(this.ghost, ghost.prev, ghost.cur, alpha, dt);
      this.ghostSpin += Math.hypot(ghost.cur.vx, ghost.cur.vz) * dt * 1.5;
      for (const w of this.ghost.wheels) w.rotation.x = this.ghostSpin;
      if (this.ghostLabelTime !== ghost.time) this.setGhostLabel(ghost.time);
      // Le fantôme s'efface quand il est sur la voiture, pour ne pas gêner la vue
      const d = this.ghost.root.position.distanceTo(this.car.root.position);
      const k = Math.min(1, Math.max(0.15, (d - 2) / 8));
      for (const f of this.ghost.fade) f.mat.opacity = f.base * k;
      (this.ghostLabel.material as THREE.SpriteMaterial).opacity = Math.min(1, Math.max(0, (d - 4) / 10));
    } else {
      this.ghost.root.visible = false;
    }

    // Caméra de poursuite fixée derrière la voiture : la voiture reste au centre de l'écran,
    // seule la rotation de la caméra suit avec un tout petit retard (sensation de virage).
    const p = this.car.root.position;
    const yaw = this.car.root.rotation.y;
    if (!this.camReady) {
      this.camYaw = yaw;
      this.camY = p.y;
      this.camReady = true;
    }
    let dy = yaw - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.camYaw += dy * (1 - Math.exp(-dt * 12));
    this.camY += (p.y - this.camY) * (1 - Math.exp(-dt * 8));
    const k = Math.min(1.3, speed / VMAX);
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const back = 7.6 + k * 1.2;
    const height = 4.1 - k * 0.6;
    // Petite vibration à pleine vitesse
    this.shakeT += dt;
    const shake = Math.max(0, k - 0.75) * 0.09;
    const sx = Math.sin(this.shakeT * 41) * shake;
    const sy = Math.sin(this.shakeT * 53 + 1) * shake;
    this.camera.position.set(p.x - fx * back + fz * sx, this.camY + height + sy, p.z - fz * back - fx * sx);
    this.camera.lookAt(p.x + fx * 8, this.camY + 0.9, p.z + fz * 8);
    // L'angle de vue s'élargit avec la vitesse
    const fov = 64 + k * 20 + (cur.boosting ? 4 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 5));
      this.camera.updateProjectionMatrix();
    }
    this.speedLines?.draw(k, cur.boosting, dt);
    this.renderer.render(this.scene, this.camera);
  }

  private setGhostLabel(time: number): void {
    this.ghostLabelTime = time;
    const c = document.createElement("canvas");
    c.width = 384;
    c.height = 96;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(10, 30, 50, 0.72)";
    const r = 40;
    g.beginPath();
    g.roundRect(8, 12, 368, 72, r);
    g.fill();
    g.strokeStyle = "rgba(190, 235, 255, 0.9)";
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#cfefff";
    g.font = "700 26px 'Chakra Petch', 'Arial Narrow', sans-serif";
    g.textBaseline = "middle";
    g.fillText("FANTÔME", 36, 48);
    g.fillStyle = "#ffffff";
    g.font = "700 34px 'Chakra Petch', 'Arial Narrow', sans-serif";
    g.textAlign = "right";
    g.fillText(formatTime(time), 350, 49);
    const mat = this.ghostLabel.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.map = new THREE.CanvasTexture(c);
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.needsUpdate = true;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function placeCar(mesh: CarMesh, a: CarState, b: CarState, t: number, dt: number): void {
  mesh.root.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  mesh.root.rotation.y = lerpAngle(a.heading, b.heading, t);
  // Tangage doux en montée et en descente ; jamais de roulis : la voiture reste à plat
  const speed = Math.hypot(b.vx, b.vz) || 1;
  const pitch = Math.max(-0.4, Math.min(0.4, -Math.atan2(b.vy, speed)));
  mesh.root.rotation.x += (pitch - mesh.root.rotation.x) * (1 - Math.exp(-dt * 12));
  mesh.root.rotation.z = 0;
  // Roues avant braquées (bien visibles)
  const steer = a.steer + (b.steer - a.steer) * t;
  for (const p of mesh.steerPivots) p.rotation.y = -steer * 0.5;
}
