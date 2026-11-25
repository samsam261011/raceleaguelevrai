import { clamp, dcos, dsin, sign, wrapAngle } from "../math/dmath";
import { HALF } from "../world/pieces";
import { groundAt, type World } from "../world/world";
import * as C from "./constants";
import { has, IN_BRAKE, IN_LEFT, IN_RIGHT, IN_THROTTLE, type InputBits } from "./input";

/**
 * Repère : la voiture avance selon (sin(cap), cos(cap)) au sol.
 * Vue de derrière, sa droite est (-cos(cap), sin(cap)) et tourner à droite fait baisser le cap.
 */
export interface CarState {
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  vy: number;
  /** Position actuelle du volant, de -1 (gauche) à 1 (droite). */
  steer: number;
  grounded: boolean;
  /** La voiture frotte contre un rebord pendant ce pas. */
  onWall: boolean;
  /** La voiture est sur un booster pendant ce pas. */
  boosting: boolean;
  fell: boolean;
}

export function spawnCar(world: World): CarState {
  const s = world.spawn;
  return { x: s.x, y: s.y, z: s.z, heading: s.heading, vx: 0, vz: 0, vy: 0, steer: 0, grounded: true, onWall: false, boosting: false, fell: false };
}

export function copyCar(s: CarState): CarState {
  return { ...s };
}

/** Avance la voiture d'un pas de physique (1/120 s). Fonction pure et déterministe. */
export function stepCar(s: CarState, input: InputBits, world: World): CarState {
  const n: CarState = { ...s, onWall: false, boosting: false };
  if (n.fell) return n;
  const dt = C.DT;

  // Volant progressif
  const target = (has(input, IN_RIGHT) ? 1 : 0) - (has(input, IN_LEFT) ? 1 : 0);
  const maxDelta = C.STEER_RESPONSE * dt;
  n.steer += clamp(target - n.steer, -maxDelta, maxDelta);

  let fx = dsin(n.heading);
  let fz = dcos(n.heading);
  let rx = -fz;
  let rz = fx;
  let vf = n.vx * fx + n.vz * fz;
  let vl = n.vx * rx + n.vz * rz;

  if (n.grounded) {
    const under = groundAt(world, n.x, n.z, n.y, 0.2);
    if (has(input, IN_THROTTLE) && vf < C.VMAX) vf += C.ENGINE * (1 - vf / C.VMAX) * dt;
    if (has(input, IN_BRAKE)) {
      if (vf > 0.5) vf = Math.max(0, vf - C.BRAKE * dt);
      else if (vf > -C.REVERSE_MAX) vf -= C.REVERSE_ACCEL * dt;
    }
    if (under) {
      // La gravité tire dans le sens de la pente
      vf -= C.GRAVITY * under.slope * (fx * under.tx + fz * under.tz) * dt;
      if (under.block.def.boost && vf < C.VMAX_BOOST) {
        vf = Math.min(C.VMAX_BOOST, vf + C.BOOST_ACCEL * dt);
        n.boosting = true;
      }
    }
    vf -= vf * C.ROLL_DRAG;
    if (vf > C.VMAX) vf -= (vf - C.VMAX) * C.OVERSPEED_DRAG * dt;

    const speedAbs = Math.abs(vf);
    const lowSpeed = clamp(speedAbs / 8, 0, 1);
    const highSpeed = 1 - 0.3 * clamp(speedAbs / C.VMAX, 0, 1);
    n.heading = wrapAngle(n.heading - n.steer * C.STEER_MAX * lowSpeed * highSpeed * sign(vf) * dt);

    vl *= C.GRIP_KEEP;

    fx = dsin(n.heading);
    fz = dcos(n.heading);
    rx = -fz;
    rz = fx;
    n.vx = fx * vf + rx * vl;
    n.vz = fz * vf + rz * vl;
  } else {
    n.heading = wrapAngle(n.heading - n.steer * C.AIR_STEER * dt);
  }

  const prevY = n.y;
  n.x += n.vx * dt;
  n.z += n.vz * dt;

  let hit = groundAt(world, n.x, n.z, n.y, C.STEP_UP);

  // Rebords : on reste sur la route, mais ça ralentit
  if (hit && n.y < hit.groundY + C.WALL_HEIGHT) {
    const limit = HALF - C.WALL_INSET - C.CAR_HALF_WIDTH;
    const side = sign(hit.lateral);
    const hasWall = side > 0 ? hit.block.borderPos : hit.block.borderNeg;
    if (hasWall && Math.abs(hit.lateral) > limit) {
      const push = Math.abs(hit.lateral) - limit;
      // Droite du tracé : (-tz, tx)
      const trx = -hit.tz;
      const trz = hit.tx;
      n.x -= trx * push * side;
      n.z -= trz * push * side;
      const vOut = (n.vx * trx + n.vz * trz) * side;
      if (vOut > 0) {
        n.vx -= trx * side * vOut * (1 + C.WALL_BOUNCE);
        n.vz -= trz * side * vOut * (1 + C.WALL_BOUNCE);
      }
      n.vx *= C.WALL_SPEED_KEEP;
      n.vz *= C.WALL_SPEED_KEEP;
      n.onWall = true;
      hit = groundAt(world, n.x, n.z, n.y, C.STEP_UP);
    }
  }

  if (n.grounded) {
    const predicted = prevY + n.vy * dt - 0.5 * C.GRAVITY * dt * dt;
    if (hit && hit.groundY >= predicted - 0.02) {
      // La voiture suit le sol
      n.y = hit.groundY;
      n.vy = (n.y - prevY) / dt;
    } else {
      // Bosse, tremplin ou bord : la voiture décolle
      n.grounded = false;
      n.vy -= C.GRAVITY * dt;
      n.y = prevY + n.vy * dt;
    }
  } else {
    n.vy -= C.GRAVITY * dt;
    n.y += n.vy * dt;
    const land = groundAt(world, n.x, n.z, n.y, 2);
    if (land && n.y <= land.groundY && n.vy <= 0) {
      n.y = land.groundY;
      n.vy = 0;
      n.grounded = true;
    }
  }

  if (n.y < world.groundY + 0.2) n.fell = true;
  return n;
}
