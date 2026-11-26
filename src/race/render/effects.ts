import * as THREE from "three";
import type { CarState } from "../physics/car";

/**
 * Retours visuels de la conduite, lus dans l'état de la voiture (jamais l'inverse) :
 * traces de pneus quand la voiture glisse ou freine fort, poussière dans les glisses et aux réceptions,
 * étincelles contre les parapets.
 */

const SKID_SEGMENTS = 1600;
const SKID_WIDTH = 0.34;
/** Glisse (m/s vers le côté) à partir de laquelle les pneus marquent la route. */
const SKID_SLIDE = 3.2;

class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private next = 0;
  private count = 0;
  /** Dernier point posé par roue (bords gauche et droit de la trace), ou null si la trace est interrompue. */
  private readonly last: ({ ax: number; ay: number; az: number; bx: number; by: number; bz: number } | null)[] = [null, null, null, null];

  constructor() {
    this.pos = new Float32Array(SKID_SEGMENTS * 4 * 3);
    const idx = new Uint32Array(SKID_SEGMENTS * 6);
    for (let i = 0; i < SKID_SEGMENTS; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x16161a,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  clear(): void {
    this.next = 0;
    this.count = 0;
    this.last.fill(null);
    this.geo.setDrawRange(0, 0);
  }

  add(car: CarState): void {
    const braking = car.braking && car.speed > 10;
    const sliding = Math.abs(car.slide) > SKID_SLIDE;
    // Côté de la voiture (axe gauche), pour donner une largeur à la trace
    const lx = 1 - 2 * (car.qy * car.qy + car.qz * car.qz);
    const ly = 2 * (car.qx * car.qy + car.qw * car.qz);
    const lz = 2 * (car.qx * car.qz - car.qw * car.qy);
    let dirty = false;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i]!;
      // Les roues arrière marquent dans les glisses ; les quatre au freinage appuyé
      const marks = w.contact && (braking || (sliding && i >= 2));
      if (!marks) {
        this.last[i] = null;
        continue;
      }
      const h = SKID_WIDTH / 2;
      const ox = w.px + w.nx * 0.03;
      const oy = w.py + w.ny * 0.03;
      const oz = w.pz + w.nz * 0.03;
      const cur = { ax: ox + lx * h, ay: oy + ly * h, az: oz + lz * h, bx: ox - lx * h, by: oy - ly * h, bz: oz - lz * h };
      const prev = this.last[i];
      this.last[i] = cur;
      if (!prev) continue;
      const dx = cur.ax - prev.ax;
      const dz = cur.az - prev.az;
      // Moins de 25 cm : on attend le pas suivant pour ne pas empiler des segments minuscules
      if (dx * dx + dz * dz < 0.0625) {
        this.last[i] = prev;
        continue;
      }
      if (dx * dx + dz * dz > 25) continue;
      const o = this.next * 12;
      this.pos.set([prev.ax, prev.ay, prev.az, prev.bx, prev.by, prev.bz, cur.ax, cur.ay, cur.az, cur.bx, cur.by, cur.bz], o);
      this.next = (this.next + 1) % SKID_SEGMENTS;
      this.count = Math.min(SKID_SEGMENTS, this.count + 1);
      dirty = true;
    }
    if (dirty) {
      const attr = this.geo.getAttribute("position") as THREE.BufferAttribute;
      attr.needsUpdate = true;
      this.geo.setDrawRange(0, this.count * 6);
    }
  }
}

const VERT = /* glsl */ `
attribute float alpha;
attribute float size;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform vec3 color;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  gl_FragColor = vec4(color, vAlpha * (1.0 - d * 4.0));
}`;

/** Un nuage de particules simples (poussière ou étincelles), calculées sur le processeur. */
class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private next = 0;
  private live = 0;

  constructor(
    private readonly n: number,
    color: number,
    additive: boolean,
    private readonly drag: number,
    private readonly gravity: number,
    private readonly grow: number,
    private readonly opacity: number,
  ) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.live = Math.min(this.n, this.live + 1);
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.live = 0;
    this.flag();
  }

  update(dt: number): void {
    if (this.live === 0) return;
    let alive = 0;
    const k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      alive++;
      this.life[i]! -= dt;
      const j = i * 3;
      this.vel[j]! *= k;
      this.vel[j + 1] = this.vel[j + 1]! * k - this.gravity * dt;
      this.vel[j + 2]! *= k;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1]! += this.vel[j + 1]! * dt;
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
      this.size[i]! += this.grow * dt;
      const t = Math.max(0, this.life[i]! / this.maxLife[i]!);
      this.alpha[i] = this.opacity * t;
    }
    if (alive === 0) this.live = 0;
    this.flag();
  }

  private flag(): void {
    const g = this.points.geometry;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("size") as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Tirage pseudo-aléatoire local (l'affichage n'a pas besoin d'être déterministe, mais on évite Math.random partout). */
let seed = 1;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

export class DrivingEffects {
  readonly group = new THREE.Group();
  private readonly skids = new SkidMarks();
  private readonly dust = new Particles(500, 0xd9b58a, false, 1.6, -0.4, 1.6, 0.55);
  private readonly sparks = new Particles(300, 0xffb347, true, 0.6, 9, -0.2, 1);

  constructor() {
    this.group.add(this.skids.mesh, this.dust.points, this.sparks.points);
  }

  /** Nouvel essai : on efface les traces et les particules. */
  reset(): void {
    this.skids.clear();
    this.dust.clear();
    this.sparks.clear();
  }

  /** Appelé après chaque pas de simulation, pour ne rater aucun événement. */
  step(car: CarState): void {
    this.skids.add(car);
    const slide = Math.abs(car.slide);
    // Poussière derrière les roues arrière dans les glisses
    if (slide > 4) {
      for (let i = 2; i < 4; i++) {
        const w = car.wheels[i]!;
        if (!w.contact || rnd() > Math.min(0.8, (slide - 4) / 8)) continue;
        this.dust.emit(w.px, w.py + 0.15, w.pz, car.vx * 0.25 + (rnd() - 0.5) * 2, 0.6 + rnd() * 0.8, car.vz * 0.25 + (rnd() - 0.5) * 2, 0.7, 0.9 + rnd() * 0.5);
      }
    }
    // Réception d'un saut : un nuage sous chaque roue
    if (car.landing > 3) {
      const n = Math.min(10, Math.round(car.landing));
      for (const w of car.wheels) {
        if (!w.contact) continue;
        for (let k = 0; k < n; k++) {
          const a = rnd() * Math.PI * 2;
          const s = 2 + rnd() * 3;
          this.dust.emit(w.px, w.py + 0.1, w.pz, car.vx * 0.4 + Math.cos(a) * s, 0.5 + rnd() * 1.5, car.vz * 0.4 + Math.sin(a) * s, 0.9, 0.8 + rnd() * 0.6);
        }
      }
    }
    // Étincelles contre un parapet
    const speed = Math.hypot(car.vx, car.vz);
    if (car.onWall && speed > 6) {
      const n = car.impact > 2 ? 24 : 2;
      for (let k = 0; k < n; k++) {
        this.sparks.emit(
          car.wallX,
          car.wallY,
          car.wallZ,
          car.vx * (0.5 + rnd() * 0.4) + (rnd() - 0.5) * 6,
          1.5 + rnd() * 4,
          car.vz * (0.5 + rnd() * 0.4) + (rnd() - 0.5) * 6,
          0.22,
          0.25 + rnd() * 0.35,
        );
      }
    }
  }

  update(dt: number): void {
    this.dust.update(dt);
    this.sparks.update(dt);
  }
}
