import * as THREE from "three";

/**
 * Petit atelier de géométrie low-poly : des quadrilatères et triangles à facettes nettes,
 * chacun avec sa couleur, ses coordonnées de texture et une normale par face.
 * Toutes les géométries produites ont les mêmes attributs (position, normal, uv, color),
 * ce qui permet de les fusionner en un seul objet par matériau (peu d'appels de dessin).
 */
export class Mesher {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  get empty(): boolean {
    return this.pos.length === 0;
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color = WHITE, uvs?: [number, number][]): void {
    for (const [i, p] of [a, b, c].entries()) {
      this.pos.push(p.x, p.y, p.z);
      const t = uvs ? uvs[i]! : [0, 0];
      this.uv.push(t[0]!, t[1]!);
      this.col.push(color.r, color.g, color.b);
    }
  }

  /** Quadrilatère a-b-c-d dans le sens inverse des aiguilles d'une montre vu de l'extérieur. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color = WHITE, uvs?: [number, number][]): void {
    this.tri(a, b, c, color, uvs ? [uvs[0]!, uvs[1]!, uvs[2]!] : undefined);
    this.tri(a, c, d, color, uvs ? [uvs[0]!, uvs[2]!, uvs[3]!] : undefined);
  }

  /** Ajoute une géométrie existante (non indexée ou indexée), transformée et teintée. */
  addGeometry(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color = WHITE): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute("position");
    const u = g.getAttribute("uv");
    const c = g.getAttribute("color");
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      this.uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      if (c) this.col.push(c.getX(i) * color.r, c.getY(i) * color.g, c.getZ(i) * color.b);
      else this.col.push(color.r, color.g, color.b);
    }
  }

  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    return geo;
  }
}

export const WHITE = new THREE.Color(1, 1, 1);

/** Couleur sRGB (#rrggbb) convertie dans l'espace linéaire de rendu. */
export const col = (hex: number) => new THREE.Color(hex);

/**
 * Coque « loftée » : une suite de sections (contours fermés dans le plan x/y) placées le long de z.
 * Toutes les sections doivent avoir le même nombre de points. Les bouts sont fermés.
 * Donne des volumes de carrosserie à facettes, bien plus convaincants que des boîtes.
 */
export function loft(
  m: Mesher,
  sections: { z: number; pts: [number, number][] }[],
  color: THREE.Color | ((i: number, k: number) => THREE.Color),
  offset = new THREE.Vector3(),
  capEnds = true,
): void {
  const colorAt = typeof color === "function" ? color : () => color;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x + offset.x, y + offset.y, z + offset.z);
  // Sens du loft : les faces doivent regarder vers l'extérieur, que les sections aillent vers +z ou vers -z
  const forward = sections[sections.length - 1]!.z > sections[0]!.z;
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i]!;
    const b = sections[i + 1]!;
    const n = a.pts.length;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const [ax, ay] = a.pts[k]!;
      const [ax2, ay2] = a.pts[k2]!;
      const [bx, by] = b.pts[k]!;
      const [bx2, by2] = b.pts[k2]!;
      if (forward) m.quad(V(ax, ay, a.z), V(ax2, ay2, a.z), V(bx2, by2, b.z), V(bx, by, b.z), colorAt(i, k));
      else m.quad(V(ax, ay, a.z), V(bx, by, b.z), V(bx2, by2, b.z), V(ax2, ay2, a.z), colorAt(i, k));
    }
  }
  if (!capEnds) return;
  for (const [s, flip] of [
    [sections[0]!, forward],
    [sections[sections.length - 1]!, !forward],
  ] as const) {
    const n = s.pts.length;
    let cx = 0;
    let cy = 0;
    for (const [x, y] of s.pts) {
      cx += x / n;
      cy += y / n;
    }
    for (let k = 0; k < n; k++) {
      const [x1, y1] = s.pts[k]!;
      const [x2, y2] = s.pts[(k + 1) % n]!;
      const c = s === sections[0] ? colorAt(-1, k) : colorAt(sections.length - 1, k);
      if (flip) m.tri(V(cx, cy, s.z), V(x2, y2, s.z), V(x1, y1, s.z), c);
      else m.tri(V(cx, cy, s.z), V(x1, y1, s.z), V(x2, y2, s.z), c);
    }
  }
}

/** Contour symétrique à partir d'une demi-section (côté x > 0, du bas vers le haut). */
export function mirrored(half: [number, number][]): [number, number][] {
  const right = half;
  const left = [...half].reverse().map(([x, y]) => [-x, y] as [number, number]);
  // Évite de doubler les points posés sur l'axe
  const pts = [...right, ...left.filter(([x]) => Math.abs(x) > 1e-6)];
  return pts;
}

/** Bruit de valeur 2D lissé, déterministe (pour le relief et les variations du décor). */
export function makeNoise(seed: number): (x: number, z: number) => number {
  const hash = (i: number, j: number) => {
    let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const i = Math.floor(x);
    const j = Math.floor(z);
    const fx = smooth(x - i);
    const fz = smooth(z - j);
    const a = hash(i, j);
    const b = hash(i + 1, j);
    const c = hash(i, j + 1);
    const d = hash(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

/** Générateur pseudo-aléatoire déterministe. */
export function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
