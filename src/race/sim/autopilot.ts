import type { CarState } from "../physics/car";
import { dcos, dsin } from "../math/dmath";
import { IN_BRAKE, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "../physics/input";
import type { Track } from "../track/types";

/**
 * Pilote automatique simple : vise un point devant sur la piste et accélère.
 * Sert aux tests (vérifier qu'une map est faisable) et à calibrer les médailles.
 */
export function autopilot(car: CarState, track: Track, lookahead = 14, maxSpeedInTurn = 34): number {
  let target = car.trackIndex;
  const goal = car.along + lookahead;
  while (target < track.count - 1 && track.dist[target]! < goal) target++;
  const dx = track.px[target]! - car.x;
  const dz = track.pz[target]! - car.z;
  const fx = dsin(car.heading);
  const fz = dcos(car.heading);
  // Produit vectoriel : > 0 si la cible est à droite
  const cross = fx * dz - fz * dx;
  const dot = fx * dx + fz * dz;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const side = -cross / len;
  let bits = 0;
  if (side > 0.04) bits |= IN_RIGHT;
  else if (side < -0.04) bits |= IN_LEFT;

  // Courbure à venir : on ralentit si la piste tourne beaucoup plus loin
  let far = target;
  while (far < track.count - 1 && track.dist[far]! < goal + 40) far++;
  const turn = 1 - (track.tx[target]! * track.tx[far]! + track.tz[target]! * track.tz[far]!);
  const speed = car.vx * fx + car.vz * fz;
  const limit = turn > 0.25 ? maxSpeedInTurn : turn > 0.1 ? maxSpeedInTurn + 10 : 99;
  if (speed > limit + 2 && dot > 0) bits |= IN_BRAKE;
  else if (speed < limit) bits |= IN_THROTTLE;
  return bits;
}
