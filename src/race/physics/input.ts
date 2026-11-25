/** Une entrée de joueur pour un pas de physique, codée sur un octet (replays très légers). */
export const IN_THROTTLE = 1;
export const IN_BRAKE = 2;
export const IN_LEFT = 4;
export const IN_RIGHT = 8;
export const IN_DRIFT = 16;

export type InputBits = number;

export function has(bits: InputBits, flag: number): boolean {
  return (bits & flag) !== 0;
}
