import * as THREE from "three";
import { WALL_HEIGHT, WALL_INSET } from "../physics/constants";
import { HALF, PIECES, STEP, TILE, type PathPoint, type PieceDef, type PieceKind } from "../world/pieces";
import { blockCells, onBlock, type CompiledBlock, type World } from "../world/world";

const SLAB = 1;

// ---------- Textures générées (aucune image à télécharger) ----------
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, base: string, n: number, seed: number) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const v = rnd() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${0.04 + rnd() * 0.06})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

let cache: { road: THREE.Texture; plate: THREE.Texture; boost: THREE.Texture } | null = null;
function textures() {
  if (cache) return cache;
  // Route : asphalte avec ligne centrale en pointillés (u = largeur, v = 10 m de long)
  const road = canvasTexture(256, 256, (g) => {
    grain(g, 256, 256, "#5b5f67", 2600, 7);
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fillRect(124, 0, 8, 128);
    g.fillStyle = "rgba(0,0,0,0.10)";
    g.fillRect(0, 0, 256, 6);
  });
  // Plaque : béton clair à carreaux
  const plate = canvasTexture(256, 256, (g) => {
    grain(g, 256, 256, "#b9bcc2", 2200, 11);
    g.strokeStyle = "rgba(0,0,0,0.16)";
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, 253, 253);
    g.beginPath();
    g.moveTo(128, 0);
    g.lineTo(128, 256);
    g.moveTo(0, 128);
    g.lineTo(256, 128);
    g.stroke();
  });
  // Booster : chevrons lumineux qui pointent vers l'avant (+v)
  const boost = canvasTexture(256, 256, (g) => {
    g.fillStyle = "#1e2a4a";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#35e0ff";
    // Le haut de l'image est vers l'avant : les chevrons pointent vers le haut
    for (const y0 of [20, 148]) {
      g.beginPath();
      g.moveTo(40, y0 + 60);
      g.lineTo(128, y0);
      g.lineTo(216, y0 + 60);
      g.lineTo(216, y0 + 94);
      g.lineTo(128, y0 + 34);
      g.lineTo(40, y0 + 94);
      g.closePath();
      g.fill();
    }
  });
  cache = { road, plate, boost };
  return cache;
}

const MAT = {
  side: new THREE.MeshLambertMaterial({ color: 0x9a9da4, side: THREE.DoubleSide }),
  under: new THREE.MeshLambertMaterial({ color: 0x6d7078, side: THREE.DoubleSide }),
  border: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  pillar: new THREE.MeshLambertMaterial({ color: 0xd9d2c3, flatShading: true }),
};
let surfaceMats: Record<PieceDef["look"], THREE.Material> | null = null;
function surfaceMat(look: PieceDef["look"]): THREE.Material {
  if (!surfaceMats) {
    const t = textures();
    surfaceMats = {
      road: new THREE.MeshLambertMaterial({ map: t.road, side: THREE.DoubleSide }),
      plate: new THREE.MeshLambertMaterial({ map: t.plate, side: THREE.DoubleSide }),
      boost: new THREE.MeshLambertMaterial({ map: t.boost, emissive: 0x0a3550, side: THREE.DoubleSide }),
    };
  }
  return surfaceMats[look];
}

const RED = new THREE.Color(0xe0393b);
const WHITE = new THREE.Color(0xf6f6f6);

/**
 * Maillage d'une pièce dans son repère (centre de la case d'ancrage, hauteur 0).
 * `borders` permet de retirer un rebord quand une pièce voisine est collée.
 */
export function buildPieceMesh(kind: PieceKind, borders = PIECES[kind].borders): THREE.Group {
  const def = PIECES[kind];
  // Découpe en morceaux de 2 m au plus (bandes rouges et blanches régulières, pentes bien lisses)
  const pts: PathPoint[] = [];
  def.path.forEach((p, i) => {
    if (i === 0) return void pts.push(p);
    const a = def.path[i - 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.z - a.z) / 2));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      pts.push({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t, z: a.z + (p.z - a.z) * t });
    }
  });
  const n = pts.length;
  const g = new THREE.Group();

  // Repère local de chaque point : tangente moyenne, droite = (-tz, tx)
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
  const at = (i: number, lat: number, dy = 0) => {
    const f = frames[i]!;
    return new THREE.Vector3(f.p.x + f.rx * lat, f.p.y + dy, f.p.z + f.rz * lat);
  };

  // Surface : sur une plaque, la texture suit la grille ; sur une route, elle suit le tracé
  const top = new Ribbon();
  for (let i = 0; i < n - 1; i++) {
    const v0 = along[i]! / 10;
    const v1 = along[i + 1]! / 10;
    top.quad([at(i, HALF), at(i + 1, HALF), at(i + 1, -HALF), at(i, -HALF)], [
      [0, v0],
      [0, v1],
      [1, v1],
      [1, v0],
    ]);
  }
  if (def.look !== "road") top.uvScale(TILE / 10 / 2, 1);
  g.add(new THREE.Mesh(top.geometry(), surfaceMat(def.look)));

  // Côtés, dessous, bouts
  const side = new Ribbon();
  const under = new Ribbon();
  for (let i = 0; i < n - 1; i++) {
    side.quad([at(i, HALF, -SLAB), at(i + 1, HALF, -SLAB), at(i + 1, HALF), at(i, HALF)]);
    side.quad([at(i, -HALF), at(i + 1, -HALF), at(i + 1, -HALF, -SLAB), at(i, -HALF, -SLAB)]);
    under.quad([at(i, -HALF, -SLAB), at(i + 1, -HALF, -SLAB), at(i + 1, HALF, -SLAB), at(i, HALF, -SLAB)]);
  }
  side.quad([at(0, -HALF), at(0, -HALF, -SLAB), at(0, HALF, -SLAB), at(0, HALF)]);
  side.quad([at(n - 1, HALF), at(n - 1, HALF, -SLAB), at(n - 1, -HALF, -SLAB), at(n - 1, -HALF)]);
  g.add(new THREE.Mesh(side.geometry(), MAT.side), new THREE.Mesh(under.geometry(), MAT.under));

  // Rebords rouges et blancs
  const wall = new Ribbon(true);
  for (const s of [1, -1]) {
    if (s > 0 ? !borders.pos : !borders.neg) continue;
    const a = s * HALF;
    const b = s * (HALF - WALL_INSET);
    for (let i = 0; i < n - 1; i++) {
      const c = Math.floor((along[i]! + along[i + 1]!) / 2 / 3) % 2 ? RED : WHITE;
      wall.quad(s > 0 ? [at(i, b), at(i + 1, b), at(i + 1, b, WALL_HEIGHT), at(i, b, WALL_HEIGHT)] : [at(i, b, WALL_HEIGHT), at(i + 1, b, WALL_HEIGHT), at(i + 1, b), at(i, b)], undefined, c);
      wall.quad([at(i, b, WALL_HEIGHT), at(i + 1, b, WALL_HEIGHT), at(i + 1, a, WALL_HEIGHT), at(i, a, WALL_HEIGHT)], undefined, c);
      wall.quad(s > 0 ? [at(i, a, WALL_HEIGHT), at(i + 1, a, WALL_HEIGHT), at(i + 1, a), at(i, a)] : [at(i, a), at(i + 1, a), at(i + 1, a, WALL_HEIGHT), at(i, a, WALL_HEIGHT)], undefined, c);
    }
  }
  if (wall.count) g.add(new THREE.Mesh(wall.geometry(), MAT.border));

  if (def.gate) g.add(gateMesh(def.gate));
  return g;
}

/** Tous les blocs d'une map, avec les piliers sous les pièces en hauteur. */
export function buildWorldMesh(world: World): THREE.Group {
  const g = new THREE.Group();
  for (const cb of world.blocks) {
    const m = buildPieceMesh(cb.block.kind, { pos: cb.borderPos, neg: cb.borderNeg });
    placeBlock(m, cb.block);
    m.userData.block = cb.index;
    g.add(m);
  }
  g.add(buildPillars(world));
  return g;
}

export function placeBlock(obj: THREE.Object3D, b: { x: number; z: number; level: number; rot: number }): void {
  obj.position.set(b.x * TILE, b.level * STEP, b.z * TILE);
  obj.rotation.y = (b.rot * Math.PI) / 2;
}

function buildPillars(world: World): THREE.Object3D {
  const boxes: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  for (const cb of world.blocks) {
    if (cb.block.level === 0 && cb.def.path.every((p: PathPoint) => p.y === 0)) continue;
    for (const [x, z] of blockCells(cb.block)) {
      for (const [ox, oz] of [
        [-5, -5],
        [5, 5],
      ] as const) {
        const wx = x * TILE + ox;
        const wz = z * TILE + oz;
        const hit = onBlock(cb, wx, wz);
        if (!hit) continue;
        const topY = hit.groundY - SLAB;
        // Le pilier descend jusqu'à la pièce juste en dessous, ou jusqu'au sol
        let bottom = world.groundY;
        for (const i of world.cells.get(`${x},${z}`) ?? []) {
          const o = world.blocks[i]!;
          if (o === cb) continue;
          const h = onBlock(o, wx, wz);
          if (h && h.groundY < topY - 0.5) bottom = Math.max(bottom, h.groundY);
        }
        const height = topY - bottom;
        if (height < 0.3) continue;
        boxes.push(new THREE.Matrix4().compose(new THREE.Vector3(wx, bottom + height / 2, wz), q, new THREE.Vector3(1.2, height, 1.2)));
      }
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), MAT.pillar, Math.max(1, boxes.length));
  boxes.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = boxes.length;
  return mesh;
}

let checkerTex: THREE.CanvasTexture | null = null;
function checker(): THREE.Texture {
  if (!checkerTex) {
    checkerTex = canvasTexture(128, 32, (g) => {
      for (let x = 0; x < 16; x++)
        for (let y = 0; y < 4; y++) {
          g.fillStyle = (x + y) % 2 ? "#14101f" : "#ffffff";
          g.fillRect(x * 8, y * 8, 8, 8);
        }
    });
    checkerTex.magFilter = THREE.NearestFilter;
  }
  return checkerTex;
}

/** Portique au milieu de la pièce (repère local). */
function gateMesh(kind: "start" | "finish" | "checkpoint"): THREE.Group {
  const g = new THREE.Group();
  const w = HALF + 0.8;
  const height = kind === "checkpoint" ? 6.5 : 8;
  const pillarMat = new THREE.MeshLambertMaterial({ color: kind === "checkpoint" ? 0xffb23e : 0x24324a, flatShading: true });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1, height, 1), pillarMat);
    p.position.set(s * w, height / 2, 0);
    g.add(p);
  }
  const barMat = kind === "checkpoint" ? new THREE.MeshLambertMaterial({ color: 0xffb23e, emissive: 0x5a2a00 }) : new THREE.MeshLambertMaterial({ map: checker(), emissive: 0x222222 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 1, kind === "checkpoint" ? 0.8 : 1.8, 0.6), barMat);
  bar.position.set(0, height, 0);
  g.add(bar);
  if (kind !== "checkpoint") {
    // Ligne au sol
    const line = new THREE.Mesh(new THREE.PlaneGeometry(TILE, 1.6), new THREE.MeshLambertMaterial({ map: checker() }));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.03;
    g.add(line);
  }
  return g;
}

/** Petit constructeur de géométrie à base de quadrilatères. */
class Ribbon {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  count = 0;
  constructor(private readonly colors = false) {}
  quad(v: THREE.Vector3[], uvs?: number[][], color?: THREE.Color): void {
    const idx = [0, 1, 2, 0, 2, 3];
    for (const k of idx) {
      const p = v[k]!;
      this.pos.push(p.x, p.y, p.z);
      const t = uvs ? uvs[k]! : [0.5, 0.5];
      this.uv.push(t[0]!, t[1]!);
      if (this.colors) {
        const c = color ?? WHITE;
        this.col.push(c.r, c.g, c.b);
      }
    }
    this.count++;
  }
  uvScale(su: number, sv: number): void {
    for (let i = 0; i < this.uv.length; i += 2) {
      this.uv[i] = this.uv[i]! * su;
      this.uv[i + 1] = this.uv[i + 1]! * sv;
    }
  }
  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.colors) geo.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    return geo;
  }
}

export type { CompiledBlock };
