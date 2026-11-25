import { dcos, dsin } from "../math/dmath";
import type { CarState } from "../physics/car";
import { IN_BRAKE, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "../physics/input";
import type { Route } from "../world/route";

/**
 * Pilote automatique très simple qui suit le chemin normal de la map.
 * Sert aux tests (la map est-elle faisable ?) et au mode développeur. Déterministe.
 */
export function makeAutopilot(route: Route, lookahead = 14, maxSpeedInTurn = 34): (car: CarState) => number {
  let idx = 0;
  const n = route.px.length;
  return (car) => {
    // Point du chemin le plus proche, en avançant seulement
    let bestD = Infinity;
    for (let i = idx; i < Math.min(n, idx + 60); i++) {
      const dx = route.px[i]! - car.x;
      const dz = route.pz[i]! - car.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        idx = i;
      }
    }
    // Position projetée sur le segment courant, pour viser à distance constante
    let along = route.dist[idx]!;
    if (idx < n - 1) {
      const sx = route.px[idx + 1]! - route.px[idx]!;
      const sz = route.pz[idx + 1]! - route.pz[idx]!;
      const L = route.dist[idx + 1]! - route.dist[idx]!;
      const t = ((car.x - route.px[idx]!) * sx + (car.z - route.pz[idx]!) * sz) / (L * L);
      if (t > 0) along += Math.min(1, t) * L;
    }
    const goal = along + lookahead;
    let target = idx;
    while (target < n - 1 && route.dist[target]! < goal) target++;
    const dx = route.px[target]! - car.x;
    const dz = route.pz[target]! - car.z;
    const fx = dsin(car.heading);
    const fz = dcos(car.heading);
    const cross = fx * dz - fz * dx;
    const dot = fx * dx + fz * dz;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const side = cross / len;
    let bits = 0;
    if (side > 0.04) bits |= IN_RIGHT;
    else if (side < -0.04) bits |= IN_LEFT;

    // Virage à venir : on ralentit si le chemin tourne beaucoup plus loin
    let far = target;
    while (far < n - 1 && route.dist[far]! < goal + 35) far++;
    const dir = (i: number) => {
      const j = Math.min(n - 1, i + 1);
      const k = j === i ? i - 1 : i;
      const ax = route.px[j]! - route.px[k]!;
      const az = route.pz[j]! - route.pz[k]!;
      const l = Math.sqrt(ax * ax + az * az) || 1;
      return [ax / l, az / l] as const;
    };
    const [t1x, t1z] = dir(target);
    const [t2x, t2z] = dir(far);
    const turn = 1 - (t1x * t2x + t1z * t2z);
    const speed = car.vx * fx + car.vz * fz;
    const limit = turn > 0.6 ? maxSpeedInTurn * 0.55 : turn > 0.25 ? maxSpeedInTurn : turn > 0.1 ? maxSpeedInTurn + 12 : 999;
    if (speed > limit + 2 && dot > 0) bits |= IN_BRAKE;
    else if (speed < limit) bits |= IN_THROTTLE;
    return bits;
  };
}
