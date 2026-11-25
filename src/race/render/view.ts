import * as THREE from "three";
import type { CarState } from "../physics/car";
import type { Track } from "../track/types";
import { buildCarMesh, type CarMesh } from "./carMesh";
import { buildEnvironment } from "./environment";
import { buildTrackMesh } from "./trackMesh";

const tmp = new THREE.Vector3();

/** La scène 3D : piste, voiture, fantôme et caméra de poursuite. Uniquement de l'affichage. */
export class RaceView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 3000);
  private readonly car: CarMesh;
  private readonly ghost: CarMesh;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private camReady = false;
  private wheelSpin = 0;

  constructor(canvas: HTMLCanvasElement, track: Track) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    buildEnvironment(this.scene, track);
    this.scene.add(buildTrackMesh(track));
    this.car = buildCarMesh(0xffb23e);
    this.ghost = buildCarMesh(0x9fe0ff, true);
    this.ghost.root.visible = false;
    this.scene.add(this.car.root, this.ghost.root);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setLowGraphics(low: boolean): void {
    this.renderer.setPixelRatio(low ? 0.6 : Math.min(window.devicePixelRatio || 1, 2));
    this.resize();
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

  render(prev: CarState, cur: CarState, alpha: number, ghost: { prev: CarState; cur: CarState } | null, dt: number): void {
    placeCar(this.car, prev, cur, alpha);
    if (ghost) {
      this.ghost.root.visible = true;
      placeCar(this.ghost, ghost.prev, ghost.cur, alpha);
    } else {
      this.ghost.root.visible = false;
    }

    const speed = Math.hypot(cur.vx, cur.vz);
    this.wheelSpin += speed * dt * 2;
    for (const w of this.car.wheels) w.rotation.x = this.wheelSpin;

    // Caméra de poursuite, lissée
    const yaw = this.car.root.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const p = this.car.root.position;
    const back = 9 + speed * 0.05;
    const desired = tmp.set(p.x - fx * back, p.y + 3.6 + speed * 0.015, p.z - fz * back);
    const look = new THREE.Vector3(p.x + fx * 6, p.y + 1.2, p.z + fz * 6);
    if (!this.camReady) {
      this.camPos.copy(desired);
      this.camLook.copy(look);
      this.camReady = true;
    } else {
      const k = 1 - Math.exp(-dt * 7);
      this.camPos.lerp(desired, k);
      this.camPos.y += (desired.y - this.camPos.y) * (1 - Math.exp(-dt * 4));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 12));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const fov = 68 + Math.min(speed, 60) * 0.22;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 4));
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
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
  mesh.root.rotation.x = Math.max(-0.4, Math.min(0.4, -Math.atan2(b.vy, speed)));
  mesh.root.rotation.z = -b.steer * 0.06 * Math.min(1, speed / 30) * (b.drifting ? 2 : 1);
}
