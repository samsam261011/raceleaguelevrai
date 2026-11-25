import * as THREE from "three";
import type { CarState } from "../physics/car";
import { formatTime } from "../session/session";
import type { Track } from "../track/types";
import { buildCarMesh, buildGhostMesh, type CarMesh } from "./carMesh";
import { buildEnvironment } from "./environment";
import { buildTrackMesh } from "./trackMesh";

/** La scène 3D : piste, voiture, fantôme et caméra de poursuite. Uniquement de l'affichage. */
export class RaceView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);
  private readonly car: CarMesh;
  private readonly ghost: CarMesh;
  private readonly ghostLabel: THREE.Sprite;
  private ghostLabelTime: number | null = null;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private camReady = false;
  private wheelSpin = 0;
  private ghostSpin = 0;

  constructor(canvas: HTMLCanvasElement, track: Track) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    buildEnvironment(this.scene, track);
    this.scene.add(buildTrackMesh(track));
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
  }

  /** Remet la caméra derrière la voiture (au début d'un essai). */
  snapCamera(): void {
    this.camReady = false;
  }

  render(prev: CarState, cur: CarState, alpha: number, ghost: { prev: CarState; cur: CarState; time: number } | null, dt: number): void {
    placeCar(this.car, prev, cur, alpha);
    const speed = Math.hypot(cur.vx, cur.vz);
    this.wheelSpin += speed * dt * 1.5;
    for (const w of this.car.wheels) w.rotation.x = this.wheelSpin;

    if (ghost) {
      this.ghost.root.visible = true;
      placeCar(this.ghost, ghost.prev, ghost.cur, alpha);
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

    // Caméra de poursuite : proche, un peu au-dessus, qui regarde légèrement vers le bas
    const yaw = this.car.root.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const p = this.car.root.position;
    const back = 8.2 + speed * 0.03;
    const desired = new THREE.Vector3(p.x - fx * back, p.y + 4.6, p.z - fz * back);
    const look = new THREE.Vector3(p.x + fx * 7, p.y + 0.3, p.z + fz * 7);
    if (!this.camReady) {
      this.camPos.copy(desired);
      this.camLook.copy(look);
      this.camReady = true;
    } else {
      this.camPos.x += (desired.x - this.camPos.x) * (1 - Math.exp(-dt * 9));
      this.camPos.z += (desired.z - this.camPos.z) * (1 - Math.exp(-dt * 9));
      this.camPos.y += (desired.y - this.camPos.y) * (1 - Math.exp(-dt * 5));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 14));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const fov = 60 + Math.min(speed, 60) * 0.15;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 4));
      this.camera.updateProjectionMatrix();
    }
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

function placeCar(mesh: CarMesh, a: CarState, b: CarState, t: number): void {
  mesh.root.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  mesh.root.rotation.y = lerpAngle(a.heading, b.heading, t);
  const speed = Math.hypot(b.vx, b.vz) || 1;
  mesh.root.rotation.x = Math.max(-0.35, Math.min(0.35, -Math.atan2(b.vy, speed)));
  // Légère inclinaison dans les virages (vers l'extérieur)
  mesh.root.rotation.z = b.steer * 0.05 * Math.min(1, speed / 30);
}
