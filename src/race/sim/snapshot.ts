import type { CarState } from "../physics/car";

/**
 * Instantané de voiture à plat dans un Float64Array : c'est ce que la simulation (dans son Worker)
 * envoie à l'affichage à chaque image. Un tableau de nombres se transfère sans copie entre les deux.
 * Float64 : les valeurs arrivent exactement telles que la physique les a calculées.
 */
export const CAR_FIELDS = 17 + 4 * 3;

export function packCar(s: CarState, out: Float64Array, at: number): void {
  out[at] = s.x;
  out[at + 1] = s.y;
  out[at + 2] = s.z;
  out[at + 3] = s.qx;
  out[at + 4] = s.qy;
  out[at + 5] = s.qz;
  out[at + 6] = s.qw;
  out[at + 7] = s.heading;
  out[at + 8] = s.vx;
  out[at + 9] = s.vy;
  out[at + 10] = s.vz;
  out[at + 11] = s.speed;
  out[at + 12] = s.steer;
  out[at + 13] = s.wheelAngle;
  out[at + 14] = s.grounded ? 1 : 0;
  out[at + 15] = s.onWall ? 1 : 0;
  out[at + 16] = s.fell ? 1 : 0;
  for (let k = 0; k < 4; k++) {
    const w = s.wheels[k]!;
    out[at + 17 + k * 3] = w.drop;
    out[at + 18 + k * 3] = w.contact ? 1 : 0;
    out[at + 19 + k * 3] = w.spin;
  }
}

export function unpackCar(a: Float64Array, at: number): CarState {
  const wheels = [];
  for (let k = 0; k < 4; k++) wheels.push({ drop: a[at + 17 + k * 3]!, contact: a[at + 18 + k * 3] === 1, spin: a[at + 19 + k * 3]! });
  return {
    x: a[at]!,
    y: a[at + 1]!,
    z: a[at + 2]!,
    qx: a[at + 3]!,
    qy: a[at + 4]!,
    qz: a[at + 5]!,
    qw: a[at + 6]!,
    heading: a[at + 7]!,
    vx: a[at + 8]!,
    vy: a[at + 9]!,
    vz: a[at + 10]!,
    speed: a[at + 11]!,
    steer: a[at + 12]!,
    wheelAngle: a[at + 13]!,
    grounded: a[at + 14] === 1,
    onWall: a[at + 15] === 1,
    fell: a[at + 16] === 1,
    wheels,
  };
}

/** Copie profonde d'un état (sans dépendre du moteur physique). */
export function cloneCar(s: CarState): CarState {
  return { ...s, wheels: s.wheels.map((w) => ({ ...w })) };
}
