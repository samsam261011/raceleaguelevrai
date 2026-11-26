import * as THREE from "three";
import "./editor.css";
import { buildPieceMesh, buildWorldMesh, placeBlock } from "../race/render/blockMesh";
import { buildGround, buildSky } from "../race/render/environment";
import { formatTime } from "../race/session/session";
import { customMapId, decodeMap, encodeMap, type EditorMap } from "../race/world/code";
import { OFFICIAL_MAPS } from "../race/world/maps";
import { MAX_LEVEL, PALETTE_GROUPS, PIECES, SIDE_DIR, STEP, TILE, type PieceKind } from "../race/world/pieces";
import { findRoute, openPorts, placementsAt, type BlockPort } from "../race/world/route";
import { blockCells, blockClashes, blocksOverlap, buildWorld, GROUND_Y, validateMap, type Block } from "../race/world/world";
import { exampleMap } from "./examples";
import { renderThumbs } from "./thumbs";

/*
 * Éditeur de circuits. L'idée : on choisit une pièce, on l'approche d'un bout de piste (flèche orange)
 * et l'aimant la raccorde toute seule, à la bonne place, dans le bon sens et à la bonne hauteur.
 * « Sens » (F) choisit entre les raccords possibles : virage à gauche ou à droite, pente qui monte ou descend.
 * Loin de tout bout de piste, la pièce se pose librement sur la grille, à la hauteur choisie.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const CURRENT_KEY = "raceleague.editor.current";
const SAVED_KEY = "raceleague.editor.saved";
const GROUP_KEY = "raceleague.editor.group";

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* stockage indisponible */
    }
  },
};

// ---------- État ----------
let map: EditorMap = loadInitialMap();
let tool: PieceKind | "gomme" = "route";
let rot = 0;
let level = 0;
/** Choix parmi les raccords possibles (touche F). */
let flip = 0;
let magnet = true;
let problem: string | null = validateMap(map.blocks);
const undoStack: string[] = [];
const redoStack: string[] = [];

function loadInitialMap(): EditorMap {
  const fromUrl = new URLSearchParams(location.search).get("code");
  for (const c of [fromUrl, store.get(CURRENT_KEY)]) {
    if (!c) continue;
    try {
      return decodeMap(c);
    } catch {
      /* code invalide : on essaie le suivant */
    }
  }
  return exampleMap();
}

// ---------- Scène ----------
const canvas = $("scene") as unknown as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
buildSky(scene);
scene.fog = new THREE.Fog(0xcfe6f5, 900, 3000); // vue de haut : brouillard plus loin qu'en course
const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);
scene.add(buildGround(GROUND_Y));

// Grille : un plan texturé (les lignes fines de WebGL disparaissent sur certains appareils)
const GRID_Y = -0.3; // juste sous la surface des pièces, pour ne pas dessiner par-dessus la route
const gridTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 2;
  g.strokeRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(120, 120);
  t.anisotropy = 4;
  return t;
})();
const grid = new THREE.Mesh(
  new THREE.PlaneGeometry(120 * TILE, 120 * TILE),
  new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.4, depthWrite: false, fog: false }),
);
grid.rotation.x = -Math.PI / 2;
grid.position.set(TILE / 2, GRID_Y, TILE / 2);
scene.add(grid);

const tilesGroup = new THREE.Group();
scene.add(tilesGroup);
/** Flèches aux bouts de piste libres. */
const arrows = new THREE.Group();
scene.add(arrows);
/** Empreinte de la pièce à poser (vert : raccordée, blanc : libre, rouge : remplace une pièce). */
const footprint = new THREE.Group();
scene.add(footprint);

// ---------- Modèles 3D des pièces ----------
const previews = new Map<PieceKind, THREE.Object3D>();
function preview(kind: PieceKind): THREE.Object3D {
  let p = previews.get(kind);
  if (!p) {
    p = buildPieceMesh(kind);
    p.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) {
        const mat = (m.material as THREE.Material).clone();
        mat.transparent = true;
        mat.opacity = 0.6;
        mat.depthWrite = false;
        m.material = mat;
      }
    });
    previews.set(kind, p);
  }
  return p;
}

const arrowGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 4.2);
  s.lineTo(3.6, 0);
  s.lineTo(1.6, 0);
  s.lineTo(1.6, -3);
  s.lineTo(-1.6, -3);
  s.lineTo(-1.6, 0);
  s.lineTo(-3.6, 0);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  // La pointe (+y du dessin) vers +z : la flèche montre la direction où continuer
  g.rotateX(Math.PI / 2);
  return g;
})();
const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffb23e, transparent: true, opacity: 0.95, depthTest: false, fog: false, side: THREE.DoubleSide });
const arrowHot = new THREE.MeshBasicMaterial({ color: 0x5be08a, transparent: true, opacity: 0.95, depthTest: false, fog: false, side: THREE.DoubleSide });
const footMats = {
  link: new THREE.MeshBasicMaterial({ color: 0x5be08a, transparent: true, opacity: 0.28, depthWrite: false }),
  free: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }),
  clash: new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.35, depthWrite: false }),
};
const footGeo = new THREE.BoxGeometry(TILE - 1.2, 0.6, TILE - 1.2);

// ---------- Mise à jour ----------
let ports: (BlockPort & { block: number })[] = [];

function rebuildTiles(): void {
  tilesGroup.clear();
  tilesGroup.add(buildWorldMesh(buildWorld({ id: "editeur", name: "", blocks: map.blocks, medals: { auteur: 0, or: 0, argent: 0, bronze: 0 } })));
  // Derrière le départ et après l'arrivée, il n'y a rien à raccorder
  ports = openPorts(map.blocks).filter((p) => {
    const gate = PIECES[map.blocks[p.block]!.kind].gate;
    return !(gate === "start" && p.end === 0) && !(gate === "finish" && p.end === 1);
  });
  arrows.clear();
  ports.forEach((p, i) => {
    const a = new THREE.Mesh(arrowGeo, arrowMat);
    const [dx, dz] = SIDE_DIR[p.side]!;
    a.position.set(p.x + dx * 3, p.y + 1.6, p.z + dz * 3);
    a.rotation.y = Math.atan2(dx, dz);
    a.renderOrder = 5;
    a.userData.port = i;
    arrows.add(a);
  });
}

function readBest(id: string): number | null {
  const v = store.get(`raceleague.best.${id}`);
  return v ? Number(v) : null;
}

function refresh(): void {
  map.authorTime = readBest(customMapId(map.blocks));
  problem = validateMap(map.blocks);
  rebuildTiles();
  const status = $("status");
  let text: string;
  let ok = false;
  if (problem) text = problem;
  else {
    const route = findRoute(map.blocks);
    if (!route) text = "Le tracé n'est pas relié du départ à l'arrivée";
    else {
      ok = true;
      const auteur = map.authorTime ? `temps auteur ${formatTime(map.authorTime)}` : "à tester";
      text = `Circuit complet · ${Math.round(route.length)} m · ${auteur}`;
    }
  }
  const clashes = blockClashes(map.blocks).length;
  if (clashes) text += ` · ${clashes} pièce${clashes > 1 ? "s" : ""} trop proche${clashes > 1 ? "s" : ""}`;
  status.textContent = text;
  status.classList.toggle("ok", ok);
  status.classList.toggle("warn", !ok && !problem);
  ($("testBtn") as HTMLButtonElement).disabled = !!problem;
  ($("undoBtn") as HTMLButtonElement).disabled = undoStack.length === 0;
  ($("redoBtn") as HTMLButtonElement).disabled = redoStack.length === 0;
  store.set(CURRENT_KEY, encodeMap(map));
}

function change(fn: () => void): void {
  undoStack.push(JSON.stringify(map.blocks));
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
  fn();
  refresh();
  updateHover();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(JSON.stringify(map.blocks));
  map.blocks = JSON.parse(prev) as Block[];
  refresh();
  updateHover();
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(JSON.stringify(map.blocks));
  map.blocks = JSON.parse(next) as Block[];
  refresh();
  updateHover();
}

// ---------- Caméra ----------
const target = new THREE.Vector3(2 * TILE, 0, 4 * TILE);
let yaw = Math.PI + 0.35;
let yawGoal = yaw;
let dist = 260;
const PITCH = 0.95;

function updateCamera(dt: number): void {
  yaw += (yawGoal - yaw) * (1 - Math.exp(-dt * 10));
  const ty = level * STEP;
  target.y += (ty - target.y) * (1 - Math.exp(-dt * 8));
  const h = Math.cos(PITCH) * dist;
  camera.position.set(target.x + Math.sin(yaw) * h, target.y + Math.sin(PITCH) * dist, target.z + Math.cos(yaw) * h);
  camera.lookAt(target);
}

function pan(dx: number, dy: number): void {
  const k = dist * 0.0021;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  // droite de l'écran = (-fz, fx) vu de la caméra
  const rx = -fz;
  const rz = fx;
  target.x += (-rx * dx + fx * dy) * k;
  target.z += (-rz * dx + fz * dy) * k;
}

/** Cadre la caméra sur tout le circuit. */
function frameMap(): void {
  if (map.blocks.length === 0) return;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const t of map.blocks)
    for (const [x, z] of blockCells(t)) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
  target.set(((x0 + x1) / 2) * TILE, 0, ((z0 + z1) / 2) * TILE);
  const extent = (Math.max(x1 - x0, z1 - z0) + 2) * TILE;
  const portrait = window.innerWidth < window.innerHeight;
  dist = Math.min(1100, Math.max(220, extent * (portrait ? 1.9 : 1.2)));
}

function zoom(f: number): void {
  dist = Math.min(1100, Math.max(50, dist * f));
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 65 : 50;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------- Ce que vise la souris ----------
const ray = new THREE.Raycaster();
let lastPointer: { x: number; y: number } | null = null;

function ndc(x: number, y: number): THREE.Vector2 {
  const r = canvas.getBoundingClientRect();
  return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
}

function cellAt(x: number, y: number): [number, number] | null {
  ray.setFromCamera(ndc(x, y), camera);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -level * STEP), hit)) return null;
  return [Math.round(hit.x / TILE), Math.round(hit.z / TILE)];
}

/** Pièce sous la souris (n'importe quelle hauteur), sinon pièce de la case à la hauteur choisie. */
function blockUnder(x: number, y: number): number {
  ray.setFromCamera(ndc(x, y), camera);
  for (const h of ray.intersectObject(tilesGroup, true)) {
    let o: THREE.Object3D | null = h.object;
    while (o && o.userData.block === undefined) o = o.parent;
    if (o) return o.userData.block as number;
  }
  const cell = cellAt(x, y);
  if (!cell) return -1;
  return map.blocks.findIndex((t) => t.level === level && blockCells(t).some(([cx, cz]) => cx === cell[0] && cz === cell[1]));
}

/** Bout de piste libre le plus proche de la souris à l'écran (à moins de 90 px), pour l'aimant. */
function nearestPort(x: number, y: number): BlockPort | null {
  const r = canvas.getBoundingClientRect();
  let best: BlockPort | null = null;
  let bestD = 90 * 90;
  const v = new THREE.Vector3();
  for (const p of ports) {
    const [dx, dz] = SIDE_DIR[p.side]!;
    // On vise la case juste après le bout de piste : là où ira la pièce
    v.set(p.x + dx * TILE * 0.6, p.y, p.z + dz * TILE * 0.6).project(camera);
    if (v.z > 1) continue;
    const sx = r.left + ((v.x + 1) / 2) * r.width;
    const sy = r.top + ((1 - v.y) / 2) * r.height;
    const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

interface Plan {
  block: Block;
  linked: boolean;
  /** Pièces que la pose remplacerait. */
  replaces: number[];
  /** Nombre de façons de se raccorder (touche F). */
  choices: number;
}

/** Ce que ferait un clic maintenant. */
function plan(x: number, y: number): Plan | null {
  if (tool === "gomme") return null;
  const kind = tool;
  const port = magnet ? nearestPort(x, y) : null;
  if (port) {
    const all = placementsAt(kind, port);
    if (all.length) {
      // On préfère les raccords qui ne gênent aucune pièce
      const free = all.filter((b) => blockClashes([...map.blocks, b]).every(([, j]) => j !== map.blocks.length));
      const list = free.length ? free : all;
      const block = list[((flip % list.length) + list.length) % list.length]!;
      return { block, linked: true, replaces: replaced(block), choices: list.length };
    }
  }
  const cell = cellAt(x, y);
  if (!cell) return null;
  const block: Block = { kind, x: cell[0], z: cell[1], level, rot };
  return { block, linked: false, replaces: replaced(block), choices: 1 };
}

function replaced(b: Block): number[] {
  const out: number[] = [];
  map.blocks.forEach((o, i) => {
    if (blocksOverlap(o, b) || (PIECES[b.kind].gate === "start" && PIECES[o.kind].gate === "start")) out.push(i);
  });
  return out;
}

let current: Plan | null = null;
let ghost: THREE.Object3D | null = null;

function updateHover(): void {
  if (ghost) scene.remove(ghost);
  ghost = null;
  footprint.clear();
  for (const a of arrows.children) (a as THREE.Mesh).material = arrowMat;
  current = null;
  if (!lastPointer) return;
  if (tool === "gomme") {
    const i = blockUnder(lastPointer.x, lastPointer.y);
    const b = map.blocks[i];
    if (b) for (const [x, z] of blockCells(b)) addFoot(x, z, b.level, footMats.clash);
    return;
  }
  current = plan(lastPointer.x, lastPointer.y);
  if (!current) return;
  const b = current.block;
  ghost = preview(b.kind);
  placeBlock(ghost, b);
  scene.add(ghost);
  const mat = current.replaces.length ? footMats.clash : current.linked ? footMats.link : footMats.free;
  for (const [x, z] of blockCells(b)) addFoot(x, z, b.level, mat);
  if (current.linked) {
    // La flèche du raccord passe au vert
    for (const a of arrows.children) {
      const p = ports[a.userData.port as number];
      if (p && blockCellsTouch(p, b)) (a as THREE.Mesh).material = arrowHot;
    }
  }
  $("flipBtn").classList.toggle("dim", current.choices < 2);
}

function blockCellsTouch(p: BlockPort, b: Block): boolean {
  const [dx, dz] = SIDE_DIR[p.side]!;
  const cx = Math.round((p.x + dx * HALF_STEP) / TILE);
  const cz = Math.round((p.z + dz * HALF_STEP) / TILE);
  return blockCells(b).some(([x, z]) => Math.abs(x - cx) <= 1 && Math.abs(z - cz) <= 1);
}
const HALF_STEP = TILE / 2 - 0.5;

function addFoot(x: number, z: number, lv: number, mat: THREE.Material): void {
  const m = new THREE.Mesh(footGeo, mat);
  m.position.set(x * TILE, lv * STEP - 0.45, z * TILE);
  footprint.add(m);
}

function act(erase: boolean, px: number, py: number): void {
  if (erase || tool === "gomme") {
    const i = blockUnder(px, py);
    if (i >= 0) change(() => map.blocks.splice(i, 1));
    return;
  }
  const p = plan(px, py);
  if (!p) return;
  const t = p.block;
  if (map.blocks.some((o) => o.kind === t.kind && o.x === t.x && o.z === t.z && o.level === t.level && o.rot === t.rot)) return;
  change(() => {
    map.blocks = map.blocks.filter((_, i) => !p.replaces.includes(i));
    map.blocks.push(t);
    // On continue à la hauteur de la pièce posée, dans le même sens
    setLevel(t.level, false);
    rot = t.rot;
  });
}

/** Pipette : reprend la pièce visée (type, rotation, hauteur). */
function pick(px: number, py: number): void {
  const b = map.blocks[blockUnder(px, py)];
  if (!b) return;
  setTool(b.kind);
  rot = b.rot;
  setLevel(b.level);
  toast(`${PIECES[b.kind].label} copiée`);
}

// ---------- Souris et doigts ----------
const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; moved: boolean; button: number }>();
let pinchDist = 0;

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button });
  lastPointer = { x: e.clientX, y: e.clientY };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    for (const p of pointers.values()) p.moved = true;
  }
  if (e.button === 1) {
    e.preventDefault();
    pick(e.clientX, e.clientY);
  }
});
canvas.addEventListener("pointermove", (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  const p = pointers.get(e.pointerId);
  if (p) {
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinchDist > 0) zoom(pinchDist / d);
      pinchDist = d;
    } else {
      if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 7) p.moved = true;
      if (p.moved) pan(dx, dy);
    }
  }
  updateHover();
});
const endPointer = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p || p.moved || e.type === "pointercancel" || p.button === 1) return;
  act(p.button === 2, e.clientX, e.clientY);
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse") {
    lastPointer = null;
    updateHover();
  }
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom(Math.exp(e.deltaY * 0.0012));
    updateHover();
  },
  { passive: false },
);

// ---------- Palette ----------
const thumbs = new Map<PieceKind, string>();
let group = Math.min(PALETTE_GROUPS.length - 1, Math.max(0, Number(store.get(GROUP_KEY) ?? 0) || 0));

function renderGroupTabs(): void {
  const tabs = $("groupTabs");
  tabs.innerHTML = "";
  PALETTE_GROUPS.forEach((g, i) => {
    const b = document.createElement("button");
    b.className = "tab";
    b.role = "tab";
    b.textContent = g.name;
    b.setAttribute("aria-selected", String(i === group));
    b.addEventListener("click", () => {
      group = i;
      store.set(GROUP_KEY, String(i));
      renderGroupTabs();
      renderPieces();
    });
    tabs.appendChild(b);
  });
}

function renderPieces(): void {
  const list = $("pieceList");
  list.innerHTML = "";
  PALETTE_GROUPS[group]!.kinds.forEach((kind, i) => {
    const b = document.createElement("button");
    b.className = "piece";
    b.dataset.kind = kind;
    const key = i < 9 ? String(i + 1) : "";
    b.title = key ? `${PIECES[kind].label} (${key})` : PIECES[kind].label;
    const img = thumbs.get(kind);
    b.innerHTML = `${key ? `<kbd>${key}</kbd>` : ""}<span class="thumb">${img ? `<img alt="" src="${img}">` : ""}</span><span class="name">${PIECES[kind].label}</span>`;
    b.classList.toggle("on", kind === tool);
    b.addEventListener("click", () => setTool(kind));
    list.appendChild(b);
  });
}

function setTool(t: PieceKind | "gomme"): void {
  if (t !== tool) flip = 0;
  tool = t;
  if (t !== "gomme") {
    const g = PALETTE_GROUPS.findIndex((x) => x.kinds.includes(t));
    if (g >= 0 && g !== group) {
      group = g;
      renderGroupTabs();
      renderPieces();
    }
  }
  $("pieceList").querySelectorAll<HTMLButtonElement>(".piece").forEach((b) => b.classList.toggle("on", b.dataset.kind === t));
  $("eraseBtn").setAttribute("aria-pressed", String(t === "gomme"));
  updateHover();
}

function rotate(dir = 1): void {
  rot = (rot + dir + 4) % 4;
  updateHover();
}

function flipSense(): void {
  flip++;
  // Sans raccord, « Sens » retourne la pièce
  if (current && !current.linked) rot = (rot + 2) % 4;
  updateHover();
}

function setLevel(l: number, hover = true): void {
  level = Math.max(0, Math.min(MAX_LEVEL, l));
  $("lvl").textContent = String(level);
  grid.position.y = level * STEP + GRID_Y;
  if (hover) updateHover();
}

function setMagnet(on: boolean): void {
  magnet = on;
  $("magnetBtn").setAttribute("aria-pressed", String(on));
  arrows.visible = on;
  updateHover();
}

$("rotBtn").addEventListener("click", () => rotate(1));
$("flipBtn").addEventListener("click", flipSense);
$("magnetBtn").addEventListener("click", () => setMagnet(!magnet));
$("eraseBtn").addEventListener("click", () => setTool(tool === "gomme" ? "route" : "gomme"));
$("lvlUp").addEventListener("click", () => setLevel(level + 1));
$("lvlDown").addEventListener("click", () => setLevel(level - 1));
$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);
$("camBtn").addEventListener("click", () => (yawGoal += Math.PI / 2));
$("fitBtn").addEventListener("click", frameMap);
$("helpBtn").addEventListener("click", () => {
  const h = $("help");
  h.hidden = !h.hidden;
  $("helpBtn").setAttribute("aria-expanded", String(!h.hidden));
});

const nameInput = $("mapName") as HTMLInputElement;
nameInput.value = map.name;
nameInput.addEventListener("input", () => {
  map.name = nameInput.value;
  store.set(CURRENT_KEY, encodeMap(map));
});

$("backBtn").addEventListener("click", () => (location.href = "./"));
$("testBtn").addEventListener("click", () => {
  if (problem) return;
  store.set(CURRENT_KEY, encodeMap(map));
  location.href = `./race.html?editeur&code=${encodeURIComponent(encodeMap(map))}`;
});

window.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
  if (!$("codeModal").hidden) {
    if (e.key === "Escape") closeCode();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))) {
    e.preventDefault();
    redo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
    e.preventDefault();
    undo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const n = Number(e.key);
  const kinds = PALETTE_GROUPS[group]!.kinds;
  if (n >= 1 && n <= 9 && kinds[n - 1]) setTool(kinds[n - 1]!);
  else if (e.code === "KeyR") rotate(e.shiftKey ? -1 : 1);
  else if (e.code === "KeyF") flipSense();
  else if (e.code === "KeyA") setMagnet(!magnet);
  else if (e.code === "KeyC" && lastPointer) pick(lastPointer.x, lastPointer.y);
  else if (e.code === "KeyX" || e.code === "Delete") setTool(tool === "gomme" ? "route" : "gomme");
  else if (e.code === "KeyQ") yawGoal -= Math.PI / 2;
  else if (e.code === "KeyE") yawGoal += Math.PI / 2;
  else if (e.code === "KeyV" || e.code === "Home") frameMap();
  else if (e.code === "PageUp") setLevel(level + 1);
  else if (e.code === "PageDown") setLevel(level - 1);
  else if (e.code === "ArrowLeft") pan(60, 0);
  else if (e.code === "ArrowRight") pan(-60, 0);
  else if (e.code === "ArrowUp") pan(0, 60);
  else if (e.code === "ArrowDown") pan(0, -60);
  else if (e.code === "Escape") setTool("route");
  else return;
  e.preventDefault();
});

// ---------- Circuits : les miens, ceux du jeu, le code ----------
type Saved = { name: string; code: string };
function savedList(): Saved[] {
  try {
    return JSON.parse(store.get(SAVED_KEY) ?? "[]") as Saved[];
  } catch {
    return [];
  }
}

function renderSaved(): void {
  const ul = $("savedList");
  ul.innerHTML = "";
  const list = savedList();
  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Aucun circuit enregistré pour l'instant.";
    ul.appendChild(li);
  }
  list.forEach((s, i) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = s.name || "Sans nom";
    const open = document.createElement("button");
    open.className = "btn";
    open.textContent = "Ouvrir";
    open.addEventListener("click", () => loadCode(s.code));
    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "Supprimer";
    del.setAttribute("aria-label", `Supprimer ${s.name}`);
    del.addEventListener("click", () => {
      const l = savedList();
      l.splice(i, 1);
      store.set(SAVED_KEY, JSON.stringify(l));
      renderSaved();
    });
    li.append(name, open, del);
    ul.appendChild(li);
  });
}

function renderOfficial(): void {
  const box = $("officialList");
  box.innerHTML = "";
  OFFICIAL_MAPS.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.innerHTML = `<b>${i + 1}</b> `;
    b.append(m.name);
    b.addEventListener("click", () => {
      setMap({ name: `${m.name} (copie)`, authorTime: null, blocks: m.blocks.map((x) => ({ ...x })) });
      closeCode();
      toast(`${m.name} ouverte : tu modifies une copie`);
    });
    box.appendChild(b);
  });
}

function openCode(): void {
  ($("codeOut") as HTMLTextAreaElement).value = encodeMap(map);
  $("loadErr").textContent = "";
  renderSaved();
  renderOfficial();
  $("codeModal").hidden = false;
}
function closeCode(): void {
  $("codeModal").hidden = true;
}

function setMap(m: EditorMap): void {
  undoStack.push(JSON.stringify(map.blocks));
  redoStack.length = 0;
  map = m;
  nameInput.value = map.name;
  frameMap();
  refresh();
  updateHover();
}

function loadCode(code: string): void {
  try {
    setMap(decodeMap(code));
    closeCode();
    toast("Circuit ouvert");
  } catch (err) {
    $("loadErr").textContent = (err as Error).message;
  }
}

let toastTimer = 0;
function toast(msg: string): void {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 1800);
}

$("codeBtn").addEventListener("click", openCode);
$("closeCode").addEventListener("click", closeCode);
$("codeModal").addEventListener("click", (e) => {
  if (e.target === $("codeModal")) closeCode();
});
$("copyBtn").addEventListener("click", async () => {
  const ta = $("codeOut") as HTMLTextAreaElement;
  try {
    await navigator.clipboard.writeText(ta.value);
  } catch {
    ta.select();
    document.execCommand("copy");
  }
  toast("Code copié");
});
$("loadBtn").addEventListener("click", () => loadCode(($("codeIn") as HTMLTextAreaElement).value));
$("saveBtn").addEventListener("click", () => {
  const l = savedList().filter((s) => s.name !== map.name);
  l.unshift({ name: map.name || "Sans nom", code: encodeMap(map) });
  store.set(SAVED_KEY, JSON.stringify(l.slice(0, 40)));
  renderSaved();
  toast("Circuit enregistré");
});
$("newBtn").addEventListener("click", () => {
  setMap({ name: "Nouveau circuit", authorTime: null, blocks: [{ kind: "depart", x: 0, z: 0, level: 0, rot: 0 }] });
  setTool("route");
  closeCode();
});

// ---------- Démarrage ----------
renderGroupTabs();
renderPieces();
setTool("route");
setLevel(0);
setMagnet(true);
frameMap();
refresh();
renderThumbs(
  PALETTE_GROUPS.flatMap((g) => g.kinds),
  112,
  (kind, url) => {
    thumbs.set(kind, url);
    const span = $("pieceList").querySelector<HTMLElement>(`.piece[data-kind="${kind}"] .thumb`);
    if (span && !span.firstChild) span.innerHTML = `<img alt="" src="${url}">`;
  },
);
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  updateCamera(dt);
  // Les flèches pulsent doucement, et grossissent quand on voit de loin
  const s = (1 + 0.12 * Math.sin(now / 220)) * Math.max(1, dist / 260);
  for (const a of arrows.children) a.scale.setScalar(s);
  renderer.render(scene, camera);
});
