import type { CarState } from "../physics/car";
import { IN_BRAKE, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "../physics/input";
import type { Route } from "../world/route";

/**
 * Pilote automatique très simple qui suit le chemin normal de la map.
 * Sert aux tests (la map est-elle faisable ?) et au mode développeur. Déterministe.
 */
export function makeAutopilot(route: Route, lookahead = 14, maxSpeedInTurn = 30): (car: CarState) => number {
  let idx = 0;
  let first = true;
  const n = route.px.length;
  return (car) => {
    // Point du chemin le plus proche, en avançant seulement (tout le chemin au premier appel)
    let bestD = Infinity;
    const end = first ? n : Math.min(n, idx + 60);
    first = false;
    for (let i = idx; i < end; i++) {
      const dx = route.px[i]! - car.x;
      const dy = route.py[i]! - car.y;
      const dz = route.pz[i]! - car.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        idx = i;
      }
    }
    // Position projetée sur le segment courant, pour viser à distance constante
    let along = route.dist[idx]!;
    if (idx < n - 1) {
      const sx = route.px[idx + 1]! - route.px[idx]!;
      const sy = route.py[idx + 1]! - route.py[idx]!;
      const sz = route.pz[idx + 1]! - route.pz[idx]!;
      const L = route.dist[idx + 1]! - route.dist[idx]!;
      const t = ((car.x - route.px[idx]!) * sx + (car.y - route.py[idx]!) * sy + (car.z - route.pz[idx]!) * sz) / (L * L);
      if (t > 0) along += Math.min(1, t) * L;
    }
    // Plus vite, on vise plus loin : sinon le pilote corrige trop sec et zigzague (au décollage d'un tremplin, c'est la chute)
    const goal = along + lookahead + 0.2 * Math.max(0, car.speed - 30);
    let target = idx;
    while (target < n - 1 && route.dist[target]! < goal) target++;
    // Cible dans le repère de la voiture (fonctionne aussi à l'envers dans un looping ou sur un mur)
    const dx = route.px[target]! - car.x;
    const dy = route.py[target]! - car.y;
    const dz = route.pz[target]! - car.z;
    const { qx, qy, qz, qw } = car;
    const lx = 1 - 2 * (qy * qy + qz * qz);
    const ly = 2 * (qx * qy + qw * qz);
    const lz = 2 * (qx * qz - qw * qy);
    const fx = 2 * (qx * qz + qw * qy);
    const fy = 2 * (qy * qz - qw * qx);
    const fz = 1 - 2 * (qx * qx + qy * qy);
    const dot = fx * dx + fy * dy + fz * dz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const side = -(lx * dx + ly * dy + lz * dz) / len;
    let bits = 0;
    if (car.grounded) {
      if (side > 0.04) bits |= IN_RIGHT;
      else if (side < -0.04) bits |= IN_LEFT;
    } else {
      // En l'air, viser un point ne sert à rien (la trajectoire ne change plus) : on garde le nez dans l'axe
      // de la vitesse, pour se poser bien droit
      const vh = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
      if (vh > 1) {
        const vs = -(lx * car.vx + lz * car.vz) / vh;
        if (vs > 0.03) bits |= IN_RIGHT;
        else if (vs < -0.03) bits |= IN_LEFT;
      }
    }

    // Virage à venir : on ralentit si le chemin tourne beaucoup plus loin
    let far = target;
    while (far < n - 1 && route.dist[far]! < goal + 35) far++;
    const dir = (i: number) => {
      const j = Math.min(n - 1, i + 1);
      const k = j === i ? i - 1 : i;
      const ax = route.px[j]! - route.px[k]!;
      const ay = route.py[j]! - route.py[k]!;
      const az = route.pz[j]! - route.pz[k]!;
      const l = Math.sqrt(ax * ax + az * az);
      // Segment presque vertical (looping) : pas un virage, on le saute
      if (l < 0.5 * Math.sqrt(ax * ax + ay * ay + az * az)) return null;
      return [ax / l, az / l] as const;
    };
    const d1 = dir(target);
    const d2 = dir(far);
    // Un tronçon plus vertical qu'horizontal d'ici là (looping) : ce n'est pas un virage à plat
    let steep = false;
    for (let i = idx; i < far && !steep; i++) {
      const ax = route.px[i + 1]! - route.px[i]!;
      const ay = route.py[i + 1]! - route.py[i]!;
      const az = route.pz[i + 1]! - route.pz[i]!;
      steep = ay * ay > ax * ax + az * az;
    }
    const turn = d1 && d2 && !steep ? 1 - (d1[0] * d2[0] + d1[1] * d2[1]) : 0;
    const speed = car.speed;
    const limit = turn > 0.6 ? maxSpeedInTurn * 0.55 : turn > 0.25 ? maxSpeedInTurn : turn > 0.1 ? maxSpeedInTurn + 12 : 999;
    if (speed > limit + 2 && dot > 0) bits |= IN_BRAKE;
    else if (speed < limit) bits |= IN_THROTTLE;
    return bits;
  };
}
