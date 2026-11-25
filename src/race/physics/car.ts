import { clamp, dcos, dsin, sign, wrapAngle } from "../math/dmath";
import { queryTrack } from "../track/build";
import type { Track } from "../track/types";
import * as C from "./constants";
import { has, IN_BRAKE, IN_DRIFT, IN_LEFT, IN_RIGHT, IN_THROTTLE, type InputBits } from "./input";

export interface CarState {
  x: number;
  y: number;
  z: number;
  /** Cap : 0 = vers +z, angle positif = vers +x. */
  heading: number;
  vx: number;
  vz: number;
  vy: number;
  /** Position actuelle du volant, de -1 (gauche) à 1 (droite). */
  steer: number;
  grounded: boolean;
  drifting: boolean;
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
    drifting: false,
    trackIndex: i,
    along: track.dist[i]!,
    fell: false,
  };
}

/** Cap correspondant à une direction (tx, tz), calculé sans trigonométrie de la plateforme. */
function headingOf(tx: number, tz: number): number {
  // Recherche dichotomique de l'angle dont (sin, cos) = (tx, tz) : déterministe.
  let lo = -Math.PI;
  let hi = Math.PI;
  let best = 0;
  let bestErr = Infinity;
  for (let k = 0; k <= 720; k++) {
    const a = lo + ((hi - lo) * k) / 720;
    const e = (dsin(a) - tx) ** 2 + (dcos(a) - tz) ** 2;
    if (e < bestErr) {
      bestErr = e;
      best = a;
    }
  }
  lo = best - 0.01;
  hi = best + 0.01;
  for (let k = 0; k <= 200; k++) {
    const a = lo + ((hi - lo) * k) / 200;
    const e = (dsin(a) - tx) ** 2 + (dcos(a) - tz) ** 2;
    if (e < bestErr) {
      bestErr = e;
      best = a;
    }
  }
  return best;
}

export function copyCar(s: CarState): CarState {
  return { ...s };
}

/** Avance la voiture d'un pas de physique (1/120 s). Fonction pure et déterministe. */
export function stepCar(s: CarState, input: InputBits, track: Track): CarState {
  const n: CarState = { ...s };
  if (n.fell) return n;
  const dt = C.DT;

  // Volant progressif
  const target = (has(input, IN_RIGHT) ? 1 : 0) - (has(input, IN_LEFT) ? 1 : 0);
  const maxDelta = C.STEER_RESPONSE * dt;
  n.steer += clamp(target - n.steer, -maxDelta, maxDelta);

  const fx = dsin(n.heading);
  const fz = dcos(n.heading);
  // Vecteur droite
  const rx = fz;
  const rz = -fx;
  let vf = n.vx * fx + n.vz * fz;
  let vl = n.vx * rx + n.vz * rz;

  if (n.grounded) {
    const throttle = has(input, IN_THROTTLE);
    const brake = has(input, IN_BRAKE);
    n.drifting = has(input, IN_DRIFT) && vf > 12 && Math.abs(n.steer) > 0.3;

    if (throttle && vf < C.VMAX) vf += C.ENGINE * (1 - vf / C.VMAX) * dt;
    if (brake) {
      if (vf > 0.5) vf = Math.max(0, vf - C.BRAKE * dt);
      else if (vf > -C.REVERSE_MAX) vf -= C.REVERSE_ACCEL * dt;
    }
    vf -= vf * (n.drifting ? C.DRIFT_DRAG + C.ROLL_DRAG : C.ROLL_DRAG);

    const speedAbs = Math.abs(vf);
    const lowSpeed = clamp(speedAbs / 8, 0, 1);
    const highSpeed = 1 - 0.35 * clamp(speedAbs / C.VMAX, 0, 1);
    const boost = n.drifting ? C.DRIFT_STEER_BOOST : 1;
    n.heading = wrapAngle(n.heading + n.steer * C.STEER_MAX * lowSpeed * highSpeed * boost * sign(vf) * dt);

    vl *= n.drifting ? C.DRIFT_GRIP_KEEP : C.GRIP_KEEP;

    // Recompose la vitesse dans le nouveau repère de la voiture
    const nfx = dsin(n.heading);
    const nfz = dcos(n.heading);
    n.vx = nfx * vf + nfz * vl;
    n.vz = nfz * vf - nfx * vl;
  } else {
    n.drifting = false;
    n.heading = wrapAngle(n.heading + n.steer * C.AIR_STEER * dt);
  }

  const prevY = n.y;
  n.x += n.vx * dt;
  n.z += n.vz * dt;

  const hit = queryTrack(track, n.x, n.z, n.y, n.trackIndex);
  n.trackIndex = hit.index;
  n.along = hit.along;

  if (n.grounded) {
    const predicted = prevY + n.vy * dt - 0.5 * C.GRAVITY * dt * dt;
    if (hit.onSurface && hit.groundY >= predicted - 0.02) {
      // La voiture suit le sol
      n.y = hit.groundY;
      n.vy = (n.y - prevY) / dt;
    } else {
      // Bosse ou bord de piste : la voiture décolle
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
