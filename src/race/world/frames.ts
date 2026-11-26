/**
 * Repères le long d'une ligne centrale de piste : en chaque point, la direction du tracé,
 * la « droite » de la route et son « haut » (la normale de la surface).
 *
 * C'est ce qui permet à la piste de se pencher (virage relevé), de se dresser (mur) ou de s'enrouler
 * (looping) : la surface n'est plus forcément horizontale. L'affichage et les collisions utilisent
 * exactement ces repères, la voiture touche donc ce qu'on voit.
 * Uniquement + - * / et Math.sqrt : identique sur toutes les machines.
 */

export interface PathPointLike {
  x: number;
  y: number;
  z: number;
  /** Haut de la surface en ce point (vertical si absent). */
  ux?: number;
  uy?: number;
  uz?: number;
}

export interface PathFrame {
  x: number;
  y: number;
  z: number;
  /** Direction du tracé (unitaire). */
  tx: number;
  ty: number;
  tz: number;
  /** Droite de la route, mise à l'échelle dans les coudes pour garder toute la largeur (onglet). */
  rx: number;
  ry: number;
  rz: number;
  /** Haut de la surface (unitaire, perpendiculaire à la droite et au tracé). */
  ux: number;
  uy: number;
  uz: number;
}

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.sqrt(x * x + y * y + z * z);
  return l > 1e-12 ? [x / l, y / l, z / l] : [0, 0, 0];
}

/** Direction du segment i → i+1 (unitaire). */
function segDir(p: ArrayLike<PathPointLike>, i: number): [number, number, number] {
  const a = p[i]!;
  const b = p[i + 1]!;
  return norm(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * Repères en chaque point. La tangente est la moyenne des deux segments voisins ;
 * la droite est tangente × haut, puis le haut est recalculé pour former un repère orthonormé.
 * En vue de dessus, la droite d'une route plate vaut (-tz, 0, tx).
 */
export function pathFrames(p: ArrayLike<PathPointLike>): PathFrame[] {
  const n = p.length;
  const out: PathFrame[] = [];
  for (let i = 0; i < n; i++) {
    const da = segDir(p, Math.max(0, i - 1));
    const db = segDir(p, Math.min(n - 2, i));
    const [tx, ty, tz] = norm(da[0] + db[0], da[1] + db[1], da[2] + db[2]);
    const q = p[i]!;
    const hx = q.ux ?? 0;
    const hy = q.uy ?? 1;
    const hz = q.uz ?? 0;
    // Droite = tangente × haut
    let [rx, ry, rz] = norm(ty * hz - tz * hy, tz * hx - tx * hz, tx * hy - ty * hx);
    // Haut = droite × tangente
    const [ux, uy, uz] = norm(ry * tz - rz * ty, rz * tx - rx * tz, rx * ty - ry * tx);
    // Onglet : dans un coude, la section est en biais ; on l'élargit pour garder la largeur de la route
    const ca = da[0] * tx + da[1] * ty + da[2] * tz;
    const cb = db[0] * tx + db[1] * ty + db[2] * tz;
    const m = ca * cb > 0.25 ? 1 / Math.sqrt(ca * cb) : 2;
    rx *= m;
    ry *= m;
    rz *= m;
    out.push({ x: q.x, y: q.y, z: q.z, tx, ty, tz, rx, ry, rz, ux, uy, uz });
  }
  return out;
}

/** Point de la surface : `lat` mètres vers la droite, `h` mètres vers le haut de la surface. */
export function framePoint(f: PathFrame, lat: number, h: number): [number, number, number] {
  return [f.x + f.rx * lat + f.ux * h, f.y + f.ry * lat + f.uy * h, f.z + f.rz * lat + f.uz * h];
}

/** Repère intermédiaire entre deux repères (positions et axes interpolés linéairement). */
export function lerpFrame(a: PathFrame, b: PathFrame, t: number): PathFrame {
  const l = (u: number, v: number) => u + (v - u) * t;
  return {
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    z: l(a.z, b.z),
    tx: l(a.tx, b.tx),
    ty: l(a.ty, b.ty),
    tz: l(a.tz, b.tz),
    rx: l(a.rx, b.rx),
    ry: l(a.ry, b.ry),
    rz: l(a.rz, b.rz),
    ux: l(a.ux, b.ux),
    uy: l(a.uy, b.uy),
    uz: l(a.uz, b.uz),
  };
}

/**
 * Ajoute des repères intermédiaires pour qu'aucun pas ne dépasse `maxStep` mètres.
 * L'affichage et les collisions passent tous deux par ici : la surface touchée est celle qu'on voit.
 */
export function densify(frames: readonly PathFrame[], maxStep = 2): PathFrame[] {
  const out: PathFrame[] = [];
  frames.forEach((f, i) => {
    if (i === 0) return void out.push(f);
    const a = frames[i - 1]!;
    const dx = f.x - a.x;
    const dy = f.y - a.y;
    const dz = f.z - a.z;
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / maxStep));
    for (let k = 1; k <= steps; k++) out.push(k === steps ? f : lerpFrame(a, f, k / steps));
  });
  return out;
}

/**
 * Nombre de bandes dans la largeur de la chaussée. Une pièce vrillée (virage relevé, mur) n'est pas plane :
 * découpée en bandes étroites, chaque facette reste presque plane et la surface ne fait pas de pli.
 */
export const SURFACE_COLUMNS = 8;
