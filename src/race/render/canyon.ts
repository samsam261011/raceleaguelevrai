import * as THREE from "three";
import { HALF, TILE } from "../world/pieces";
import type { World } from "../world/world";
import { col, makeNoise, Mesher, rng } from "./geom";

/*
 * Le Canyon de la Ligue : sol de sable ocre avec des taches d'herbe olive, buttes de terre cuite en strates,
 * falaise continue noyée dans la brume, bosquets d'arbres variés, un lac turquoise, une tribune au départ.
 * Trois plans de profondeur : proche (piste, bosquets), moyen (buttes, lac), lointain (falaise).
 * Tout est généré par le code, de façon déterministe, et dessiné en peu d'appels (instances, fusion).
 */

const PAL = {
  sand: col(0xd9a066),
  sandLight: col(0xe4b27c),
  sandDark: col(0xc58b55),
  grass: col(0x8a9c45),
  grassDark: col(0x6f8a3a),
  rock: col(0xc4643c),
  rockLight: col(0xd27a4a),
  rockDark: col(0xa9543a),
  ledge: col(0xdfa46c),
  trunk: col(0x7a5236),
  leaf: col(0x6f8f3a),
  leafLight: col(0x8aa648),
  leafDark: col(0x56742f),
  stone: col(0xb98a5e),
  concrete: col(0xece7de),
  concreteShade: col(0xc9c1b5),
  orange: col(0xffb23e),
  seatDark: col(0x3a3842),
  water: 0x3ec7c2,
};

interface Mesa {
  x: number;
  z: number;
  r: number;
}

export function decorate(scene: THREE.Scene, world: World): void {
  const { minX, maxX, minZ, maxZ } = world.bounds;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 60;
  const gy = world.groundY;
  const rnd = rng(1234567);
  const noise = makeNoise(7);
  const noise2 = makeNoise(19);

  // Distance à la piste (centres des cases occupées)
  const cells: [number, number][] = [];
  for (const k of world.cells.keys()) {
    const [x, z] = k.split(",").map(Number) as [number, number];
    cells.push([x * TILE, z * TILE]);
  }
  const trackDist = (x: number, z: number) => {
    let d = Infinity;
    for (const [px, pz] of cells) {
      const dx = Math.max(0, Math.abs(x - px) - HALF);
      const dz = Math.max(0, Math.abs(z - pz) - HALF);
      d = Math.min(d, Math.hypot(dx, dz));
    }
    return d;
  };

  // Lac : du côté le plus dégagé, hors du circuit
  const lakeA = rnd() * Math.PI * 2;
  const lake = { x: cx + Math.cos(lakeA) * (radius + 170), z: cz + Math.sin(lakeA) * (radius + 170), r: 120 };
  const lakeDepth = (x: number, z: number) => {
    const d = Math.hypot(x - lake.x, z - lake.z) / lake.r;
    return d < 1.35 ? (1 - smooth(Math.max(0, d - 0.55) / 0.8)) * 6 : 0;
  };

  // Relief : plat près de la piste, dunes douces plus loin, qui montent vers la falaise
  const height = (x: number, z: number) => {
    const d = trackDist(x, z);
    const rise = smooth(Math.min(1, Math.max(0, (d - 35) / 220)));
    const dunes = (noise(x / 160, z / 160) * 0.7 + noise(x / 55, z / 55) * 0.3) * 26;
    return gy - 0.02 + rise * dunes - lakeDepth(x, z);
  };

  // ---------- Sol ----------
  {
    const size = 3400;
    const segs = 136;
    const step = size / segs;
    const m = new Mesher();
    const x0 = cx - size / 2;
    const z0 = cz - size / 2;
    const P = (i: number, j: number) => {
      const x = x0 + i * step;
      const z = z0 + j * step;
      return new THREE.Vector3(x, height(x, z), z);
    };
    const grid: THREE.Vector3[][] = [];
    for (let i = 0; i <= segs; i++) {
      grid.push([]);
      for (let j = 0; j <= segs; j++) grid[i]!.push(P(i, j));
    }
    const colorAt = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      const x = (a.x + b.x + c.x) / 3;
      const z = (a.z + b.z + c.z) / 3;
      const y = (a.y + b.y + c.y) / 3 - gy;
      const n = noise(x / 90, z / 90);
      const g = noise2(x / 70, z / 70);
      if (y < -1.5) return PAL.sandDark;
      if (y > 14) return n > 0.5 ? PAL.rockLight : PAL.rock;
      if (g > 0.64 && y < 8) return g > 0.74 ? PAL.grassDark : PAL.grass;
      return n > 0.62 ? PAL.sandLight : n < 0.32 ? PAL.sandDark : PAL.sand;
    };
    for (let i = 0; i < segs; i++)
      for (let j = 0; j < segs; j++) {
        const a = grid[i]![j]!;
        const b = grid[i + 1]![j]!;
        const c = grid[i + 1]![j + 1]!;
        const d = grid[i]![j + 1]!;
        m.tri(a, d, c, colorAt(a, d, c));
        m.tri(a, c, b, colorAt(a, c, b));
      }
    const ground = new THREE.Mesh(m.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = true;
    scene.add(ground);

    const water = new THREE.Mesh(
      new THREE.CircleGeometry(lake.r * 1.15, 40),
      new THREE.MeshStandardMaterial({ color: PAL.water, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.92 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(lake.x, gy - 1.6, lake.z);
    water.receiveShadow = true;
    scene.add(water);
  }

  // ---------- Buttes en strates (plan moyen) ----------
  const mesas: Mesa[] = [];
  {
    const m = new Mesher();
    let tries = 0;
    while (mesas.length < 13 && tries++ < 200) {
      const a = rnd() * Math.PI * 2;
      const r = 35 + rnd() * 55;
      const d = radius * (1.0 + rnd() * 1.1) + 90;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (trackDist(x, z) < r + 45) continue;
      if (Math.hypot(x - lake.x, z - lake.z) < lake.r + r + 20) continue;
      if (mesas.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 25)) continue;
      mesas.push({ x, z, r });
      mesa(m, x, z, r, 45 + rnd() * 75, gy - 4, rnd);
    }
    // Falaise continue qui ferme l'horizon (plan lointain)
    const R = Math.min(1050, Math.max(620, radius * 1.9 + 260));
    cliff(m, cx, cz, R, gy - 6, noise, rnd);
    const mesh = new THREE.Mesh(m.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
  }

  // ---------- Végétation et rochers en bosquets ----------
  {
    const kinds = vegetationKinds();
    const placed: THREE.Matrix4[][] = kinds.map(() => []);
    const tints: THREE.Color[][] = kinds.map(() => []);
    const free = (x: number, z: number, margin: number) =>
      trackDist(x, z) > margin && lakeDepth(x, z) === 0 && !mesas.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 6);
    const put = (k: number, x: number, z: number, s: number) => {
      const y = height(x, z) - 0.4;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      placed[k]!.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.9 + rnd() * 0.25), s)));
      const v = 0.86 + rnd() * 0.24;
      tints[k]!.push(new THREE.Color(v, v * (0.97 + rnd() * 0.06), v * (0.94 + rnd() * 0.08)));
    };
    for (let c = 0; c < 70; c++) {
      const a = rnd() * Math.PI * 2;
      const d = radius * (0.15 + rnd() * 1.6) + 30;
      const bx = cx + Math.cos(a) * d;
      const bz = cz + Math.sin(a) * d;
      // Chaque bosquet a son caractère : pins, arbres ronds, ou buissons
      const theme = rnd();
      const count = 3 + Math.floor(rnd() * 6);
      for (let i = 0; i < count; i++) {
        const x = bx + (rnd() - 0.5) * 34;
        const z = bz + (rnd() - 0.5) * 34;
        if (!free(x, z, 14)) continue;
        const k = theme < 0.38 ? (rnd() < 0.8 ? 0 : 2) : theme < 0.75 ? (rnd() < 0.75 ? 1 : 2) : rnd() < 0.6 ? 2 : 3;
        put(k, x, z, 0.75 + rnd() * 0.65);
      }
    }
    // Rochers au pied des buttes
    for (const o of mesas) {
      for (let i = 0; i < 6; i++) {
        const a = rnd() * Math.PI * 2;
        const x = o.x + Math.cos(a) * (o.r + 4 + rnd() * 14);
        const z = o.z + Math.sin(a) * (o.r + 4 + rnd() * 14);
        if (trackDist(x, z) > 12) put(3, x, z, 0.8 + rnd() * 1.6);
      }
    }
    kinds.forEach((geo, k) => {
      const list = placed[k]!;
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
      list.forEach((mt, i) => {
        mesh.setMatrixAt(i, mt);
        mesh.setColorAt(i, tints[k]![i]!);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    });
  }

  // ---------- Tribune et mâts d'éclairage au départ ----------
  const start = world.gates.find((g) => g.kind === "start");
  if (start) {
    const rx = -start.dz;
    const rz = start.dx;
    for (const side of [1, -1]) {
      const off = HALF + 22;
      const ok = [-20, 0, 20].every((t) => trackDist(start.x + rx * side * off + start.dx * t, start.z + rz * side * off + start.dz * t) > 12);
      if (!ok) continue;
      const stand = grandstand();
      stand.position.set(start.x + rx * side * off, gy, start.z + rz * side * off);
      // Les gradins font face à la piste
      stand.rotation.y = Math.atan2(rx * side, rz * side);
      scene.add(stand);
      break;
    }
  }

  // ---------- Nuages : gros, plats dessous, éclairés chaud ----------
  {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8f7f86, flatShading: true });
    const puffs = 6;
    const count = 18;
    const clouds = new THREE.InstancedMesh(geo, mat, count * puffs);
    const m4 = new THREE.Matrix4();
    let n = 0;
    for (let k = 0; k < count; k++) {
      const a = rnd() * Math.PI * 2;
      const d = 420 + rnd() * 700;
      const bx = cx + Math.cos(a) * d;
      const bz = cz + Math.sin(a) * d;
      const by = world.bounds.maxY + 140 + rnd() * 120;
      const base = 22 + rnd() * 26;
      for (let p = 0; p < puffs; p++) {
        const s = base * (0.55 + rnd() * 0.6);
        m4.compose(
          new THREE.Vector3(bx + (p - puffs / 2) * base * 0.75, by + rnd() * base * 0.25, bz + (rnd() - 0.5) * base),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)),
          new THREE.Vector3(s, s * 0.42, s * 0.8),
        );
        clouds.setMatrixAt(n++, m4);
      }
    }
    scene.add(clouds);
  }
}

function smooth(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

/** Butte à sommet plat en 3 ou 4 strates, chaque strate un peu en retrait, contour irrégulier. */
function mesa(m: Mesher, x: number, z: number, r: number, h: number, base: number, rnd: () => number): void {
  const nv = 9 + Math.floor(rnd() * 4);
  const shape = Array.from({ length: nv }, (_, k) => {
    const a = (k / nv) * Math.PI * 2 + rnd() * 0.25;
    return { c: Math.cos(a), s: Math.sin(a), f: 0.78 + rnd() * 0.38 };
  });
  const tiers = 3 + Math.floor(rnd() * 2);
  const colors = [PAL.rock, PAL.rockLight, PAL.rockDark, PAL.rock];
  let y = base;
  let scale = 1;
  const ring = (y: number, sc: number) => shape.map((p) => new THREE.Vector3(x + p.c * r * p.f * sc, y, z + p.s * r * p.f * sc));
  for (let t = 0; t < tiers; t++) {
    const th = (h + 4) * (t === 0 ? 0.42 : (0.58 / (tiers - 1)) * (0.85 + rnd() * 0.3));
    const bottom = ring(y, scale);
    const top = ring(y + th, scale * 0.95);
    const c = colors[t % colors.length]!;
    for (let k = 0; k < nv; k++) m.quad(bottom[k]!, bottom[(k + 1) % nv]!, top[(k + 1) % nv]!, top[k]!, c);
    y += th;
    const next = scale * (0.8 + rnd() * 0.08);
    const ledge = ring(y, next);
    for (let k = 0; k < nv; k++) m.quad(top[k]!, top[(k + 1) % nv]!, ledge[(k + 1) % nv]!, ledge[k]!, PAL.ledge);
    scale = next;
  }
  const top = ring(y, scale);
  const c = new THREE.Vector3(x, y, z);
  for (let k = 0; k < nv; k++) m.tri(c, top[(k + 1) % nv]!, top[k]!, PAL.ledge);
}

/** Falaise en anneau : paroi en deux strates et plateau, hauteur variable. */
function cliff(m: Mesher, cx: number, cz: number, R: number, base: number, noise: (x: number, z: number) => number, rnd: () => number): void {
  const n = 72;
  const rows = Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    const h = 90 + noise(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + 10) * 150 + rnd() * 20;
    const dr = (rnd() - 0.5) * 50;
    return { c: Math.cos(a), s: Math.sin(a), h, dr };
  });
  const P = (k: number, rr: number, y: number) => {
    const p = rows[k % n]!;
    return new THREE.Vector3(cx + p.c * (rr + p.dr), y, cz + p.s * (rr + p.dr));
  };
  for (let k = 0; k < n; k++) {
    const a = rows[k]!;
    const b = rows[(k + 1) % n]!;
    const mid = (h: number) => base + h * 0.48;
    // Strate basse
    m.quad(P(k, R, base), P(k + 1, R, base), P(k + 1, R + 14, mid(b.h)), P(k, R + 14, mid(a.h)), PAL.rock);
    // Corniche
    m.quad(P(k, R + 14, mid(a.h)), P(k + 1, R + 14, mid(b.h)), P(k + 1, R + 34, mid(b.h) + 3), P(k, R + 34, mid(a.h) + 3), PAL.ledge);
    // Strate haute
    m.quad(P(k, R + 34, mid(a.h) + 3), P(k + 1, R + 34, mid(b.h) + 3), P(k + 1, R + 46, base + b.h), P(k, R + 46, base + a.h), k % 2 ? PAL.rockLight : PAL.rockDark);
    // Plateau
    m.quad(P(k, R + 46, base + a.h), P(k + 1, R + 46, base + b.h), P(k + 1, R + 400, base + b.h * 0.9), P(k, R + 400, base + a.h * 0.9), PAL.ledge);
  }
}

/** Quatre silhouettes : pin parasol, arbre rond, buisson, rocher. Chacune une seule géométrie colorée. */
function vegetationKinds(): THREE.BufferGeometry[] {
  const T = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
  // Pin parasol : tronc fin et haut, couronne large et plate en deux étages
  const pine = new Mesher();
  pine.addGeometry(new THREE.CylinderGeometry(0.28, 0.42, 8, 6), T(0, 4, 0), PAL.trunk);
  pine.addGeometry(new THREE.IcosahedronGeometry(1, 1), T(0, 8.6, 0, 5.2, 1.5, 4.6), PAL.leaf);
  pine.addGeometry(new THREE.IcosahedronGeometry(1, 0), T(1.6, 9.6, 0.6, 3.2, 1.1, 2.8, 0.7), PAL.leafLight);
  // Arbre rond : tronc court, couronne en boule irrégulière
  const round = new Mesher();
  round.addGeometry(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 6), T(0, 1.7, 0), PAL.trunk);
  round.addGeometry(new THREE.IcosahedronGeometry(3.1, 1), T(0, 5, 0, 1, 0.88, 1), PAL.leafDark);
  round.addGeometry(new THREE.IcosahedronGeometry(1.8, 0), T(1.4, 6.3, -0.6), PAL.leaf);
  // Buisson bas
  const bush = new Mesher();
  bush.addGeometry(new THREE.IcosahedronGeometry(1.7, 0), T(0, 0.7, 0, 1, 0.6, 1), PAL.leafLight);
  bush.addGeometry(new THREE.IcosahedronGeometry(1.1, 0), T(1.3, 0.6, 0.4, 1, 0.65, 1), PAL.leaf);
  // Rocher anguleux
  const rock = new Mesher();
  rock.addGeometry(new THREE.DodecahedronGeometry(1.8, 0), T(0, 0.6, 0, 1.2, 0.7, 1), PAL.stone);
  rock.addGeometry(new THREE.DodecahedronGeometry(1.0, 0), T(1.6, 0.3, 0.5, 1, 0.8, 1.2), PAL.rockLight);
  return [pine.geometry(), round.geometry(), bush.geometry(), rock.geometry()];
}

/** Tribune de béton blanc à sièges orange, auvent fin sur colonnes. Gradins tournés vers -z local. */
function grandstand(): THREE.Mesh {
  const m = new Mesher();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const L = 44;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: THREE.Color, top = c) => {
    m.quad(V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1), top);
    m.quad(V(x0, y0, z0), V(x1, y0, z0), V(x1, y1, z0), V(x0, y1, z0), c);
    m.quad(V(x0, y0, z1), V(x0, y1, z1), V(x1, y1, z1), V(x1, y0, z1), c);
    m.quad(V(x0, y0, z0), V(x0, y1, z0), V(x0, y1, z1), V(x0, y0, z1), c);
    m.quad(V(x1, y0, z0), V(x1, y0, z1), V(x1, y1, z1), V(x1, y1, z0), c);
  };
  // Socle et gradins
  box(-L / 2, L / 2, -1, 1.6, -2, 0, PAL.concreteShade, PAL.concrete);
  for (let t = 0; t < 7; t++) {
    const z0 = t * 1.3;
    const y1 = 1.6 + (t + 1) * 0.85;
    box(-L / 2, L / 2, -1, y1, z0, z0 + 1.3, PAL.concreteShade, PAL.concrete);
    // Rangée de sièges
    box(-L / 2 + 1, L / 2 - 1, y1, y1 + 0.35, z0 + 0.65, z0 + 1.05, t % 2 ? PAL.orange : PAL.seatDark);
  }
  // Mur arrière, colonnes et auvent
  box(-L / 2, L / 2, -1, 13, 9.1, 9.7, PAL.concreteShade, PAL.concrete);
  for (const x of [-L / 2 + 1, -L / 6, L / 6, L / 2 - 1]) box(x - 0.25, x + 0.25, 1.6, 14, 8.6, 9.1, PAL.concrete);
  box(-L / 2 - 1, L / 2 + 1, 14, 14.5, -1.5, 9.8, PAL.concrete);
  box(-L / 2 - 1, L / 2 + 1, 13.6, 14, -1.5, -1.0, PAL.orange);
  // Deux mâts d'éclairage
  for (const x of [-L / 2 - 6, L / 2 + 6]) {
    box(x - 0.45, x + 0.45, -1, 24, 3.5, 4.4, PAL.concrete);
    box(x - 2.2, x + 2.2, 24, 26, 3.2, 4.7, PAL.seatDark);
  }
  const mesh = new THREE.Mesh(m.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Sol plat de sable (éditeur). */
export function buildGround(groundY: number): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d9a066";
  g.fillRect(0, 0, 256, 256);
  const r = rng(99);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? "255,240,210" : "120,70,30"},${0.04 + r() * 0.06})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const size = 4000;
  tex.repeat.set(size / (2 * TILE), size / (2 * TILE));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(TILE / 2, groundY, TILE / 2);
  ground.receiveShadow = true;
  return ground;
}
