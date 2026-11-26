import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import { clamp, dcos, dsin } from "../math/dmath";
import type { World } from "../world/world";
import { buildCollision, type TrackCollision } from "./collision";
import * as C from "./constants";
import { has, IN_BRAKE, IN_LEFT, IN_RIGHT, IN_THROTTLE, type InputBits } from "./input";

/**
 * Moteur de conduite v3 : une caisse rigide posée sur quatre roues suspendues.
 * Les roues sont des rayons qui cherchent la piste (suspension), la caisse heurte les parapets,
 * tout le reste (moteur, direction, appui, contrôle en l'air) est réglé ici.
 *
 * La physique est calculée par Rapier en version déterministe : les mêmes entrées donnent
 * exactement la même course sur toutes les machines. Notre propre code n'utilise que + - * / et Math.sqrt.
 */

let ready: Promise<void> | null = null;
/** À attendre une fois avant la première course (charge le moteur physique). */
export function initPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

export interface WheelState {
  /** Hauteur du centre de la roue sous son point d'attache (m), pour l'affichage. */
  drop: number;
  contact: boolean;
}

/** Instantané de la voiture après un pas. Objet simple : se copie, se compare, s'interpole. */
export interface CarState {
  x: number;
  y: number;
  z: number;
  /** Orientation (quaternion). */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Cap au sol (pour la caméra et le pilote automatique, jamais pour la physique). */
  heading: number;
  vx: number;
  vy: number;
  vz: number;
  /** Vitesse dans l'axe de la voiture (m/s). */
  speed: number;
  /** Position du volant, de -1 (gauche) à 1 (droite). */
  steer: number;
  /** Angle des roues avant (rad, + = à gauche). */
  wheelAngle: number;
  wheels: WheelState[];
  grounded: boolean;
  onWall: boolean;
  fell: boolean;
}

export const WHEELS = C.WHEELS;

const collisionCache = new WeakMap<World, TrackCollision>();

/** La voiture dans son monde physique. Une par tentative (et une pour le fantôme). */
export class CarSim {
  private readonly rw: RAPIER.World;
  private readonly body: RAPIER.RigidBody;
  private readonly hull: RAPIER.Collider;
  private readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  /** Collider de surface → index de la pièce. */
  private readonly surfaceBlock = new Map<number, number>();
  private readonly walls = new Set<number>();
  /** Tout ce qui est solide mais où les roues ne roulent pas : parapets, dessous des dalles, pylônes. */
  private readonly notRoad = new Set<number>();
  /** Pas passés retournée ou couchée sur le flanc, presque à l'arrêt. */
  private upsideTicks = 0;
  private steer = 0;
  /** Pédale d'accélérateur, de 0 à 1 : elle monte progressivement quand on appuie. */
  private throttle = 0;
  private onWall = false;
  private fell = false;
  state: CarState;

  constructor(readonly world: World) {
    const rw = new RAPIER.World({ x: 0, y: -C.GRAVITY, z: 0 });
    rw.timestep = C.DT / C.SUBSTEPS;
    this.rw = rw;

    let col = collisionCache.get(world);
    if (!col) collisionCache.set(world, (col = buildCollision(world)));
    const solid = (soup: { vertices: Float32Array; indices: Uint32Array }, friction: number) =>
      rw.createCollider(RAPIER.ColliderDesc.trimesh(soup.vertices, soup.indices).setFriction(friction).setRestitution(C.WALL_BOUNCE));
    for (const { block, soup } of col.surfaces) this.surfaceBlock.set(solid(soup, C.ROAD_FRICTION).handle, block);
    if (col.underside) this.notRoad.add(solid(col.underside, C.WALL_FRICTION).handle);
    if (col.walls) {
      const w = solid(col.walls, C.WALL_FRICTION);
      this.walls.add(w.handle);
      this.notRoad.add(w.handle);
    }
    for (const p of col.pillars) {
      const shaft = rw.createCollider(RAPIER.ColliderDesc.cylinder(p.shaftHalf, p.radius).setTranslation(p.x, p.shaftY, p.z).setFriction(C.WALL_FRICTION).setRestitution(C.WALL_BOUNCE));
      const cap = rw.createCollider(
        RAPIER.ColliderDesc.cuboid(p.capHalf[0], p.capHalf[1], p.capHalf[2]).setTranslation(p.x, p.capY, p.z).setRotation(p.capRot).setFriction(C.WALL_FRICTION).setRestitution(C.WALL_BOUNCE),
      );
      this.notRoad.add(shaft.handle);
      this.notRoad.add(cap.handle);
    }

    const s = world.spawn;
    const h = s.heading / 2;
    this.body = rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(s.x, s.y + 0.02, s.z)
        .setRotation({ x: 0, y: dsin(h), z: 0, w: dcos(h) })
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setAngularDamping(C.ANGULAR_DAMPING),
    );
    const [hx, hy, hz, cy] = C.HULL;
    this.hull = rw.createCollider(
      // Boîte aux arêtes arrondies : elle glisse sur les parapets au lieu de s'y planter
      RAPIER.ColliderDesc.roundCuboid(hx - C.HULL_ROUND, hy - C.HULL_ROUND, hz - C.HULL_ROUND, C.HULL_ROUND)
        .setTranslation(0, cy, 0)
        .setMassProperties(C.MASS, { x: 0, y: C.CENTER_OF_MASS_Y - cy, z: 0 }, { x: C.INERTIA[0], y: C.INERTIA[1], z: C.INERTIA[2] }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(C.HULL_FRICTION)
        .setRestitution(C.WALL_BOUNCE),
      this.body,
    );

    const v = rw.createVehicleController(this.body);
    v.indexUpAxis = 1;
    v.setIndexForwardAxis = 2;
    WHEELS.forEach((w, i) => {
      v.addWheel({ x: w.x, y: w.r + C.SUSPENSION_REST - C.SUSPENSION_SAG, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, C.SUSPENSION_REST, w.r);
      v.setWheelSuspensionStiffness(i, C.SUSPENSION_STIFFNESS);
      v.setWheelSuspensionCompression(i, C.SUSPENSION_COMPRESSION);
      v.setWheelSuspensionRelaxation(i, C.SUSPENSION_RELAXATION);
      v.setWheelMaxSuspensionTravel(i, C.SUSPENSION_TRAVEL);
      v.setWheelMaxSuspensionForce(i, 1e9);
      v.setWheelFrictionSlip(i, C.TIRE_GRIP);
      v.setWheelSideFrictionStiffness(i, 1);
    });
    this.vehicle = v;
    this.state = this.snapshot();
  }

  /** Avance d'un pas de jeu (1/120 s), découpé en sous-pas de physique. */
  step(input: InputBits): CarState {
    if (this.fell) return this.state;
    const target = (has(input, IN_RIGHT) ? 1 : 0) - (has(input, IN_LEFT) ? 1 : 0);
    const maxDelta = C.STEER_RESPONSE * C.DT;
    this.steer += clamp(target - this.steer, -maxDelta, maxDelta);
    this.throttle = has(input, IN_THROTTLE) ? Math.min(1, this.throttle + C.DT / C.THROTTLE_RAMP) : 0;
    const wasOnWall = this.onWall;
    this.onWall = false;
    const before = this.body.linvel();

    const dt = C.DT / C.SUBSTEPS;
    // Contact avec un parapet, vérifié à chaque sous-pas (un choc bref peut se finir avant la fin du pas)
    let nx = 0;
    let nz = 0;
    for (let k = 0; k < C.SUBSTEPS; k++) {
      this.substep(input, dt);
      this.rw.contactPairsWith(this.hull, (other) => {
        if (!this.walls.has(other.handle)) return;
        this.rw.contactPair(this.hull, other, (m) => {
          if (m.numContacts() > 0) {
            this.onWall = true;
            const n = m.normal();
            nx = n.x;
            nz = n.z;
          }
        });
      });
    }

    if (this.onWall && !wasOnWall) {
      // Choc contre un parapet : plus on arrive de face, plus on perd de vitesse (de rien en frôlant à 60 % de face)
      const sp = Math.sqrt(before.x * before.x + before.z * before.z);
      const nl = Math.sqrt(nx * nx + nz * nz);
      if (sp > 1 && nl > 0) {
        const facing = Math.abs(before.x * nx + before.z * nz) / (sp * nl);
        const keep = 1 - C.WALL_IMPACT * facing;
        const lv = this.body.linvel();
        this.body.setLinvel({ x: lv.x * keep, y: lv.y, z: lv.z * keep }, true);
      }
    }
    if (this.onWall) {
      // Frotter un parapet coûte du temps : la voiture perd un peu de vitesse à chaque pas de contact
      const lv = this.body.linvel();
      this.body.setLinvel({ x: lv.x * C.WALL_SPEED_KEEP, y: lv.y, z: lv.z * C.WALL_SPEED_KEEP }, true);
    }
    this.rightIfStuck();
    const t = this.body.translation();
    if (t.y < this.world.groundY + 0.2) this.fell = true;
    this.state = this.snapshot();
    return this.state;
  }

  private substep(input: InputBits, dt: number): void {
    const b = this.body;
    const v = this.vehicle;
    const q = b.rotation();
    const lv = b.linvel();
    // Axes de la voiture
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const uz = 2 * (q.y * q.z + q.w * q.x);
    const vf = lv.x * fx + lv.y * fy + lv.z * fz;
    const speedAbs = vf < 0 ? -vf : vf;

    let contacts = 0;
    for (let i = 0; i < 4; i++) if (v.wheelIsInContact(i)) contacts++;
    const grounded = contacts > 0;

    // Moteur (roues arrière), frein et marche arrière
    let drive = 0;
    let brakeAll = 0;
    if (has(input, IN_THROTTLE) && vf < C.VMAX) {
      // Poussée progressive : forte au départ sans être brutale, encore présente à haute vitesse
      const r = vf > 0 ? vf / C.VMAX : 0;
      drive += C.ENGINE * this.throttle * (1 - r * r * r);
    }
    if (has(input, IN_BRAKE)) {
      if (vf > 0.5) brakeAll = C.BRAKE;
      else if (vf > -C.REVERSE_MAX) drive -= C.REVERSE_ACCEL;
    }
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      v.setWheelEngineForce(i, (rear ? (drive * C.MASS) / 2 : 0) - (brakeAll * C.MASS) / 4);
      v.setWheelBrake(i, 0);
    }

    // Direction : l'angle des roues baisse avec la vitesse, pour garder un rayon de virage confortable
    const lowSpeed = clamp(speedAbs / 8, 0, 1);
    const highSpeed = 1 - 0.3 * clamp(speedAbs / C.VMAX, 0, 1);
    const yawRate = C.STEER_MAX * lowSpeed * highSpeed;
    const angle = speedAbs > 1 ? clamp((C.WHEELBASE * yawRate) / speedAbs, 0, C.MAX_WHEEL_ANGLE) : C.MAX_WHEEL_ANGLE;
    const wheelAngle = -this.steer * angle * (vf < -0.5 ? -1 : 1);
    v.setWheelSteering(0, wheelAngle);
    v.setWheelSteering(1, wheelAngle);

    if (grounded) {
      // Appui : la voiture colle d'autant plus à la piste qu'elle va vite
      const push = C.MASS * C.DOWNFORCE * speedAbs * dt * (contacts / 4);
      b.applyImpulse({ x: -ux * push, y: -uy * push, z: -uz * push }, true);
      // Frottements et retour progressif sous la vitesse max (après une descente)
      let drag = C.ROLL_DRAG / C.SUBSTEPS;
      if (vf > C.VMAX) drag += (C.OVERSPEED_DRAG * dt * (vf - C.VMAX)) / vf;
      b.setLinvel({ x: lv.x - fx * vf * drag, y: lv.y - fy * vf * drag, z: lv.z - fz * vf * drag }, true);
      // Anti-roulis : la voiture reste parallèle à la piste, même plaquée contre un parapet.
      // On mesure l'inclinaison de son axe gauche-droite par rapport au sol sous les roues, et on la corrige.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < 4; i++) {
        if (!v.wheelIsInContact(i)) continue;
        const n = v.wheelContactNormal(i);
        if (n) {
          nx += n.x;
          ny += n.y;
          nz += n.z;
        }
      }
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      // Axe droit de la voiture (repère local -x)
      const rx = -(1 - 2 * (q.y * q.y + q.z * q.z));
      const ry = -2 * (q.x * q.y + q.w * q.z);
      const rz = -2 * (q.x * q.z - q.w * q.y);
      const tilt = (rx * nx + ry * ny + rz * nz) / nl;
      const w = b.angvel();
      const rollRate = w.x * fx + w.y * fy + w.z * fz;
      const want = tilt * C.ANTI_ROLL;
      const dr = (want - rollRate) * clamp(C.ANTI_ROLL_RESPONSE * dt, 0, 1);
      b.setAngvel({ x: w.x + fx * dr, y: w.y + fy * dr, z: w.z + fz * dr }, true);
    } else {
      // En l'air : gravité allégée pour des sauts longs
      const lift = C.MASS * (C.GRAVITY - C.AIR_GRAVITY) * dt;
      b.applyImpulse({ x: 0, y: lift, z: 0 }, true);
      // Rotation en l'air, axe par axe (flanc, avant, haut de la voiture) :
      // - tangage : jamais de plongeon. On annule toute rotation du nez ; s'il pointe vers le bas, il remonte doucement.
      // - roulis : la voiture se remet à plat.
      // - lacet : au volant, ou avec le frein, alignement sur la trajectoire.
      const w = b.angvel();
      const sx = 1 - 2 * (q.y * q.y + q.z * q.z);
      const sy = 2 * (q.x * q.y + q.w * q.z);
      const sz = 2 * (q.x * q.z - q.w * q.y);
      const ws = w.x * sx + w.y * sy + w.z * sz;
      const wf = w.x * fx + w.y * fy + w.z * fz;
      const wu = w.x * ux + w.y * uy + w.z * uz;
      const braking = has(input, IN_BRAKE);
      const pitchWant = fy < 0 ? fy * C.AIR_LEVEL : 0;
      const rollWant = -sy * C.AIR_LEVEL * (braking ? 2 : 1);
      let yawWant = -this.steer * C.AIR_STEER;
      let yawK = clamp(C.AIR_STEER_RESPONSE * dt, 0, 1);
      if (braking) {
        // Frein en l'air : la voiture s'aligne sur sa trajectoire pour repartir proprement, sans perdre de vitesse
        yawWant = 0;
        const hl = Math.sqrt(lv.x * lv.x + lv.z * lv.z);
        if (hl > 2 && vf > 0) {
          const fl = Math.sqrt(fx * fx + fz * fz) || 1;
          yawWant = ((fz / fl) * (lv.x / hl) - (fx / fl) * (lv.z / hl)) * C.AIR_LEVEL * 2;
        }
        yawK = clamp(C.AIR_BRAKE_RESPONSE * dt, 0, 1);
      }
      const dp = (pitchWant - ws) * clamp(C.AIR_PITCH_RESPONSE * dt, 0, 1);
      const dr = (rollWant - wf) * clamp(C.AIR_ROLL_RESPONSE * dt, 0, 1);
      const dw = (yawWant - wu) * yawK;
      b.setAngvel({ x: w.x + sx * dp + fx * dr + ux * dw, y: w.y + sy * dp + fy * dr + uy * dw, z: w.z + sz * dp + fz * dr + uz * dw }, true);
    }

    v.updateVehicle(dt, undefined, undefined, this.wheelFilter);
    this.rw.step();
    this.lastWheelAngle = wheelAngle;
  }

  /**
   * Voiture retournée ou couchée sur le flanc, presque à l'arrêt, pendant 1 s :
   * on la remet sur ses roues sur place, dans le sens où elle regardait. Le chrono continue.
   */
  private rightIfStuck(): void {
    const q = this.body.rotation();
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const lv = this.body.linvel();
    const slow = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z < C.STUCK_SPEED * C.STUCK_SPEED;
    this.upsideTicks = uy < C.STUCK_UP && slow ? this.upsideTicks + 1 : 0;
    if (this.upsideTicks < C.STUCK_TIME * C.TICK_RATE) return;
    this.upsideTicks = 0;
    // Cap actuel, projeté au sol (si la voiture est sur le nez, on prend son toit pour direction)
    let fx = 2 * (q.x * q.z + q.w * q.y);
    let fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    if (fx * fx + fz * fz < 0.01) {
      fx = 2 * (q.x * q.y - q.w * q.z);
      fz = 2 * (q.y * q.z + q.w * q.x);
    }
    const L = Math.sqrt(fx * fx + fz * fz) || 1;
    const c = fz / L;
    const sHalf = Math.sqrt(Math.max(0, (1 - c) / 2));
    const cHalf = Math.sqrt(Math.max(0, (1 + c) / 2));
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x, y: t.y + C.STUCK_LIFT, z: t.z }, true);
    this.body.setRotation({ x: 0, y: fx < 0 ? -sHalf : sHalf, z: 0, w: cHalf }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private lastWheelAngle = 0;
  /** Les roues ne roulent que sur les dalles, jamais sur le dessus des parapets. */
  private readonly wheelFilter = (c: RAPIER.Collider) => !this.notRoad.has(c.handle);

  private snapshot(): CarState {
    const t = this.body.translation();
    const q = this.body.rotation();
    const lv = this.body.linvel();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const wheels: WheelState[] = [];
    let grounded = false;
    for (let i = 0; i < 4; i++) {
      const contact = this.vehicle.wheelIsInContact(i);
      if (contact) grounded = true;
      const len = this.vehicle.wheelSuspensionLength(i) ?? C.SUSPENSION_REST;
      wheels.push({ drop: contact ? len : C.SUSPENSION_REST, contact });
    }
    return {
      x: t.x,
      y: t.y,
      z: t.z,
      qx: q.x,
      qy: q.y,
      qz: q.z,
      qw: q.w,
      heading: Math.atan2(fx, fz),
      vx: lv.x,
      vy: lv.y,
      vz: lv.z,
      speed: lv.x * fx + lv.y * fy + lv.z * fz,
      steer: this.steer,
      wheelAngle: this.lastWheelAngle,
      wheels,
      grounded,
      onWall: this.onWall,
      fell: this.fell,
    };
  }

  /** Pose la voiture ailleurs, à l'arrêt (tests, et plus tard la reprise au checkpoint). */
  teleport(x: number, y: number, z: number, rot: { x: number; y: number; z: number; w: number }): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(rot, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.state = this.snapshot();
  }

  dispose(): void {
    this.rw.free();
  }
}

export function copyCar(s: CarState): CarState {
  return { ...s, wheels: s.wheels.map((w) => ({ ...w })) };
}
