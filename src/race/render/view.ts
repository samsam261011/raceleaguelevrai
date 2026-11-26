import * as THREE from "three";
import { WHEELS, type CarState } from "../physics/car";
import { formatTime } from "../session/session";
import { SUSPENSION_REST, SUSPENSION_SAG, VMAX } from "../physics/constants";
import type { World } from "../world/world";
import { animateTrack, buildWorldMesh } from "./blockMesh";
import { buildCarMesh, buildGhostMesh, type CarMesh } from "./carMesh";
import { buildEnvironment, buildSky, enableSunShadows, followSunShadow, shadowQuality, type Lighting } from "./environment";
import { SpeedLines } from "./speedLines";

/** Réglages de la caméra de course (en mètres et en degrés). */
const CAM = {
  back: 7.2,
  backFast: 1.0,
  height: 2.7,
  heightFast: 0.35,
  /** Point visé : loin devant, juste au-dessus de la route. */
  ahead: 30,
  aim: 1.3,
  fov: 70,
  fovFast: 16,
};

/** Carte d'environnement (reflets) faite à partir du ciel seul. */
function skyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const sky = new THREE.Scene();
  buildSky(sky);
  sky.fog = null;
  // Un sol ocre sous l'horizon, pour des reflets chauds sur le bas de caisse
  const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 16), new THREE.MeshBasicMaterial({ color: 0xb98458 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -5;
  sky.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(sky, 0.02).texture;
  pmrem.dispose();
  return tex;
}

/** La scène 3D : piste, voiture, fantôme et caméra de poursuite. Uniquement de l'affichage. */
export class RaceView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.3, 4000);
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
  private readonly lighting: Lighting;
  private readonly shadowReach: number;

  constructor(canvas: HTMLCanvasElement, world: World, fx: HTMLCanvasElement | null = null) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping ACES : blancs qui ne brûlent pas, couleurs plus riches
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Ombres : une seule carte qui suit la voiture, adoucie (PCF), plus petite sur les machines modestes
    const q = shadowQuality();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.lighting = buildEnvironment(this.scene, world);
    enableSunShadows(this.lighting.sun, q.mapSize, q.radius);
    this.shadowReach = q.radius;
    // Circuit fusionné : une géométrie par matériau pour toute la piste
    this.scene.add(buildWorldMesh(world, true));
    // Reflets de la carrosserie : une petite carte d'environnement tirée du ciel (calculée une fois)
    this.scene.environment = skyEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.9;
    this.speedLines = fx ? new SpeedLines(fx) : null;
    this.car = buildCarMesh();
    this.ghost = buildGhostMesh();
    this.ghostLabel = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.ghostLabel.scale.set(4.6, 1.15, 1);
    this.ghostLabel.position.set(0, 2.9, 0);
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
    placeCar(this.car, prev, cur, alpha);
    const speed = Math.hypot(cur.vx, cur.vz);
    // Rotation des roues : vitesse / rayon
    this.wheelSpin += (cur.speed / 0.42) * dt;
    const prevSpeed = prev.speed;
    const accel = (cur.speed - prevSpeed) * 120;
    if (this.car.lights) this.car.lights.color.setRGB(accel < -20 ? 2.4 : 0.9, accel < -20 ? 0.25 : 0.08, accel < -20 ? 0.2 : 0.06);
    if (this.car.flames) {
      this.car.flames.visible = cur.boosting;
      if (cur.boosting) this.car.flames.scale.set(1, 1, 0.8 + Math.random() * 0.5);
    }
    for (const w of this.car.wheels) w.rotation.x = this.wheelSpin;

    if (ghost) {
      this.ghost.root.visible = true;
      placeCar(this.ghost, ghost.prev, ghost.cur, alpha);
      this.ghostSpin += (ghost.cur.speed / 0.42) * dt;
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

    // Caméra de course : basse, assez loin, presque horizontale, qui regarde loin devant.
    // La voiture occupe environ un sixième de la largeur de l'écran, dans le tiers bas ;
    // la piste remplit la moitié basse et on voit venir les virages.
    const p = this.car.root.position;
    // La caméra suit la trajectoire (la direction où va la voiture), pas le nez de la voiture :
    // en glisse ou en l'air, on voit la route qui arrive plutôt que le flanc de la voiture.
    const yaw = speed > 4 && cur.speed > -1 ? Math.atan2(cur.vx, cur.vz) : cur.heading;
    if (!this.camReady) {
      this.camYaw = yaw;
      this.camY = p.y;
      this.camReady = true;
    }
    let dy = yaw - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.camYaw += dy * (1 - Math.exp(-dt * 7));
    this.camY += (p.y - this.camY) * (1 - Math.exp(-dt * (cur.grounded ? 9 : 4)));
    const k = Math.min(1.3, Math.max(0, cur.speed) / VMAX);
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const back = CAM.back + k * CAM.backFast;
    const height = CAM.height - k * CAM.heightFast;
    // Petite vibration à pleine vitesse
    this.shakeT += dt;
    const shake = Math.max(0, k - 0.8) * 0.06;
    const sx = Math.sin(this.shakeT * 41) * shake;
    const sy = Math.sin(this.shakeT * 53 + 1) * shake;
    this.camera.position.set(p.x - fx * back + fz * sx, this.camY + height + sy, p.z - fz * back - fx * sx);
    this.camera.lookAt(p.x + fx * CAM.ahead, this.camY + CAM.aim, p.z + fz * CAM.ahead);
    // L'angle de vue s'élargit avec la vitesse, et un peu plus en boost
    const fov = CAM.fov + k * CAM.fovFast + (cur.boosting ? 5 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 5));
      this.camera.updateProjectionMatrix();
    }
    animateTrack(dt);
    // La zone d'ombre est centrée un peu devant la voiture : c'est là que regarde la caméra
    const ahead = this.shadowReach * 0.45;
    followSunShadow(this.lighting.sun, p.x + fx * ahead, this.camY, p.z + fz * ahead);
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

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
/** Correspondance entre les roues du modèle 3D (gauche avant, droite avant, gauche arrière, droite arrière) et celles de la physique. */
const MESH_TO_SIM = [1, 0, 3, 2] as const;

function placeCar(mesh: CarMesh, a: CarState, b: CarState, t: number): void {
  mesh.root.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  qa.set(a.qx, a.qy, a.qz, a.qw);
  qb.set(b.qx, b.qy, b.qz, b.qw);
  mesh.root.quaternion.slerpQuaternions(qa, qb, t);
  // Roues : elles suivent la suspension
  mesh.wheels.forEach((w, i) => {
    const k = MESH_TO_SIM[i]!;
    const spec = WHEELS[k];
    const drop = a.wheels[k]!.drop + (b.wheels[k]!.drop - a.wheels[k]!.drop) * t;
    if (w.parent) w.parent.position.y = spec.r + SUSPENSION_REST - SUSPENSION_SAG - drop;
  });
  // Roues avant braquées (bien visibles, même à haute vitesse où l'angle réel est faible)
  const steer = a.steer + (b.steer - a.steer) * t;
  for (const p of mesh.steerPivots) p.rotation.y = -steer * 0.45;
}
