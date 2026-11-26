import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import { clamp, dcos, dsin } from "../math/dmath";
import type { World } from "../world/world";
import { buildCollision, type BlockCollision } from "./collision";
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
  boosting: boolean;
  fell: boolean;
}

/** Points d'attache des roues dans le repère de la voiture : avant gauche, avant droite, arrière gauche, arrière droite. */
export const WHEELS = [
  { x: 1.12, z: 1.55, r: 0.4, front: true },
  { x: -1.12, z: 1.55, r: 0.4, front: true },
  { x: 1.08, z: -1.45, r: 0.44, front: false },
  { x: -1.08, z: -1.45, r: 0.44, front: false },
] as const;

const collisionCache = new WeakMap<World, BlockCollision[]>();

/** La voiture dans son monde physique. Une par tentative (et une pour le fantôme). */
export class CarSim {
  private readonly rw: RAPIER.World;
  private readonly body: RAPIER.RigidBody;
  private readonly hull: RAPIER.Collider;
  private readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  /** Collider de surface → index de la pièce. */
  private readonly surfaceBlock = new Map<number, number>();
  private readonly walls = new Set<number>();
  private steer = 0;
  private boosting = false;
  private onWall = false;
  private fell = false;
  state: CarState;

  constructor(readonly world: World) {
    const rw = new RAPIER.World({ x: 0, y: -C.GRAVITY, z: 0 });
    rw.timestep = C.DT / C.SUBSTEPS;
    this.rw = rw;

    let col = collisionCache.get(world);
    if (!col) collisionCache.set(world, (col = buildCollision(world)));
    for (const bc of col) {
      const s = rw.createCollider(RAPIER.ColliderDesc.trimesh(bc.surface.vertices, bc.surface.indices).setFriction(C.ROAD_FRICTION));
      this.surfaceBlock.set(s.handle, bc.block);
      if (bc.walls) {
        const w = rw.createCollider(RAPIER.ColliderDesc.trimesh(bc.walls.vertices, bc.walls.indices).setFriction(C.WALL_FRICTION).setRestitution(C.WALL_BOUNCE));
        this.walls.add(w.handle);
      }
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
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
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
    this.onWall = false;

    const dt = C.DT / C.SUBSTEPS;
    for (let k = 0; k < C.SUBSTEPS; k++) this.substep(input, dt);

    this.boosting = false;
    for (let i = 0; i < 4; i++) {
      const g = this.vehicle.wheelGroundObject(i);
      const b = g ? this.surfaceBlock.get(g.handle) : undefined;
      if (b !== undefined && this.world.blocks[b]!.def.boost) this.boosting = true;
    }
    this.rw.contactPairsWith(this.hull, (other) => {
      if (!this.walls.has(other.handle)) return;
      this.rw.contactPair(this.hull, other, (m) => {
        if (m.numContacts() > 0) this.onWall = true;
      });
    });
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
    if (has(input, IN_THROTTLE) && vf < C.VMAX) drive += C.ENGINE * (1 - vf / C.VMAX);
    if (has(input, IN_BRAKE)) {
      if (vf > 0.5) brakeAll = C.BRAKE;
      else if (vf > -C.REVERSE_MAX) drive -= C.REVERSE_ACCEL;
    }
    if (this.boosting && vf < C.VMAX_BOOST) drive += C.BOOST_ACCEL;
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
      // Frottements et retour progressif sous la vitesse max après un booster
      let drag = C.ROLL_DRAG / C.SUBSTEPS;
      if (vf > C.VMAX && !this.boosting) drag += (C.OVERSPEED_DRAG * dt * (vf - C.VMAX)) / vf;
      b.setLinvel({ x: lv.x - fx * vf * drag, y: lv.y - fy * vf * drag, z: lv.z - fz * vf * drag }, true);
    } else {
      // En l'air : on peut orienter un peu la voiture, et elle se remet doucement à plat
      const w = b.angvel();
      const yaw = -this.steer * C.AIR_STEER;
      // Axe pour redresser : haut de la voiture × vertical
      const lx = -uz;
      const lz = ux;
      const k = C.AIR_LEVEL * dt;
      const cur = w.x * ux + w.y * uy + w.z * uz;
      const dy = (yaw - cur) * clamp(8 * dt, 0, 1);
      b.setAngvel({ x: w.x + ux * dy + lx * k, y: w.y + uy * dy, z: w.z + uz * dy + lz * k }, true);
    }

    v.updateVehicle(dt, undefined, undefined, this.wheelFilter);
    this.rw.step();
    this.lastWheelAngle = wheelAngle;
  }

  private lastWheelAngle = 0;
  /** Les roues ne roulent que sur les dalles, jamais sur le dessus des parapets. */
  private readonly wheelFilter = (c: RAPIER.Collider) => !this.walls.has(c.handle);

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
      boosting: this.boosting,
      fell: this.fell,
    };
  }

  dispose(): void {
    this.rw.free();
  }
}

export function copyCar(s: CarState): CarState {
  return { ...s, wheels: s.wheels.map((w) => ({ ...w })) };
}
