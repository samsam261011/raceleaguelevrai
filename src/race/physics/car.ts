import { clamp, dcos, dsin, sign, wrapAngle } from "../math/dmath";
import { queryTrack } from "../track/build";
import type { Track } from "../track/types";
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
  /** Indice de piste le plus proche (accélère la recherche). */
  trackIndex: number;
  /** Distance parcourue le long de la piste. */
  along: number;
  fell: boolean;
}

export function spawnCar(track: Track): CarState {
  const i = 2;
  return {
    x: track.px[i]!,
    y: track.py[i]!,
    z: track.pz[i]!,
    heading: headingOf(track.tx[i]!, track.tz[i]!),
    vx: 0,
    vz: 0,
    vy: 0,
    steer: 0,
    grounded: true,
    onWall: false,
    trackIndex: i,
    along: track.dist[i]!,
    fell: false,
  };
}

/** Cap correspondant à une direction (tx, tz), calculé sans trigonométrie de la plateforme. */
function headingOf(tx: number, tz: number): number {
  let best = 0;
  let bestErr = Infinity;
  const scan = (lo: number, hi: number, steps: number) => {
    for (let k = 0; k <= steps; k++) {
      const a = lo + ((hi - lo) * k) / steps;
      const e = (dsin(a) - tx) ** 2 + (dcos(a) - tz) ** 2;
      if (e < bestErr) {
        bestErr = e;
        best = a;
      }
    }
  };
  scan(-Math.PI, Math.PI, 720);
  scan(best - 0.01, best + 0.01, 200);
  return best;
}

export function copyCar(s: CarState): CarState {
  return { ...s };
}

/** Avance la voiture d'un pas de physique (1/120 s). Fonction pure et déterministe. */
export function stepCar(s: CarState, input: InputBits, track: Track): CarState {
  const n: CarState = { ...s, onWall: false };
  if (n.fell) return n;
  const dt = C.DT;

  // Volant progressif
  const target = (has(input, IN_RIGHT) ? 1 : 0) - (has(input, IN_LEFT) ? 1 : 0);
  const maxDelta = C.STEER_RESPONSE * dt;
  n.steer += clamp(target - n.steer, -maxDelta, maxDelta);

  let fx = dsin(n.heading);
  let fz = dcos(n.heading);
  // Droite de la voiture
  let rx = -fz;
  let rz = fx;
  let vf = n.vx * fx + n.vz * fz;
  let vl = n.vx * rx + n.vz * rz;

  if (n.grounded) {
    if (has(input, IN_THROTTLE) && vf < C.VMAX) vf += C.ENGINE * (1 - vf / C.VMAX) * dt;
    if (has(input, IN_BRAKE)) {
      if (vf > 0.5) vf = Math.max(0, vf - C.BRAKE * dt);
      else if (vf > -C.REVERSE_MAX) vf -= C.REVERSE_ACCEL * dt;
    }
    vf -= vf * C.ROLL_DRAG;

    const speedAbs = Math.abs(vf);
    const lowSpeed = clamp(speedAbs / 8, 0, 1);
    const highSpeed = 1 - 0.3 * clamp(speedAbs / C.VMAX, 0, 1);
    n.heading = wrapAngle(n.heading - n.steer * C.STEER_MAX * lowSpeed * highSpeed * sign(vf) * dt);

    vl *= C.GRIP_KEEP;

    // Recompose la vitesse dans le nouveau repère de la voiture
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

  let hit = queryTrack(track, n.x, n.z, n.y, n.trackIndex);

  // Rebords : on reste sur la piste, mais ça ralentit
  if (hit.solid && n.y < hit.groundY + C.WALL_HEIGHT) {
    const limit = hit.halfWidth - C.CAR_HALF_WIDTH;
    if (Math.abs(hit.lateral) > limit) {
      const side = sign(hit.lateral);
      const push = Math.abs(hit.lateral) - limit;
      // Droite de la piste : (-tz, tx)
      const trx = -track.tz[hit.index]!;
      const trz = track.tx[hit.index]!;
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
      hit = queryTrack(track, n.x, n.z, n.y, hit.index);
    }
  }
  n.trackIndex = hit.index;
  n.along = hit.along;

  if (n.grounded) {
    const predicted = prevY + n.vy * dt - 0.5 * C.GRAVITY * dt * dt;
    if (hit.onSurface && hit.groundY >= predicted - 0.02) {
      // La voiture suit le sol
      n.y = hit.groundY;
      n.vy = (n.y - prevY) / dt;
    } else {
      // Bosse ou tremplin : la voiture décolle
      n.grounded = false;
      n.vy -= C.GRAVITY * dt;
      n.y = prevY + n.vy * dt;
    }
  } else {
    n.vy -= C.GRAVITY * dt;
    n.y += n.vy * dt;
    if (hit.onSurface && n.y <= hit.groundY && n.y >= hit.groundY - 1.5) {
      n.y = hit.groundY;
      n.vy = 0;
      n.grounded = true;
    }
  }

  if (n.y < track.minY - C.FALL_DEPTH) n.fell = true;
  return n;
}
