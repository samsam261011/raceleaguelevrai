import "./ui/race.css";
import { mountKeybindEditor } from "../shared/keybindEditor";
import { Controls } from "./input/controls";
import { copyCar, initPhysics } from "./physics/car";
import { DT } from "./physics/constants";
import { IN_BRAKE, IN_DRIVE, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "./physics/input";
import { RaceView } from "./render/view";
import { ATTEMPTS_PER_MATCH, formatDelta, formatTime, medalFor, Session } from "./session/session";
import { Attempt } from "./sim/attempt";
import { makeAutopilot } from "./sim/autopilot";
import { customMapId, decodeMap } from "./world/code";
import { DEFAULT_MAP, MAPS } from "./world/maps";
import { findRoute } from "./world/route";
import { buildWorld, medalsFrom, validateMap, type MapDefinition } from "./world/world";
import { Hud } from "./ui/hud";

/**
 * ready   : la voiture attend sur la ligne, le chrono part à la première touche de conduite
 * running : l'essai est en cours
 * between : petit temps après une arrivée ou une chute
 * results : les 10 essais du classé sont joués
 */
type Phase = "ready" | "running" | "between" | "results";

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const fromEditor = params.has("editeur");
const mapDef = customMap(params.get("code")) ?? MAPS[params.get("map") ?? DEFAULT_MAP] ?? MAPS[DEFAULT_MAP]!;

/** Map créée dans l'éditeur, passée par son code texte. */
function customMap(code: string | null): MapDefinition | null {
  if (!code) return null;
  try {
    const m = decodeMap(code);
    if (validateMap(m.blocks)) return null;
    // Sans temps auteur, on estime les médailles d'après la longueur du chemin
    const route = findRoute(m.blocks);
    const estimate = Math.round(((route ? route.length : m.blocks.length * 20) / 45) * 10) / 10;
    return { id: customMapId(m.blocks), name: m.name || "Sans nom", blocks: m.blocks, medals: medalsFrom(m.authorTime ?? estimate) };
  } catch {
    return null;
  }
}
const world = buildWorld(mapDef);
document.title = `${mapDef.name} · RaceLeague`;
$("mapName").textContent = mapDef.name;

const hud = new Hud();
const view = new RaceView($("scene") as HTMLCanvasElement, world);

/** Classé (race.html?classe) : 10 essais. Solo : essais illimités. */
const ranked = params.has("classe");
const newSession = (): Session => new Session(ranked ? ATTEMPTS_PER_MATCH : Infinity);
let session = newSession();
/**
 * La simulation tourne ici, dans le même fil que l'affichage, à pas fixe de 1/120 s :
 * la touche lue au début de l'image agit sur la voiture dans cette même image (aucun aller-retour).
 */
let attempt: Attempt | null = null;
let ghost: { attempt: Attempt; inputs: number[]; time: number } | null = null;
let pilot: ((c: Attempt["car"]) => number) | null = null;
let phase: Phase = "ready";
let phaseTimer = 0;
let accumulator = 0;

const storeKey = `raceleague.best.${mapDef.id}`;
function loadPersonalBest(): number | null {
  try {
    const v = localStorage.getItem(storeKey);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function savePersonalBest(t: number): void {
  try {
    const cur = loadPersonalBest();
    if (cur === null || t < cur) localStorage.setItem(storeKey, String(t));
  } catch {
    /* stockage indisponible : on continue sans */
  }
}

const controls = new Controls({
  onRestart: () => restart(),
  onMenu: () => (settingsOpen() ? closeSettings() : goMenu()),
});
for (const [id, flag] of [
  ["tLeft", IN_LEFT],
  ["tRight", IN_RIGHT],
  ["tGas", IN_THROTTLE],
  ["tBrake", IN_BRAKE],
] as const) {
  controls.bindTouchButton($(id), flag);
}
$("restartBtn").addEventListener("click", () => restart());
$("menuBtn").addEventListener("click", () => goMenu());
// Affiche les commandes tactiles dès qu'on touche l'écran
window.addEventListener("touchstart", () => document.body.classList.add("touch"), { once: true, passive: true });
if (window.matchMedia("(pointer: coarse)").matches) document.body.classList.add("touch");

// Paramètres : changer ses touches
const settings = $("settings");
mountKeybindEditor($("keybinds"), (b) => controls.setBindings(b));
const settingsOpen = () => !settings.hidden;
function openSettings(): void {
  settings.hidden = false;
  controls.paused = true;
  controls.release();
  ($("closeSettings") as HTMLButtonElement).focus();
}
function closeSettings(): void {
  settings.hidden = true;
  controls.paused = false;
  $("settingsBtn").focus();
}
$("settingsBtn").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);

function goMenu(): void {
  location.href = fromEditor ? "./editor.html" : "./";
}

function refreshBest(): void {
  const best = session.bestTime;
  hud.setBest(best, medalFor(best, mapDef.medals));
}

/** Prépare un essai : la voiture attend sur la ligne, le chrono partira à la première touche. */
function beginAttempt(): void {
  attempt?.dispose();
  ghost?.attempt.dispose();
  attempt = new Attempt(world);
  const best = session.best;
  ghost = best && best.time !== null ? { attempt: new Attempt(world), inputs: best.inputs.slice(), time: best.time } : null;
  pilot = pilotRoute ? makeAutopilot(pilotRoute) : null;
  view.snapCamera();
  hud.setAttempt(session.current, session.attempts);
  hud.setTime(0);
  hud.clearFlash();
  accumulator = 0;
  phase = "ready";
}

/** Un pas de simulation (1/120 s) pour la voiture et pour le fantôme. */
function stepSim(bits: number): void {
  const a = attempt!;
  // Pilote de développement : il conduit quand on tient l'accélérateur
  const ev = a.step(pilot && bits & IN_THROTTLE ? pilot(a.car) : bits);
  if (ev) {
    const ref = session.best?.splits?.[ev.index];
    hud.showSplit(ev.index, ev.time, ref === undefined ? null : ev.time - ref);
  }
  if (ghost && ghost.attempt.status === "running") {
    const i = ghost.attempt.tick;
    if (i < ghost.inputs.length) ghost.attempt.step(ghost.inputs[i]!);
  }
}

function finishAttempt(a: Attempt): void {
  const status = a.status;
  const time = status === "finished" ? a.finishTime : null;
  const { isBest, previousBest } = session.record({ time, splits: a.splits.slice(), inputs: a.inputs.slice() });
  refreshBest();
  if (time !== null) {
    savePersonalBest(time);
    const delta = previousBest === null ? "" : `<span class="delta ${time - previousBest <= 0 ? "ahead" : "behind"}">${formatDelta(time - previousBest)}</span>`;
    hud.flash(`<b class="big-time">${formatTime(time)}</b>${delta}${isBest ? '<span class="tag">Nouveau record</span>' : ""}`, 1500, "finish");
  } else if (status === "fell") {
    hud.flash('<b class="big-word">Chute</b>', 900, "fail");
  }
  phase = "between";
  phaseTimer = status === "finished" ? 1.6 : 0.9;
}

/** Recommencer : abandonne l'essai en cours (il compte s'il avait commencé) et remet la voiture sur la ligne. */
function restart(): void {
  if (phase === "results" || settingsOpen() || !attempt) return;
  if (phase === "running") {
    session.record({ time: null, splits: [], inputs: [] });
    refreshBest();
  }
  if (session.done) return showResults();
  beginAttempt();
}

function showResults(): void {
  phase = "results";
  hud.clearFlash();
  const best = session.bestTime;
  hud.showResults(
    session.results.map((r) => r.time),
    best,
    medalFor(best, mapDef.medals),
    () => {
      hud.hideResults();
      session = newSession();
      refreshBest();
      beginAttempt();
    },
    goMenu,
  );
}

// En développement seulement : race.html?pilote ajoute le pilote automatique au gaz (pour tester le fantôme).
const pilotRoute = import.meta.env.DEV && params.has("pilote") ? findRoute(mapDef.blocks) : null;

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  if (!attempt) return void requestAnimationFrame(frame);
  const bits = settingsOpen() ? 0 : controls.bits;
  if (phase === "ready" && (bits & IN_DRIVE) !== 0) {
    // Première touche : le chrono démarre, et la voiture bouge dès cette image
    phase = "running";
    accumulator = DT;
  }
  if (phase === "running") {
    // Pas fixe : autant de pas de 1/120 s que le temps écoulé en contient
    accumulator += dt;
    while (accumulator >= DT && attempt.status === "running") {
      stepSim(bits);
      accumulator -= DT;
    }
    hud.setTime(attempt.time);
    if (attempt.status !== "running") finishAttempt(attempt);
  } else if (phase === "between") {
    phaseTimer -= dt;
    if (phaseTimer <= 0) {
      if (session.done) showResults();
      else beginAttempt();
    }
  }

  // Entre les deux derniers pas, selon le temps déjà écoulé vers le pas suivant
  const a = attempt;
  const alpha = phase === "running" ? Math.min(1, accumulator / DT) : 1;
  const prev = a.tick > 0 ? a.prev : copyCar(a.car);
  const g = ghost && ghost.attempt.tick > 0 ? { prev: ghost.attempt.prev, cur: ghost.attempt.car, time: ghost.time } : null;
  view.render(prev, a.car, alpha, g, dt);
  hud.setSpeed(Math.hypot(a.car.vx, a.car.vz));
  requestAnimationFrame(frame);
}

hud.setBest(null, null);
const pb = loadPersonalBest();
if (pb !== null) $("pb").textContent = formatTime(pb);
// Le moteur physique se charge une fois, puis la voiture se pose sur la ligne
initPhysics().then(beginAttempt);
requestAnimationFrame(frame);
