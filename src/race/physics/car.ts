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
  /** Longueur de la suspension (m) : distance entre le point d'attache et le centre de la roue. */
  drop: number;
  contact: boolean;
  /** Rotation de la roue sur son axe (rad), calculée par la physique. */
  spin: number;
  /** Point de contact avec la route et normale de la route (valables si contact). Pour les traces et la poussière. */
  px: number;
  py: number;
  pz: number;
  nx: number;
  ny: number;
  nz: number;
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
  /** Glisse : vitesse vers le côté de la voiture (m/s, + = vers sa gauche). */
  slide: number;
  /** Pédale d'accélérateur (0 à 1) et frein appuyé : pour le son du moteur. */
  throttle: number;
  braking: boolean;
  /** Vitesse perdue (m/s) dans un choc contre un parapet pendant ce pas, sinon 0. */
  impact: number;
  /** Vitesse de chute (m/s) au moment où les roues retouchent le sol pendant ce pas, sinon 0. */
  landing: number;
  /** Point de contact avec le parapet (valable si onWall). */
  wallX: number;
  wallY: number;
  wallZ: number;
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
      v.setWheelFrictionSlip(i, w.front ? C.TIRE_GRIP : C.TIRE_GRIP_REAR);
      v.setWheelSideFrictionStiffness(i, 1);
    });
    this.vehicle = v;
    this.state = this.snapshot();
  }

  /** Avance d'un pas de jeu (1/120 s), découpé en sous-pas de physique. */
  step(input: InputBits): CarState {
    if (this.fell) return this.state;
    this.started = true;
    const target = (has(input, IN_RIGHT) ? 1 : 0) - (has(input, IN_LEFT) ? 1 : 0);
    const maxDelta = C.STEER_RESPONSE * C.DT;
    this.steer += clamp(target - this.steer, -maxDelta, maxDelta);
    const v = this.state.speed < 0 ? -this.state.speed : this.state.speed;
    const ramp = C.THROTTLE_RAMP_START + (C.THROTTLE_RAMP - C.THROTTLE_RAMP_START) * clamp(v / C.THROTTLE_RAMP_SPEED, 0, 1);
    this.throttle = has(input, IN_THROTTLE) ? Math.min(1, this.throttle + C.DT / ramp) : 0;
    const wasOnWall = this.onWall;
    const wasGrounded = this.state.grounded;
    this.onWall = false;
    this.impact = 0;
    const before = this.body.linvel();

    const dt = C.DT / C.SUBSTEPS;
    // Contact avec un parapet, vérifié à chaque sous-pas (un choc bref peut se finir avant la fin du pas)
    let nx = 0;
    let ny = 0;
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
            ny = n.y;
            nz = n.z;
            const p = m.solverContactPoint(0);
            if (p) {
              this.wallX = p.x;
              this.wallY = p.y;
              this.wallZ = p.z;
            }
          }
        });
      });
    }

    if (this.onWall && !wasOnWall) {
      // Choc contre un parapet : plus on arrive de face, plus on perd de vitesse (de rien en frôlant à 60 % de face)
      const sp = Math.sqrt(before.x * before.x + before.y * before.y + before.z * before.z);
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (sp > 1 && nl > 0) {
        const facing = Math.abs(before.x * nx + before.y * ny + before.z * nz) / (sp * nl);
        const keep = 1 - C.WALL_IMPACT * facing;
        const lv = this.body.linvel();
        this.body.setLinvel({ x: lv.x * keep, y: lv.y * keep, z: lv.z * keep }, true);
        const after = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z) * keep;
        this.impact = sp > after ? sp - after : 0;
      }
    }
    if (this.onWall && ny < 0.5 && ny > -0.5) {
      // Un parapet est vertical : il ne peut pas soulever la voiture. À haute vitesse, le frottement du choc
      // contre sa face (la caisse s'écrase un peu sur ses suspensions au même moment) la poussait vers le haut,
      // jusqu'à 5 m/s, et la faisait passer par-dessus. On retire cette montée ; la chute, elle, reste libre.
      const lv = this.body.linvel();
      const rise = before.y > 0 ? before.y : 0;
      if (lv.y > rise + C.WALL_LIFT_MAX) this.body.setLinvel({ x: lv.x, y: rise, z: lv.z }, true);
    }
    if (this.onWall) {
      // Frotter un parapet coûte du temps : la voiture perd un peu de vitesse à chaque pas de contact
      const lv = this.body.linvel();
      this.body.setLinvel({ x: lv.x * C.WALL_SPEED_KEEP, y: lv.y * C.WALL_SPEED_KEEP, z: lv.z * C.WALL_SPEED_KEEP }, true);
      // Le choc ne couche pas la voiture : on retire l'essentiel du roulis (rotation autour de l'axe avant-arrière)
      const q = this.body.rotation();
      const fx = 2 * (q.x * q.z + q.w * q.y);
      const fy = 2 * (q.y * q.z - q.w * q.x);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const w = this.body.angvel();
      const wf = (w.x * fx + w.y * fy + w.z * fz) * (1 - C.WALL_ROLL_KEEP);
      this.body.setAngvel({ x: w.x - fx * wf, y: w.y - fy * wf, z: w.z - fz * wf }, true);
    }
    this.rightIfStuck();
    const t = this.body.translation();
    if (t.y < this.world.groundY + 0.2) this.fell = true;
    this.state = this.snapshot();
    // Réception : les roues retouchent le sol, avec la vitesse de chute d'avant le pas
    this.state.landing = !wasGrounded && this.state.grounded && before.y < 0 ? -before.y : 0;
    this.state.braking = has(input, IN_BRAKE);
    return this.state;
  }

  /**
   * Un sous-pas de physique. Tout passe par des forces et des impulsions sur la caisse :
   * - les roues (rayons de Rapier) donnent la suspension, l'adhérence et le glissement ;
   * - les barres anti-roulis relient les roues gauche et droite de chaque essieu ;
   * - l'appui aérodynamique plaque la voiture vers le bas *de la voiture*, selon sa vitesse :
   *   c'est lui qui la fait tenir dans un looping ou sur un mur ;
   * - en l'air, aucune force ne la redresse : elle garde sa rotation, amortie sur le tangage et le roulis.
   */
  private substep(input: InputBits, dt: number): void {
    const b = this.body;
    const v = this.vehicle;
    const q = b.rotation();
    const lv = b.linvel();
    // Axes de la voiture dans le monde : avant (local +z), haut (local +y), gauche (local +x)
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const uz = 2 * (q.y * q.z + q.w * q.x);
    const lx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const ly = 2 * (q.x * q.y + q.w * q.z);
    const lz = 2 * (q.x * q.z - q.w * q.y);
    const vf = lv.x * fx + lv.y * fy + lv.z * fz;
    const vl = lv.x * lx + lv.y * ly + lv.z * lz;
    const speedAbs = vf < 0 ? -vf : vf;

    let contacts = 0;
    for (let i = 0; i < 4; i++) if (v.wheelIsInContact(i)) contacts++;
    const frontGrip = v.wheelIsInContact(0) || v.wheelIsInContact(1);
    const grounded = contacts > 0;

    // Moteur (roues arrière), frein (quatre roues) et marche arrière
    let drive = 0;
    let brakeAll = 0;
    if (has(input, IN_THROTTLE) && vf < C.VMAX) {
      // Poussée forte longtemps, qui ne s'éteint qu'en approchant de la vitesse max
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

    // Direction. Angle demandé par le joueur : il baisse avec la vitesse (rayon de virage confortable),
    // plus une aide qui tourne les roues avant vers la trajectoire quand la voiture glisse (contre-braquage).
    const lowSpeed = clamp(speedAbs / 8, 0, 1);
    const highSpeed = 1 - 0.3 * clamp(speedAbs / C.VMAX, 0, 1);
    const yawRate = C.STEER_MAX * lowSpeed * highSpeed;
    const angle = speedAbs > 1 ? clamp((C.WHEELBASE * yawRate) / speedAbs, 0, C.MAX_WHEEL_ANGLE) : C.MAX_WHEEL_ANGLE;
    let wheelAngle = -this.steer * angle * (vf < -0.5 ? -1 : 1);
    if (frontGrip && vf > 4) {
      // Angle de dérive (approché) : vitesse latérale / vitesse vers l'avant ; + = la voiture glisse vers sa gauche
      const drift = clamp(vl / vf, -1, 1);
      wheelAngle += clamp(drift * C.COUNTER_STEER, -C.COUNTER_STEER_MAX, C.COUNTER_STEER_MAX);
    }
    wheelAngle = clamp(wheelAngle, -C.MAX_WHEEL_ANGLE, C.MAX_WHEEL_ANGLE);
    v.setWheelSteering(0, wheelAngle);
    v.setWheelSteering(1, wheelAngle);

    // Butées de suspension : la suspension durcit fortement en fin de course (pas de talonnage sur les réceptions)
    for (let i = 0; i < 4; i++) {
      const len = v.wheelSuspensionLength(i) ?? C.SUSPENSION_REST;
      const hard = v.wheelIsInContact(i) && len < C.BUMP_STOP;
      v.setWheelSuspensionStiffness(i, hard ? C.SUSPENSION_STIFFNESS * C.BUMP_STIFFNESS : C.SUSPENSION_STIFFNESS);
      v.setWheelSuspensionCompression(i, hard ? C.SUSPENSION_COMPRESSION * C.BUMP_DAMPING : C.SUSPENSION_COMPRESSION);
    }

    if (grounded) {
      // Appui aérodynamique, dans l'axe de la voiture
      const push = C.MASS * C.DOWNFORCE * speedAbs * dt;
      b.applyImpulse({ x: -ux * push, y: -uy * push, z: -uz * push }, true);
      // Frottements de roulement, et retour progressif sous la vitesse max (après une descente)
      let drag = C.ROLL_DRAG / C.SUBSTEPS;
      if (vf > C.VMAX) drag += (C.OVERSPEED_DRAG * dt * (vf - C.VMAX)) / vf;
      b.setLinvel({ x: lv.x - fx * vf * drag, y: lv.y - fy * vf * drag, z: lv.z - fz * vf * drag }, true);
      // Barres anti-roulis : sur chaque essieu, la roue la plus enfoncée soulève la caisse, l'autre la tire vers le bas
      for (const [left, right] of [
        [0, 1],
        [2, 3],
      ] as const) {
        if (!v.wheelIsInContact(left) || !v.wheelIsInContact(right)) continue;
        const dl = v.wheelSuspensionLength(left) ?? C.SUSPENSION_REST;
        const dr = v.wheelSuspensionLength(right) ?? C.SUSPENSION_REST;
        const f = C.ANTI_ROLL_BAR * C.MASS * (dr - dl) * dt;
        const pl = v.wheelHardPoint(left);
        const pr = v.wheelHardPoint(right);
        if (!pl || !pr) continue;
        b.applyImpulseAtPoint({ x: ux * f, y: uy * f, z: uz * f }, pl, true);
        b.applyImpulseAtPoint({ x: -ux * f, y: -uy * f, z: -uz * f }, pr, true);
      }
      if (!frontGrip) {
        // Bord d'un tremplin : l'avant est parti, l'arrière roule encore. Sans aide, la voiture pivoterait
        // sur ses roues arrière et partirait nez en bas : on amortit ce tangage comme en l'air.
        const w = b.angvel();
        const dl = -(w.x * lx + w.y * ly + w.z * lz) * clamp(C.AIR_PITCH_DAMPING * dt, 0, 1);
        b.setAngvel({ x: w.x + lx * dl, y: w.y + ly * dl, z: w.z + lz * dl }, true);
      }
    } else {
      // En l'air : la voiture garde sa rotation. On amortit le tangage et le roulis (pas de plongeon, pas de vrille),
      // le volant oriente doucement le cap, et le frein freine toutes les rotations.
      const w = b.angvel();
      const wl = w.x * lx + w.y * ly + w.z * lz;
      const wf = w.x * fx + w.y * fy + w.z * fz;
      const wu = w.x * ux + w.y * uy + w.z * uz;
      const braking = has(input, IN_BRAKE);
      const kp = clamp((braking ? C.AIR_BRAKE_DAMPING : C.AIR_PITCH_DAMPING) * dt, 0, 1);
      const kr = clamp((braking ? C.AIR_BRAKE_DAMPING : C.AIR_ROLL_DAMPING) * dt, 0, 1);
      let yawWant = braking ? 0 : -this.steer * C.AIR_STEER;
      // Écart entre le nez et la trajectoire (vus de dessus), en sinus ; le volant ne peut pas l'agrandir au-delà de la limite
      const fh = Math.sqrt(fx * fx + fz * fz);
      const vh = Math.sqrt(lv.x * lv.x + lv.z * lv.z);
      if (fh > 0.1 && vh > 4) {
        const off = (fz * lv.x - fx * lv.z) / (fh * vh);
        if (yawWant * off < 0) yawWant *= clamp(1 - (off < 0 ? -off : off) / C.AIR_YAW_LIMIT, 0, 1);
      }
      const ky = clamp((braking ? C.AIR_BRAKE_DAMPING : C.AIR_STEER_RESPONSE) * dt, 0, 1);
      const dl = -wl * kp;
      const df = -wf * kr;
      const du = (yawWant - wu) * ky;
      b.setAngvel({ x: w.x + lx * dl + fx * df + ux * du, y: w.y + ly * dl + fy * df + uy * du, z: w.z + lz * dl + fz * df + uz * du }, true);
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
  private impact = 0;
  private wallX = 0;
  private wallY = 0;
  private wallZ = 0;
  private started = false;
  /** Les roues ne roulent que sur les dalles, jamais sur le dessus des parapets. */
  private readonly wheelFilter = (c: RAPIER.Collider) => !this.notRoad.has(c.handle);

  private snapshot(): CarState {
    const t = this.body.translation();
    const q = this.body.rotation();
    const lv = this.body.linvel();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const lx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const ly = 2 * (q.x * q.y + q.w * q.z);
    const lz = 2 * (q.x * q.z - q.w * q.y);
    const wheels: WheelState[] = [];
    let grounded = false;
    for (let i = 0; i < 4; i++) {
      const contact = this.vehicle.wheelIsInContact(i);
      if (contact) grounded = true;
      // Avant le premier pas, Rapier n'a pas encore mesuré la suspension : la voiture est posée, au repos
      const len = this.vehicle.wheelSuspensionLength(i) ?? C.SUSPENSION_REST - C.SUSPENSION_SAG;
      const p = contact ? this.vehicle.wheelContactPoint(i) : null;
      const n = contact ? this.vehicle.wheelContactNormal(i) : null;
      wheels.push({
        drop: contact ? len : this.started ? C.SUSPENSION_REST : C.SUSPENSION_REST - C.SUSPENSION_SAG,
        contact,
        spin: this.vehicle.wheelRotation(i) ?? 0,
        px: p ? p.x : 0,
        py: p ? p.y : 0,
        pz: p ? p.z : 0,
        nx: n ? n.x : 0,
        ny: n ? n.y : 1,
        nz: n ? n.z : 0,
      });
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
      slide: lv.x * lx + lv.y * ly + lv.z * lz,
      throttle: this.throttle,
      braking: false,
      impact: this.impact,
      landing: 0,
      wallX: this.wallX,
      wallY: this.wallY,
      wallZ: this.wallZ,
    };
  }

  /** Pose la voiture ailleurs, à l'arrêt ou lancée (tests, scène labo, et plus tard la reprise au checkpoint). */
  teleport(x: number, y: number, z: number, rot: { x: number; y: number; z: number; w: number }, vel = { x: 0, y: 0, z: 0 }): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(rot, true);
    this.body.setLinvel(vel, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.state = this.snapshot();
  }

  /** Ajoute un obstacle solide où les roues peuvent rouler (bosse de test pour les suspensions). */
  addBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    this.rw.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(C.ROAD_FRICTION));
  }

  dispose(): void {
    this.rw.free();
  }
}

export function copyCar(s: CarState): CarState {
  return { ...s, wheels: s.wheels.map((w) => ({ ...w })) };
}
