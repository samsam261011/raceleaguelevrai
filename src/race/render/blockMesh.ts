import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WALL_HEIGHT, WALL_INSET } from "../physics/constants";
import { E, HALF, N, PIECES, rotSide, S, SIDE_DIR, STEP, TILE, W, type PathPoint, type PieceKind } from "../world/pieces";
import { cellKey, onBlock, type CompiledBlock, type World } from "../world/world";
import { col, Mesher } from "./geom";

/*
 * Pistes « Ligue Solaire » : asphalte anthracite propre, lignes de rive blanches, parapets de béton blanc
 * à bande orange, vibreurs orange et blanc à la corde, dalles profilées portées par des pylônes.
 * Toutes les pièces d'un circuit sont fusionnées par matériau : une poignée d'appels de dessin au total.
 */

// ---------- Palette ----------
const C = {
  concrete: col(0xece7de),
  concreteShade: col(0xc9c1b5),
  underside: col(0x8d8780),
  orange: col(0xffb23e),
  orangeDeep: col(0xe8892a),
  white: col(0xf3f0ea),
  red: col(0xe8423a),
  cyan: col(0x35e0ff),
  dark: col(0x2a2c31),
};

/** Profil du dessous d'une dalle (demi-largeur, hauteur sous la chaussée), du bord vers l'axe. */
const SLAB_EDGE = 0.55;
const GIRDER_DEPTH = 1.8;
export const SLAB_BOTTOM = GIRDER_DEPTH;
const UNDER: [number, number][] = [
  [HALF, -SLAB_EDGE],
  [6.6, -0.95],
  [5.4, -GIRDER_DEPTH],
];

// ---------- Textures dessinées (aucune image téléchargée) ----------
function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

function speckle(g: CanvasRenderingContext2D, s: number, n: number, alpha: number, seed: number): void {
  let x = seed;
  const r = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const v = r() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * (0.4 + r() * 0.6)})`;
    g.fillRect(r() * s, r() * s, 1 + r() * 1.5, 1 + r() * 1.5);
  }
}

function blotches(g: CanvasRenderingContext2D, s: number, n: number, rgb: string, alpha: number, seed: number): void {
  let x = seed;
  const r = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const cx = r() * s;
    const cy = r() * s;
    const rad = s * (0.08 + r() * 0.2);
    for (const ox of [-s, 0, s])
      for (const oy of [-s, 0, s]) {
        const grd = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
        grd.addColorStop(0, `rgba(${rgb},${alpha})`);
        grd.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = grd;
        g.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
      }
  }
}

interface TrackTextures {
  asphalt: THREE.CanvasTexture;
  plate: THREE.CanvasTexture;
  checker: THREE.CanvasTexture;
}
let texCache: TrackTextures | null = null;
/** La texture couvre une case entière : u = largeur (20 m), v = 20 m de long. */
function textures(): TrackTextures {
  if (texCache) return texCache;
  const asphalt = canvasTexture(512, (g, s) => {
    g.fillStyle = "#4a4c54";
    g.fillRect(0, 0, s, s);
    // Variations douces (pas de grain agressif) : le sol reste propre, mais vivant
    blotches(g, s, 10, "60,62,70", 0.18, 11);
    blotches(g, s, 8, "28,29,33", 0.2, 23);
    speckle(g, s, 9000, 0.035, 7);
    // Trajectoire plus sombre (traces de pneus) de part et d'autre du centre
    for (const cx of [0.36, 0.64]) {
      const grd = g.createLinearGradient((cx - 0.09) * s, 0, (cx + 0.09) * s, 0);
      grd.addColorStop(0, "rgba(20,20,24,0)");
      grd.addColorStop(0.5, "rgba(20,20,24,0.16)");
      grd.addColorStop(1, "rgba(20,20,24,0)");
      g.fillStyle = grd;
      g.fillRect((cx - 0.09) * s, 0, 0.18 * s, s);
    }
    // Joints de dalle tous les 10 m : fins, ils font défiler la vitesse
    g.fillStyle = "rgba(14,14,18,0.55)";
    g.fillRect(0, 0, s, 2);
    g.fillRect(0, s / 2, s, 2);
    g.fillStyle = "rgba(255,255,255,0.05)";
    g.fillRect(0, 2, s, 1);
    g.fillRect(0, s / 2 + 2, s, 1);
  });
  const plate = canvasTexture(512, (g, s) => {
    g.fillStyle = "#d3cdc2";
    g.fillRect(0, 0, s, s);
    blotches(g, s, 10, "190,182,170", 0.25, 5);
    speckle(g, s, 6000, 0.03, 3);
    // Panneaux de 10 m
    g.strokeStyle = "rgba(90,82,72,0.45)";
    g.lineWidth = 3;
    g.beginPath();
    for (const v of [1.5, s / 2]) {
      g.moveTo(0, v);
      g.lineTo(s, v);
      g.moveTo(v, 0);
      g.lineTo(v, s);
    }
    g.stroke();
  });
  const checker = canvasTexture(128, (g, s) => {
    const n = 8;
    for (let x = 0; x < n; x++)
      for (let y = 0; y < n; y++) {
        g.fillStyle = (x + y) % 2 ? "#17151d" : "#f4f1ea";
        g.fillRect((x * s) / n, (y * s) / n, s / n, s / n);
      }
  });
  checker.magFilter = THREE.NearestFilter;
  texCache = { asphalt, plate, checker };
  return texCache;
}

// ---------- Matériaux (partagés par toutes les pièces) ----------
type MatKey = "asphalt" | "plate" | "concrete" | "paint" | "glow" | "checker";
let mats: Record<MatKey, THREE.Material> | null = null;
function materials(): Record<MatKey, THREE.Material> {
  if (mats) return mats;
  const t = textures();
  const lambert = (p: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...p });
  mats = {
    asphalt: lambert({ map: t.asphalt }),
    plate: lambert({ map: t.plate }),
    concrete: lambert({ vertexColors: true }),
    // Peinture au sol : décalée pour ne jamais scintiller avec la chaussée
    paint: lambert({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
    checker: lambert({ map: t.checker, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  return mats;
}

// ---------- Construction d'une pièce ----------
export interface OpenSides {
  /** Côtés sans voisin à la même hauteur (bande rouge et blanche au bord des plaques). */
  pos: boolean;
  neg: boolean;
  start: boolean;
  end: boolean;
}
const ALL_OPEN: OpenSides = { pos: true, neg: true, start: true, end: true };

interface Frame {
  p: PathPoint;
  rx: number;
  rz: number;
}

/** Échantillonne la ligne centrale tous les 2 m au plus. */
function sample(path: PathPoint[]): { pts: PathPoint[]; frames: Frame[]; along: number[] } {
  const pts: PathPoint[] = [];
  path.forEach((p, i) => {
    if (i === 0) return void pts.push(p);
    const a = path[i - 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.z - a.z) / 2));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      pts.push({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t, z: a.z + (p.z - a.z) * t });
    }
  });
  const n = pts.length;
  const frames = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { p, rx: -dz / l, rz: dx / l };
  });
  const along: number[] = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  return { pts, frames, along };
}

/** Géométries d'une pièce, rangées par matériau, dans le repère de la pièce. */
function pieceParts(kind: PieceKind, borders: { pos: boolean; neg: boolean }, open: OpenSides): Partial<Record<MatKey, THREE.BufferGeometry>> {
  const def = PIECES[kind];
  const { frames, along } = sample(def.path);
  const n = frames.length;
  const at = (i: number, lat: number, dy = 0) => {
    const f = frames[i]!;
    return new THREE.Vector3(f.p.x + f.rx * lat, f.p.y + dy, f.p.z + f.rz * lat);
  };
  const m: Record<MatKey, Mesher> = {
    asphalt: new Mesher(),
    plate: new Mesher(),
    concrete: new Mesher(),
    paint: new Mesher(),
    glow: new Mesher(),
    checker: new Mesher(),
  };
  const surface = def.look === "road" ? m.asphalt : m.plate;
  const length = along[n - 1]!;

  // Chaussée (les plaques gardent une texture alignée sur la case)
  for (let i = 0; i < n - 1; i++) {
    const v0 = along[i]! / TILE;
    const v1 = along[i + 1]! / TILE;
    surface.quad(at(i, -HALF), at(i + 1, -HALF), at(i + 1, HALF), at(i, HALF), undefined, [
      [0, v0],
      [0, v1],
      [1, v1],
      [1, v0],
    ]);
  }

  // Sens du virage : l'intérieur reçoit le vibreur
  let turn = 0;
  if (n > 2) {
    const a = frames[0]!;
    const b = frames[n - 1]!;
    turn = a.rx * (b.p.x - a.p.x) + a.rz * (b.p.z - a.p.z);
  }
  const curved = Math.abs(turn) > 1;
  const innerSide = turn > 0 ? 1 : -1;

  // Parapets, lignes de rive et vibreurs
  for (const s of [1, -1]) {
    const has = s > 0 ? borders.pos : borders.neg;
    const inner = HALF - WALL_INSET;
    if (has) {
      // Profil du parapet : face intérieure, chanfrein orange, dessus, face extérieure jusqu'au bas de la dalle
      const prof: [number, number, THREE.Color][] = [
        [inner, 0, C.concrete],
        [inner, WALL_HEIGHT - 0.24, C.orange],
        [inner + 0.2, WALL_HEIGHT, C.concrete],
        [HALF, WALL_HEIGHT, C.concrete],
        [HALF, -SLAB_EDGE, C.concrete],
      ];
      for (let i = 0; i < n - 1; i++) {
        for (let k = 0; k < prof.length - 1; k++) {
          const [l0, h0, c] = prof[k]!;
          const [l1, h1] = prof[k + 1]!;
          m.concrete.quad(at(i, s * l0, h0), at(i + 1, s * l0, h0), at(i + 1, s * l1, h1), at(i, s * l1, h1), c);
        }
      }
      // Bouts du parapet
      for (const i of [0, n - 1]) {
        const pts = prof.map(([l, h]) => at(i, s * l, h));
        for (let k = 1; k < pts.length - 1; k++) m.concrete.tri(pts[0]!, pts[k]!, pts[k + 1]!, C.concreteShade);
      }
      // Ligne de rive blanche
      if (def.look === "road") {
        const a = inner - 0.55;
        const b = a - 0.32;
        for (let i = 0; i < n - 1; i++) m.paint.quad(at(i, s * b, 0.01), at(i + 1, s * b, 0.01), at(i + 1, s * a, 0.01), at(i, s * a, 0.01), C.white);
      }
    } else {
      // Pas de parapet : simple bord de dalle
      for (let i = 0; i < n - 1; i++) m.concrete.quad(at(i, s * HALF, 0), at(i + 1, s * HALF, 0), at(i + 1, s * HALF, -SLAB_EDGE), at(i, s * HALF, -SLAB_EDGE), C.concrete);
      // Bande rouge et blanche : le vide est là
      const isOpen = s > 0 ? open.pos : open.neg;
      if (def.look !== "road" && isOpen) {
        for (let i = 0; i < n - 1; i++) {
          const c = Math.floor((along[i]! + along[i + 1]!) / 2 / 2) % 2 ? C.red : C.white;
          m.paint.quad(at(i, s * (HALF - 0.9), 0.01), at(i + 1, s * (HALF - 0.9), 0.01), at(i + 1, s * HALF, 0.01), at(i, s * HALF, 0.01), c);
        }
      }
    }
    // Vibreur plat à la corde des virages
    if (curved && s === innerSide && def.look === "road" && (has || kind !== "virage")) {
      const a = (has ? inner : HALF) - 0.05;
      const b = a - 1.5;
      for (let i = 0; i < n - 1; i++) {
        const c = Math.floor((along[i]! + along[i + 1]!) / 2 / 2.2) % 2 ? C.orange : C.white;
        m.paint.quad(at(i, s * b, 0.02), at(i + 1, s * b, 0.02), at(i + 1, s * a, 0.06), at(i, s * a, 0.06), c);
        m.paint.quad(at(i, s * a, 0.06), at(i + 1, s * a, 0.06), at(i + 1, s * a, 0.0), at(i, s * a, 0.0), c);
      }
    }
  }

  // Bandes aux extrémités des plaques sans voisin
  if (def.look !== "road") {
    for (const [i, isOpen, dir] of [
      [0, open.start, 1],
      [n - 1, open.end, -1],
    ] as const) {
      if (!isOpen) continue;
      const f = frames[i]!;
      const tz = f.rx; // tangente = (rz, -rx) ; on avance de 0,9 m dans la pièce
      const tx = -f.rz;
      const d = 0.9 * dir;
      for (let k = 0; k < 10; k++) {
        const l0 = -HALF + k * 2;
        const l1 = l0 + 2;
        const c = k % 2 ? C.red : C.white;
        const p0 = at(i, l0, 0.01);
        const p1 = at(i, l1, 0.01);
        const q0 = p0.clone().add(new THREE.Vector3(-tx * d, 0, -tz * d));
        const q1 = p1.clone().add(new THREE.Vector3(-tx * d, 0, -tz * d));
        m.paint.quad(p0, p1, q1, q0, c);
      }
    }
  }

  // Tremplin : chevrons orange et blancs sur la lèvre
  if (kind === "tremplin") {
    for (let i = 0; i < n - 1; i++) {
      if (along[i]! < length - 2.4) continue;
      for (let k = 0; k < 10; k++) {
        const l0 = -HALF + WALL_INSET + k * ((TILE - 2 * WALL_INSET) / 10);
        const l1 = l0 + (TILE - 2 * WALL_INSET) / 10;
        m.paint.quad(at(i, l0, 0.02), at(i + 1, l0, 0.02), at(i + 1, l1, 0.02), at(i, l1, 0.02), k % 2 ? C.orange : C.white);
      }
    }
  }

  // Dessous profilé : bord de dalle, sous-face inclinée, poutre centrale
  const profile: [number, number][] = [...UNDER, ...[...UNDER].reverse().map(([l, h]) => [-l, h] as [number, number])];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < profile.length - 1; k++) {
      const [l0, h0] = profile[k]!;
      const [l1, h1] = profile[k + 1]!;
      const flat = Math.abs(h0 - h1) < 0.01;
      m.concrete.quad(at(i, l0, h0), at(i + 1, l0, h0), at(i + 1, l1, h1), at(i, l1, h1), flat ? C.underside : C.concreteShade);
    }
  }
  // Bouts de la dalle (cachés quand une pièce suit)
  const cap: [number, number][] = [[HALF, 0], ...profile, [-HALF, 0]];
  for (const i of [0, n - 1]) {
    const pts = cap.map(([l, h]) => at(i, l, h));
    const c = at(i, 0, -0.9);
    for (let k = 0; k < pts.length; k++) m.concrete.tri(c, pts[k]!, pts[(k + 1) % pts.length]!, C.concreteShade);
  }

  if (def.gate) gate(def.gate, m);

  const out: Partial<Record<MatKey, THREE.BufferGeometry>> = {};
  for (const k of Object.keys(m) as MatKey[]) if (!m[k].empty) out[k] = m[k].geometry();
  return out;
}

/** Portique au milieu de la pièce : arche de béton (départ, arrivée) ou arche orange (checkpoint). */
function gate(kind: "start" | "finish" | "checkpoint", m: Record<MatKey, Mesher>): void {
  const cp = kind === "checkpoint";
  const H = cp ? 7.2 : 9;
  const half = HALF + (cp ? 0.7 : 1.1);
  const w = cp ? 0.9 : 1.5;
  const body = cp ? C.orange : C.concrete;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Pylône chanfreiné (section octogonale), plus large en bas
  const pylon = (x: number) => {
    const ring = (r: number, y: number) =>
      Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        return V(x + Math.cos(a) * r, y, Math.sin(a) * r * 0.8);
      });
    const levels: [number, number, THREE.Color][] = [
      [w * 0.85, -SLAB_EDGE, body],
      [w * 0.7, 1.2, body],
      [w * 0.6, H - 1.6, cp ? C.white : C.orange],
      [w * 0.6, H - 0.9, body],
      [w * 0.6, H + 0.6, body],
    ];
    for (let l = 0; l < levels.length - 1; l++) {
      const a = ring(levels[l]![0], levels[l]![1]);
      const b = ring(levels[l + 1]![0], levels[l + 1]![1]);
      for (let k = 0; k < 8; k++) m.concrete.quad(a[k]!, a[(k + 1) % 8]!, b[(k + 1) % 8]!, b[k]!, levels[l]![2]);
    }
  };
  pylon(-half);
  pylon(half);
  // Poutre avec chanfreins
  const bh = cp ? 0.9 : 2.2;
  const bd = cp ? 0.7 : 1.3;
  const y0 = H - (cp ? 0.2 : 0.6);
  const sec: [number, number][] = [
    [-bd / 2, y0],
    [bd / 2, y0],
    [bd / 2 + 0.15, y0 + 0.2],
    [bd / 2 + 0.15, y0 + bh - 0.2],
    [bd / 2, y0 + bh],
    [-bd / 2, y0 + bh],
    [-bd / 2 - 0.15, y0 + bh - 0.2],
    [-bd / 2 - 0.15, y0 + 0.2],
  ];
  const L = half + w * 0.7;
  for (let k = 0; k < sec.length; k++) {
    const [z0, yy0] = sec[k]!;
    const [z1, yy1] = sec[(k + 1) % sec.length]!;
    m.concrete.quad(V(-L, yy0, z0), V(L, yy0, z0), V(L, yy1, z1), V(-L, yy1, z1), k === 2 || k === 6 ? (cp ? C.white : C.orange) : body);
  }
  for (const x of [-L, L]) {
    const pts = sec.map(([z, y]) => V(x, y, z));
    for (let k = 1; k < pts.length - 1; k++) m.concrete.tri(pts[0]!, pts[k]!, pts[k + 1]!, body);
  }
  if (!cp) {
    // Panneaux en damier sur les deux faces de la poutre, et ligne au sol
    for (const z of [bd / 2 + 0.16, -bd / 2 - 0.16]) {
      const a = V(-L + 1.2, y0 + 0.35, z);
      const b = V(L - 1.2, y0 + 0.35, z);
      const c = V(L - 1.2, y0 + bh - 0.35, z);
      const d = V(-L + 1.2, y0 + bh - 0.35, z);
      const rep = (2 * L - 2.4) / (bh - 0.7) / 4;
      m.checker.quad(a, b, c, d, undefined, [
        [0, 0],
        [rep, 0],
        [rep, 0.25],
        [0, 0.25],
      ]);
    }
    m.checker.quad(V(-HALF + WALL_INSET, 0.015, -1), V(HALF - WALL_INSET, 0.015, -1), V(HALF - WALL_INSET, 0.015, 1), V(-HALF + WALL_INSET, 0.015, 1), undefined, [
      [0, 0],
      [9.4, 0],
      [9.4, 1],
      [0, 1],
    ]);
  } else {
    // Bandeau lumineux sous la poutre du checkpoint
    m.glow.quad(V(-half + 0.8, y0 - 0.02, -0.2), V(half - 0.8, y0 - 0.02, -0.2), V(half - 0.8, y0 - 0.02, 0.2), V(-half + 0.8, y0 - 0.02, 0.2), col(0xfff1c2));
  }
}

function meshesFrom(parts: Partial<Record<MatKey, THREE.BufferGeometry>>): THREE.Mesh[] {
  const mt = materials();
  return (Object.keys(parts) as MatKey[]).map((k) => {
    const mesh = new THREE.Mesh(parts[k]!, mt[k]);
    mesh.castShadow = k === "concrete" || k === "asphalt" || k === "plate";
    mesh.receiveShadow = k !== "glow";
    return mesh;
  });
}

/** Une pièce seule (aperçu de l'éditeur), dans son repère. */
export function buildPieceMesh(kind: PieceKind, borders = PIECES[kind].borders, open: OpenSides = ALL_OPEN): THREE.Group {
  const g = new THREE.Group();
  g.add(...meshesFrom(pieceParts(kind, borders, open)));
  return g;
}

/** Côtés d'une pièce d'une case sans voisin à la même hauteur. */
function openSides(world: World, cb: CompiledBlock): OpenSides {
  if (cb.cells.length !== 1) return ALL_OPEN;
  const b = cb.block;
  const free = (side: number) => {
    const [dx, dz] = SIDE_DIR[rotSide(side as 0, b.rot)]!;
    return !(world.cells.get(cellKey(b.x + dx, b.z + dz)) ?? []).some((i) => world.blocks[i]!.block.level === b.level);
  };
  return { pos: free(W), neg: free(E), start: free(S), end: free(N) };
}

/**
 * Tous les blocs d'une map. `merge` (course) : une géométrie par matériau pour tout le circuit.
 * Sans fusion (éditeur) : un groupe par pièce, qui garde son numéro pour la gomme.
 */
export function buildWorldMesh(world: World, merge = false): THREE.Group {
  const g = new THREE.Group();
  const byMat = new Map<MatKey, THREE.BufferGeometry[]>();
  const obj = new THREE.Object3D();
  for (const cb of world.blocks) {
    const parts = pieceParts(cb.block.kind, { pos: cb.borderPos, neg: cb.borderNeg }, openSides(world, cb));
    if (merge) {
      placeBlock(obj, cb.block);
      obj.updateMatrix();
      for (const k of Object.keys(parts) as MatKey[]) {
        const geo = parts[k]!.applyMatrix4(obj.matrix);
        (byMat.get(k) ?? byMat.set(k, []).get(k)!).push(geo);
      }
    } else {
      const piece = new THREE.Group();
      piece.add(...meshesFrom(parts));
      placeBlock(piece, cb.block);
      piece.userData.block = cb.index;
      g.add(piece);
    }
  }
  if (merge) {
    const merged: Partial<Record<MatKey, THREE.BufferGeometry>> = {};
    for (const [k, list] of byMat) merged[k] = mergeGeometries(list)!;
    g.add(...meshesFrom(merged));
  }
  g.add(buildPillars(world));
  return g;
}

export function placeBlock(obj: THREE.Object3D, b: { x: number; z: number; level: number; rot: number }): void {
  obj.position.set(b.x * TILE, b.level * STEP, b.z * TILE);
  obj.rotation.y = (b.rot * Math.PI) / 2;
}

// ---------- Pylônes ----------
let pillarGeo: { shaft: THREE.BufferGeometry; cap: THREE.BufferGeometry; foot: THREE.BufferGeometry; band: THREE.BufferGeometry } | null = null;
function pillarGeometries() {
  if (pillarGeo) return pillarGeo;
  // Fût octogonal de hauteur 1 (mis à l'échelle), légèrement évasé vers le bas
  const shaft = new THREE.CylinderGeometry(1.0, 1.25, 1, 8, 1, true);
  shaft.translate(0, 0.5, 0);
  // Chapeau en marteau sous la poutre : large en travers de la route
  const cap = new THREE.BufferGeometry();
  {
    const m = new Mesher();
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const bot = [V(-1.1, 0, -0.9), V(1.1, 0, -0.9), V(1.1, 0, 0.9), V(-1.1, 0, 0.9)];
    const top = [V(-4.6, 1.3, -1.1), V(4.6, 1.3, -1.1), V(4.6, 1.3, 1.1), V(-4.6, 1.3, 1.1)];
    const top2 = [V(-4.6, 1.8, -1.1), V(4.6, 1.8, -1.1), V(4.6, 1.8, 1.1), V(-4.6, 1.8, 1.1)];
    for (let k = 0; k < 4; k++) {
      m.quad(bot[k]!, bot[(k + 1) % 4]!, top[(k + 1) % 4]!, top[k]!);
      m.quad(top[k]!, top[(k + 1) % 4]!, top2[(k + 1) % 4]!, top2[k]!);
    }
    m.quad(bot[0]!, bot[3]!, bot[2]!, bot[1]!);
    cap.copy(m.geometry());
  }
  const foot = new THREE.CylinderGeometry(1.7, 2.0, 0.8, 8);
  foot.translate(0, 0.4, 0);
  const band = new THREE.CylinderGeometry(1.16, 1.16, 0.55, 8, 1, true);
  pillarGeo = { shaft, cap, foot, band };
  return pillarGeo;
}

const pillarMats = {
  shaft: new THREE.MeshLambertMaterial({ color: 0xe4ded3 }),
  cap: new THREE.MeshLambertMaterial({ color: 0xd8d1c5, vertexColors: true }),
  foot: new THREE.MeshLambertMaterial({ color: 0xbdb5a8 }),
  band: new THREE.MeshLambertMaterial({ color: 0xffb23e }),
};

/** Un pylône environ tous les 20 m sous chaque pièce en hauteur, posé sur la pièce du dessous ou sur le sol. */
function buildPillars(world: World): THREE.Object3D {
  const list: { x: number; z: number; top: number; bottom: number; yaw: number }[] = [];
  for (const cb of world.blocks) {
    const { pts, along } = sample(cb.def.path);
    const len = along[along.length - 1]!;
    const count = Math.max(1, Math.round(len / TILE));
    const local = new THREE.Object3D();
    placeBlock(local, cb.block);
    local.updateMatrix();
    for (let k = 0; k < count; k++) {
      const target = ((k + 0.5) * len) / count;
      let i = 0;
      while (i < along.length - 2 && along[i + 1]! < target) i++;
      const t = (target - along[i]!) / Math.max(1e-6, along[i + 1]! - along[i]!);
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const p = new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t).applyMatrix4(local.matrix);
      const d = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).transformDirection(local.matrix);
      const top = p.y - GIRDER_DEPTH;
      // Le pylône descend jusqu'à la pièce juste en dessous, ou jusqu'au sol
      let bottom = world.groundY - 0.2;
      const cell = cellKey(Math.round(p.x / TILE), Math.round(p.z / TILE));
      for (const j of world.cells.get(cell) ?? []) {
        const o = world.blocks[j]!;
        if (o === cb) continue;
        const h = onBlock(o, p.x, p.z);
        if (h && h.groundY < top - 0.5) bottom = Math.max(bottom, h.groundY);
      }
      if (top - bottom < 0.6) continue;
      list.push({ x: p.x, z: p.z, top, bottom, yaw: Math.atan2(d.x, d.z) });
    }
  }
  const geo = pillarGeometries();
  const g = new THREE.Group();
  const make = (geom: THREE.BufferGeometry, mat: THREE.Material, place: (m: THREE.Matrix4, it: (typeof list)[number]) => boolean) => {
    const mats4: THREE.Matrix4[] = [];
    for (const it of list) {
      const m = new THREE.Matrix4();
      if (place(m, it)) mats4.push(m);
    }
    const mesh = new THREE.InstancedMesh(geom, mat, Math.max(1, mats4.length));
    mats4.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = mats4.length;
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  };
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  make(geo.shaft, pillarMats.shaft, (m, it) => {
    const capH = 1.8;
    const h = it.top - capH - it.bottom;
    if (h <= 0.05) return false;
    m.compose(new THREE.Vector3(it.x, it.bottom, it.z), q.setFromAxisAngle(up, it.yaw), new THREE.Vector3(1, h, 1));
    return true;
  });
  make(geo.cap, pillarMats.cap, (m, it) => {
    m.compose(new THREE.Vector3(it.x, it.top - 1.8, it.z), q.setFromAxisAngle(up, it.yaw), new THREE.Vector3(1, 1, 1));
    return it.top - it.bottom > 2.2;
  });
  make(geo.foot, pillarMats.foot, (m, it) => {
    m.compose(new THREE.Vector3(it.x, it.bottom - 0.1, it.z), q.setFromAxisAngle(up, it.yaw + Math.PI / 8), new THREE.Vector3(1, 1, 1));
    return it.top - it.bottom > 3;
  });
  make(geo.band, pillarMats.band, (m, it) => {
    m.compose(new THREE.Vector3(it.x, it.bottom + 2.6, it.z), q.setFromAxisAngle(up, it.yaw), new THREE.Vector3(1, 1, 1));
    return it.top - it.bottom > 6;
  });
  return g;
}

export type { CompiledBlock };
