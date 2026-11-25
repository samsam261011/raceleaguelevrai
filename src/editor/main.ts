import * as THREE from "three";
import "./editor.css";
import { buildSky } from "../race/render/environment";
import { buildPieceMesh, buildWorldMesh, placeBlock } from "../race/render/blockMesh";
import { buildGround } from "../race/render/environment";
import { formatTime } from "../race/session/session";
import { customMapId, decodeMap, encodeMap, type EditorMap } from "../race/world/code";
import { MAX_LEVEL, PALETTE, PIECES, STEP, TILE, type PieceKind } from "../race/world/pieces";
import { findRoute } from "../race/world/route";
import { blockCells, blocksOverlap, buildWorld, GROUND_Y, validateMap, type Block } from "../race/world/world";
import { exampleMap } from "./examples";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const CURRENT_KEY = "raceleague.editor.current";
const SAVED_KEY = "raceleague.editor.saved";

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
let problem: string | null = validateMap(map.blocks);
const undoStack: string[] = [];

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
  t.repeat.set(80, 80);
  t.anisotropy = 4;
  return t;
})();
const grid = new THREE.Mesh(
  new THREE.PlaneGeometry(80 * TILE, 80 * TILE),
  new THREE.MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.45, depthWrite: false, fog: false }),
);
grid.rotation.x = -Math.PI / 2;
grid.position.set(TILE / 2, GRID_Y, TILE / 2);
scene.add(grid);

const tilesGroup = new THREE.Group();
scene.add(tilesGroup);

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
        mat.opacity = 0.55;
        mat.depthWrite = false;
        m.material = mat;
      }
    });
    previews.set(kind, p);
  }
  return p;
}

function place(obj: THREE.Object3D, t: { x: number; z: number; level: number; rot: number }): void {
  placeBlock(obj, t);
}

// Aperçu de la pièce sous la souris
let ghost: THREE.Object3D | null = null;
const eraseMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.35, depthWrite: false });
const eraseMarks = new THREE.Group();
scene.add(eraseMarks);

// ---------- Mise à jour ----------
function rebuildTiles(): void {
  tilesGroup.clear();
  tilesGroup.add(buildWorldMesh(buildWorld({ id: "editeur", name: "", blocks: map.blocks, medals: { auteur: 0, or: 0, argent: 0, bronze: 0 } })));
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
  status.classList.toggle("ok", !problem);
  if (!problem) {
    const auteur = map.authorTime ? `temps auteur ${formatTime(map.authorTime)}` : "pas encore de temps auteur";
    const route = findRoute(map.blocks);
    const size = route ? `${Math.round(route.length)} m` : `${map.blocks.length} pièces`;
    status.textContent = `Prêt · ${size} · ${auteur}`;
  } else {
    status.textContent = problem;
  }
  ($("testBtn") as HTMLButtonElement).disabled = !!problem;
  store.set(CURRENT_KEY, encodeMap(map));
}

function change(fn: () => void): void {
  undoStack.push(JSON.stringify(map.blocks));
  if (undoStack.length > 200) undoStack.shift();
  fn();
  refresh();
  updateHover();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  map.blocks = JSON.parse(prev) as Block[];
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
  dist = Math.min(700, Math.max(220, extent * (portrait ? 1.9 : 1.25)));
}

function zoom(f: number): void {
  dist = Math.min(700, Math.max(50, dist * f));
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

// ---------- Souris et doigts ----------
const ray = new THREE.Raycaster();
let hoverCell: [number, number] | null = null;
let lastPointer: { x: number; y: number } | null = null;

function cellAt(x: number, y: number): [number, number] | null {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -level * STEP), hit)) return null;
  return [Math.round(hit.x / TILE), Math.round(hit.z / TILE)];
}

/** Pièce sous la souris (n'importe quelle hauteur), sinon pièce de la case à la hauteur choisie. */
function blockUnder(x: number, y: number, cell: [number, number] | null): number {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
  for (const h of ray.intersectObject(tilesGroup, true)) {
    let o: THREE.Object3D | null = h.object;
    while (o && o.userData.block === undefined) o = o.parent;
    if (o) return o.userData.block as number;
  }
  if (!cell) return -1;
  return map.blocks.findIndex((t) => t.level === level && blockCells(t).some(([cx, cz]) => cx === cell[0] && cz === cell[1]));
}

function updateHover(): void {
  if (ghost) scene.remove(ghost);
  ghost = null;
  eraseMarks.clear();
  if (!hoverCell) return;
  if (tool === "gomme") {
    const i = lastPointer ? blockUnder(lastPointer.x, lastPointer.y, hoverCell) : -1;
    const b = map.blocks[i];
    if (b) {
      for (const [x, z] of blockCells(b)) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(TILE - 1, 3, TILE - 1), eraseMat);
        m.position.set(x * TILE, b.level * STEP + 1.2, z * TILE);
        eraseMarks.add(m);
      }
    }
    return;
  }
  ghost = preview(tool);
  place(ghost, { x: hoverCell[0], z: hoverCell[1], level, rot });
  scene.add(ghost);
}

function act(cell: [number, number], erase: boolean, px: number, py: number): void {
  if (erase || tool === "gomme") {
    const i = blockUnder(px, py, cell);
    if (i >= 0) change(() => map.blocks.splice(i, 1));
    return;
  }
  const t: Block = { kind: tool, x: cell[0], z: cell[1], level, rot };
  const same = map.blocks.find((o) => o.kind === t.kind && o.x === t.x && o.z === t.z && o.level === t.level && o.rot === t.rot);
  if (same) return;
  change(() => {
    map.blocks = map.blocks.filter((o) => !blocksOverlap(o, t) && !(t.kind === "depart" && o.kind === "depart"));
    map.blocks.push(t);
  });
}

const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; moved: boolean; button: number }>();
let pinchDist = 0;

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    for (const p of pointers.values()) p.moved = true;
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
  if (e.pointerType === "mouse" || p) {
    const c = cellAt(e.clientX, e.clientY);
    if (!c || !hoverCell || c[0] !== hoverCell[0] || c[1] !== hoverCell[1]) {
      hoverCell = c;
      updateHover();
    }
  }
});
const endPointer = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p || p.moved || e.type === "pointercancel") return;
  const c = cellAt(e.clientX, e.clientY);
  if (c) act(c, p.button === 2, e.clientX, e.clientY);
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse") {
    hoverCell = null;
    updateHover();
  }
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom(Math.exp(e.deltaY * 0.0012));
  },
  { passive: false },
);

// ---------- Palette et outils ----------
const ROAD = "#5d6169";
const GLYPHS: Record<PieceKind, string> = {
  depart: `<rect x="12" y="4" width="16" height="32" rx="2" fill="${ROAD}"/><path d="M12 14h16v5H12z" fill="#fff"/><path d="M12 14h4v5h-4zM20 14h4v5h-4z" fill="#14101f"/><path d="M20 34v-9m-4 4 4-4 4 4" stroke="#ffb23e" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  route: `<rect x="12" y="4" width="16" height="32" rx="2" fill="${ROAD}"/><path d="M12 4v32M28 4v32" stroke="#e0393b" stroke-width="2" stroke-dasharray="4 3"/><path d="M20 6v6m0 4v6m0 4v6" stroke="#fff" stroke-width="1.5"/>`,
  virage: `<path d="M12 38V32A8 8 0 0 1 20 24h18" stroke="${ROAD}" stroke-width="15" fill="none"/>`,
  virage2: `<path d="M10 38V30A14 14 0 0 1 24 16h14" stroke="${ROAD}" stroke-width="11" fill="none"/>`,
  virage3: `<path d="M8 38V28A20 20 0 0 1 28 8h10" stroke="${ROAD}" stroke-width="8" fill="none"/>`,
  pente: `<path d="M4 32h10l14-10h8v10z" fill="${ROAD}"/><path d="M14 26l6-5m0 0h-4m4 0v4" stroke="#ffb23e" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  penteRaide: `<path d="M4 34h8l16-22h8v22z" fill="${ROAD}"/><path d="M13 28l7-9m0 0h-4m4 0v4" stroke="#ffb23e" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  tremplin: `<path d="M4 32h12q10 0 16-12v12z" fill="${ROAD}"/><path d="M34 14q2-4 4-5" stroke="#ffb23e" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="2 3"/>`,
  plaque: `<rect x="6" y="6" width="28" height="28" rx="2" fill="#b9bcc2"/><path d="M20 6v28M6 20h28" stroke="#8d9097" stroke-width="1.5"/>`,
  plaquePente: `<path d="M4 32h10l14-10h8v10z" fill="#b9bcc2"/>`,
  booster: `<rect x="8" y="4" width="24" height="32" rx="2" fill="#1e2a4a"/><path d="M12 22l8-6 8 6v4l-8-6-8 6zM12 32l8-6 8 6v-4l-8-6-8 6z" fill="#35e0ff"/>`,
  checkpoint: `<rect x="12" y="4" width="16" height="32" rx="2" fill="${ROAD}"/><path d="M8 20h24" stroke="#ffb23e" stroke-width="4"/><path d="M9 14v12M31 14v12" stroke="#ffb23e" stroke-width="3"/>`,
  arrivee: `<rect x="12" y="4" width="16" height="32" rx="2" fill="${ROAD}"/><path d="M12 8h16v8H12z" fill="#fff"/><path d="M12 8h4v4h-4zM20 8h4v4h-4zM16 12h4v4h-4zM24 12h4v4h-4z" fill="#14101f"/>`,
};

const palette = $("palette");
PALETTE.forEach((kind, i) => {
  const b = document.createElement("button");
  b.className = "piece";
  b.dataset.kind = kind;
  const key = i < 9 ? String(i + 1) : "";
  b.title = key ? `${PIECES[kind].label} (${key})` : PIECES[kind].label;
  b.innerHTML = `${key ? `<kbd>${key}</kbd>` : ""}<svg viewBox="0 0 40 40" aria-hidden="true">${GLYPHS[kind]}</svg>${PIECES[kind].label}`;
  b.addEventListener("click", () => setTool(kind));
  palette.appendChild(b);
});

function setTool(t: PieceKind | "gomme"): void {
  tool = t;
  palette.querySelectorAll<HTMLButtonElement>(".piece").forEach((b) => b.classList.toggle("on", b.dataset.kind === t));
  $("eraseBtn").setAttribute("aria-pressed", String(t === "gomme"));
  updateHover();
}

function rotate(dir = 1): void {
  rot = (rot + dir + 4) % 4;
  updateHover();
}

function setLevel(l: number): void {
  level = Math.max(0, Math.min(MAX_LEVEL, l));
  $("lvl").textContent = String(level);
  grid.position.y = level * STEP + GRID_Y;
  if (lastPointer) hoverCell = cellAt(lastPointer.x, lastPointer.y);
  updateHover();
}

$("rotBtn").addEventListener("click", () => rotate(1));
$("eraseBtn").addEventListener("click", () => setTool(tool === "gomme" ? "route" : "gomme"));
$("lvlUp").addEventListener("click", () => setLevel(level + 1));
$("lvlDown").addEventListener("click", () => setLevel(level - 1));
$("undoBtn").addEventListener("click", undo);
$("camBtn").addEventListener("click", () => (yawGoal += Math.PI / 2));

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
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
    e.preventDefault();
    undo();
    return;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= 9) setTool(PALETTE[n - 1]!);
  else if (e.code === "KeyR") rotate(e.shiftKey ? -1 : 1);
  else if (e.code === "KeyX" || e.code === "Delete") setTool(tool === "gomme" ? "route" : "gomme");
  else if (e.code === "KeyQ") yawGoal -= Math.PI / 2;
  else if (e.code === "KeyE") yawGoal += Math.PI / 2;
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

// ---------- Code, mes circuits ----------
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

function openCode(): void {
  ($("codeOut") as HTMLTextAreaElement).value = encodeMap(map);
  $("loadErr").textContent = "";
  renderSaved();
  $("codeModal").hidden = false;
}
function closeCode(): void {
  $("codeModal").hidden = true;
}

function setMap(m: EditorMap): void {
  undoStack.push(JSON.stringify(map.blocks));
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
  closeCode();
});
$("exampleBtn").addEventListener("click", () => {
  setMap(exampleMap());
  closeCode();
});

// ---------- Boucle ----------
setTool("route");
setLevel(0);
frameMap();
refresh();
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  updateCamera(dt);
  renderer.render(scene, camera);
});
