/**
 * Maths déterministes.
 *
 * Math.sin / Math.cos peuvent donner des résultats légèrement différents
 * selon le navigateur ou la machine. Pour que les replays (et l'anti-triche
 * côté serveur) retombent exactement sur le même temps partout, la physique
 * n'utilise que des additions, multiplications, divisions et Math.sqrt,
 * qui sont garanties identiques par la norme IEEE 754.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** Ramène un angle dans [-PI, PI]. */
export function wrapAngle(a: number): number {
  return a - TWO_PI * Math.round(a / TWO_PI);
}

/** Sinus déterministe (erreur < 1e-9 sur tout le cercle). */
export function dsin(a: number): number {
  let x = wrapAngle(a);
  // sin(x) = sin(PI - x) : on se ramène à [-PI/2, PI/2]
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  // Série de Taylor jusqu'à x^15
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

/** Cosinus déterministe. */
export function dcos(a: number): number {
  return dsin(a + HALF_PI);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
