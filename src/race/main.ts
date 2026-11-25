import "./ui/race.css";
import { mountKeybindEditor } from "../shared/keybindEditor";
import { Controls } from "./input/controls";
import { copyCar, type CarState } from "./physics/car";
import { DT } from "./physics/constants";
import { IN_BRAKE, IN_DRIVE, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "./physics/input";
import { RaceView } from "./render/view";
import { formatDelta, formatTime, medalFor, Session } from "./session/session";
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
 * results : les 10 essais sont joués
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
const view = new RaceView($("scene") as HTMLCanvasElement, world, $("speedfx") as HTMLCanvasElement);

let session = new Session();
let attempt = new Attempt(world);
let ghost: { attempt: Attempt; inputs: number[]; time: number } | null = null;
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
  attempt = new Attempt(world);
  if (devRoute) devPilot = makeAutopilot(devRoute);
  const best = session.best;
  ghost = best && best.time !== null ? { attempt: new Attempt(world), inputs: best.inputs, time: best.time } : null;
  view.snapCamera();
  hud.setAttempt(session.current);
  hud.setTime(0);
  hud.clearFlash();
  accumulator = 0;
  phase = "ready";
}

function finishAttempt(): void {
  const time = attempt.status === "finished" ? attempt.finishTime : null;
  const { isBest, previousBest } = session.record({ time, splits: attempt.splits.slice(), inputs: attempt.inputs.slice() });
  refreshBest();
  if (time !== null) {
    savePersonalBest(time);
    const delta = previousBest === null ? "" : `<span class="delta ${time - previousBest <= 0 ? "ahead" : "behind"}">${formatDelta(time - previousBest)}</span>`;
    hud.flash(`<b class="big-time">${formatTime(time)}</b>${delta}${isBest ? '<span class="tag">Nouveau record</span>' : ""}`, 1500, "finish");
  } else if (attempt.status === "fell") {
    hud.flash('<b class="big-word">Chute</b>', 900, "fail");
  }
  phase = "between";
  phaseTimer = attempt.status === "finished" ? 1.6 : 0.9;
}

/** Recommencer : abandonne l'essai en cours (il compte s'il avait commencé) et remet la voiture sur la ligne. */
function restart(): void {
  if (phase === "results" || settingsOpen()) return;
  if (phase === "running") {
    session.record({ time: null, splits: [], inputs: attempt.inputs.slice() });
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
      session = new Session();
      refreshBest();
      beginAttempt();
    },
    goMenu,
  );
}

// En développement seulement : race.html?pilote ajoute le pilote automatique au gaz (pour tester le fantôme).
const devRoute = import.meta.env.DEV && params.has("pilote") ? findRoute(mapDef.blocks) : null;
let devPilot = devRoute ? makeAutopilot(devRoute) : null;

function tick(): void {
  const ev = attempt.step(devPilot && (controls.bits & IN_THROTTLE) ? devPilot(attempt.car) : controls.bits);
  if (ghost && ghost.attempt.status === "running") {
    const i = ghost.attempt.tick;
    if (i < ghost.inputs.length) ghost.attempt.step(ghost.inputs[i]!);
  }
  if (ev) {
    const ref = session.best?.splits?.[ev.index];
    hud.showSplit(ev.index, ev.time, ref === undefined ? null : ev.time - ref);
  }
  if (attempt.status !== "running") finishAttempt();
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  if (phase === "ready" && !settingsOpen() && (controls.bits & IN_DRIVE) !== 0) {
    // Première touche : le chrono démarre maintenant
    phase = "running";
    accumulator = 0;
  }
  if (phase === "running") {
    accumulator += dt;
    while (accumulator >= DT && phase === "running") {
      tick();
      accumulator -= DT;
    }
    hud.setTime(attempt.time);
  } else if (phase === "between") {
    phaseTimer -= dt;
    if (phaseTimer <= 0) {
      if (session.done) showResults();
      else beginAttempt();
    }
  }

  const alpha = phase === "running" ? accumulator / DT : 1;
  const g = ghost && ghost.attempt.tick > 0 ? { prev: ghost.attempt.prev, cur: ghost.attempt.car, time: ghost.time } : null;
  const prev: CarState = attempt.tick > 0 ? attempt.prev : copyCar(attempt.car);
  view.render(prev, attempt.car, Math.min(1, alpha), g, dt);
  hud.setSpeed(Math.hypot(attempt.car.vx, attempt.car.vz));
  requestAnimationFrame(frame);
}

hud.setBest(null, null);
const pb = loadPersonalBest();
if (pb !== null) $("pb").textContent = formatTime(pb);
beginAttempt();
requestAnimationFrame(frame);
