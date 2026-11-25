import * as THREE from "three";
import "./editor.css";
import { buildSky } from "../race/render/environment";
import { buildTrackMesh, gate } from "../race/render/trackMesh";
import { formatTime } from "../race/session/session";
import { buildTrack } from "../race/track/build";
import { decodeMap, encodeMap } from "./code";
import { exampleMap } from "./examples";
import { customMapId, overlaps, tileCells, walk, type EditorMap, type Tile, type WalkResult } from "./layout";
import { LEVEL_H, MAX_LEVEL, PALETTE, PIECES, SIDE_DIR, TILE, type PieceKind } from "./pieces";

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
let tool: PieceKind | "gomme" = "droite";
let rot = 0;
let level = 0;
let result: WalkResult = walk(map);
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

const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 48), new THREE.MeshLambertMaterial({ color: 0x7cbf4e }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -34;
scene.add(ground);

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
const templates = new Map<PieceKind, THREE.Object3D>();
const previews = new Map<PieceKind, THREE.Object3D>();

function buildTemplate(kind: PieceKind): THREE.Object3D {
  const def = PIECES[kind];
  const g = new THREE.Group();
  const track = buildTrack({
    id: "piece",
    name: "piece",
    points: def.path.map((p) => ({ ...p })),
    checkpoints: [],
    medals: { auteur: 0, or: 0, argent: 0, bronze: 0 },
  });
  if (def.gap) {
    // Le vide : juste un cadre pointillé pour voir où il est
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(22, 0.2, TILE)),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 1.5 }),
    );
    box.computeLineDistances();
    g.add(box);
  } else {
    g.add(buildTrackMesh(track, { gates: false }));
  }
  if (def.gate === "start") g.add(gate(track, 2, "start"));
  if (def.gate === "finish") g.add(gate(track, track.count - 2, "finish"));
  if (def.gate === "checkpoint") g.add(gate(track, Math.floor(track.count / 2), "checkpoint"));
  return g;
}

function template(kind: PieceKind): THREE.Object3D {
  let t = templates.get(kind);
  if (!t) templates.set(kind, (t = buildTemplate(kind)));
  return t;
}

function preview(kind: PieceKind): THREE.Object3D {
  let p = previews.get(kind);
  if (!p) {
    p = template(kind).clone(true);
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
  obj.position.set(t.x * TILE, t.level * LEVEL_H, t.z * TILE);
  obj.rotation.y = (t.rot * Math.PI) / 2;
}

// Aperçu de la pièce sous la souris
let ghost: THREE.Object3D | null = null;
const eraseMat = new THREE.MeshBasicMaterial({ color: 0xff4a3d, transparent: true, opacity: 0.35, depthWrite: false });
const eraseMarks = new THREE.Group();
scene.add(eraseMarks);

// Flèche rouge là où le circuit s'arrête
const errorMark = new THREE.Mesh(new THREE.ConeGeometry(3, 7, 4), new THREE.MeshLambertMaterial({ color: 0xff4a3d, emissive: 0x661010 }));
errorMark.rotation.x = Math.PI;
errorMark.visible = false;
scene.add(errorMark);
let errorBaseY = 0;

// ---------- Mise à jour ----------
function rebuildTiles(): void {
  tilesGroup.clear();
  for (const t of map.tiles) {
    const o = template(t.kind).clone(true);
    place(o, t);
    tilesGroup.add(o);
  }
}

function readBest(id: string): number | null {
  const v = store.get(`raceleague.best.${id}`);
  return v ? Number(v) : null;
}

function refresh(): void {
  map.authorTime = readBest(customMapId(map));
  result = walk(map, customMapId(map));
  rebuildTiles();
  const status = $("status");
  status.classList.toggle("ok", result.ok);
  if (result.ok) {
    const auteur = map.authorTime ? `temps auteur ${formatTime(map.authorTime)}` : "pas encore de temps auteur";
    status.textContent = `Circuit prêt · ${Math.round(result.length)} m · ${auteur}`;
  } else {
    status.textContent = result.error;
  }
  ($("testBtn") as HTMLButtonElement).disabled = !result.ok;
  if (!result.ok && result.at) {
    const [dx, dz] = SIDE_DIR[result.at.side]!;
    errorMark.position.set(result.at.x * TILE + (dx * TILE) / 2, result.at.level * LEVEL_H + 6, result.at.z * TILE + (dz * TILE) / 2);
    errorBaseY = errorMark.position.y;
    errorMark.visible = true;
  } else errorMark.visible = false;
  store.set(CURRENT_KEY, encodeMap(map));
}

function change(fn: () => void): void {
  undoStack.push(JSON.stringify(map.tiles));
  if (undoStack.length > 200) undoStack.shift();
  fn();
  refresh();
  updateHover();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  map.tiles = JSON.parse(prev) as Tile[];
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
  const ty = level * LEVEL_H;
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
  if (map.tiles.length === 0) return;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const t of map.tiles)
    for (const [x, z] of tileCells(t)) {
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
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -level * LEVEL_H), hit)) return null;
  return [Math.round(hit.x / TILE), Math.round(hit.z / TILE)];
}

function tilesAt(cell: [number, number]): number[] {
  const out: number[] = [];
  map.tiles.forEach((t, i) => {
    if (t.level !== level) return;
    if (tileCells(t).some(([x, z]) => x === cell[0] && z === cell[1])) out.push(i);
  });
  return out;
}

function updateHover(): void {
  if (ghost) scene.remove(ghost);
  ghost = null;
  eraseMarks.clear();
  if (!hoverCell) return;
  if (tool === "gomme") {
    for (const i of tilesAt(hoverCell)) {
      for (const [x, z] of tileCells(map.tiles[i]!)) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(TILE - 1, 3, TILE - 1), eraseMat);
        m.position.set(x * TILE, level * LEVEL_H + 1.5, z * TILE);
        eraseMarks.add(m);
      }
    }
    if (eraseMarks.children.length === 0) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(TILE - 1, 0.4, TILE - 1), eraseMat);
      m.position.set(hoverCell[0] * TILE, level * LEVEL_H, hoverCell[1] * TILE);
      eraseMarks.add(m);
    }
    return;
  }
  ghost = preview(tool);
  place(ghost, { x: hoverCell[0], z: hoverCell[1], level, rot });
  scene.add(ghost);
}

function act(cell: [number, number], erase: boolean): void {
  if (erase || tool === "gomme") {
    const hit = tilesAt(cell);
    if (hit.length) change(() => (map.tiles = map.tiles.filter((_, i) => !hit.includes(i))));
    return;
  }
  const t: Tile = { kind: tool, x: cell[0], z: cell[1], level, rot };
  const same = map.tiles.find((o) => o.kind === t.kind && o.x === t.x && o.z === t.z && o.level === t.level && o.rot === t.rot);
  if (same) return;
  change(() => {
    map.tiles = map.tiles.filter((o) => !overlaps(o, t) && !(t.kind === "depart" && o.kind === "depart"));
    map.tiles.push(t);
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
  if (c) act(c, p.button === 2);
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
const GLYPHS: Record<PieceKind, string> = {
  depart: '<rect x="12" y="4" width="16" height="32" rx="2" fill="#5d6169"/><path d="M12 14h16v5H12z" fill="#fff"/><path d="M12 14h4v5h-4zM20 14h4v5h-4z" fill="#14101f"/><path d="M20 34v-9m-4 4 4-4 4 4" stroke="#ffb23e" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  droite: '<rect x="12" y="4" width="16" height="32" rx="2" fill="#5d6169"/><path d="M12 4v32M28 4v32" stroke="#e0393b" stroke-width="2" stroke-dasharray="4 3"/>',
  virage: '<path d="M14 36V30A10 10 0 0 1 24 20h12" stroke="#5d6169" stroke-width="16" fill="none"/>',
  grandVirage: '<path d="M10 38V28A18 18 0 0 1 28 10h10" stroke="#5d6169" stroke-width="11" fill="none"/>',
  pente: '<path d="M4 32h10l14-14h8v14z" fill="#5d6169"/><path d="M14 26l8-8m0 0h-5m5 0v5" stroke="#ffb23e" stroke-width="2" fill="none" stroke-linecap="round"/>',
  tremplin: '<path d="M4 32h12q10 0 16-12v12z" fill="#5d6169"/><path d="M34 14q2-4 4-5" stroke="#ffb23e" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="2 3"/>',
  vide: '<rect x="8" y="6" width="24" height="28" rx="2" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/>',
  checkpoint: '<rect x="12" y="4" width="16" height="32" rx="2" fill="#5d6169"/><path d="M8 20h24" stroke="#ffb23e" stroke-width="4"/><path d="M9 14v12M31 14v12" stroke="#ffb23e" stroke-width="3"/>',
  arrivee: '<rect x="12" y="4" width="16" height="32" rx="2" fill="#5d6169"/><path d="M12 8h16v8H12z" fill="#fff"/><path d="M12 8h4v4h-4zM20 8h4v4h-4zM16 12h4v4h-4zM24 12h4v4h-4z" fill="#14101f"/>',
};

const palette = $("palette");
PALETTE.forEach((kind, i) => {
  const b = document.createElement("button");
  b.className = "piece";
  b.dataset.kind = kind;
  b.title = `${PIECES[kind].label} (${i + 1})`;
  b.innerHTML = `<kbd>${i + 1}</kbd><svg viewBox="0 0 40 40" aria-hidden="true">${GLYPHS[kind]}</svg>${PIECES[kind].label}`;
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
  grid.position.y = level * LEVEL_H + GRID_Y;
  if (lastPointer) hoverCell = cellAt(lastPointer.x, lastPointer.y);
  updateHover();
}

$("rotBtn").addEventListener("click", () => rotate(1));
$("eraseBtn").addEventListener("click", () => setTool(tool === "gomme" ? "droite" : "gomme"));
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
  if (!result.ok) return;
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
  if (n >= 1 && n <= PALETTE.length) setTool(PALETTE[n - 1]!);
  else if (e.code === "KeyR") rotate(e.shiftKey ? -1 : 1);
  else if (e.code === "KeyX" || e.code === "Delete") setTool(tool === "gomme" ? "droite" : "gomme");
  else if (e.code === "KeyQ") yawGoal -= Math.PI / 2;
  else if (e.code === "KeyE") yawGoal += Math.PI / 2;
  else if (e.code === "PageUp") setLevel(level + 1);
  else if (e.code === "PageDown") setLevel(level - 1);
  else if (e.code === "ArrowLeft") pan(60, 0);
  else if (e.code === "ArrowRight") pan(-60, 0);
  else if (e.code === "ArrowUp") pan(0, 60);
  else if (e.code === "ArrowDown") pan(0, -60);
  else if (e.code === "Escape") setTool("droite");
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
  undoStack.push(JSON.stringify(map.tiles));
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
  setMap({ name: "Nouveau circuit", authorTime: null, tiles: [{ kind: "depart", x: 0, z: 0, level: 0, rot: 0 }] });
  closeCode();
});
$("exampleBtn").addEventListener("click", () => {
  setMap(exampleMap());
  closeCode();
});

// ---------- Boucle ----------
setTool("droite");
setLevel(0);
frameMap();
refresh();
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  updateCamera(dt);
  if (errorMark.visible) errorMark.position.y = errorBaseY + Math.sin(now / 200) * 1.2;
  renderer.render(scene, camera);
});
