import "./ui/race.css";
import { mountKeybindEditor } from "../shared/keybindEditor";
import { Controls } from "./input/controls";
import type { CarState } from "./physics/car";
import { DT } from "./physics/constants";
import { IN_BRAKE, IN_DRIVE, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "./physics/input";
import { RaceView } from "./render/view";
import { ATTEMPTS_PER_MATCH, formatDelta, formatTime, medalFor, Session } from "./session/session";
import type { AttemptStatus } from "./sim/attempt";
import type { FromSim, ToSim } from "./sim/protocol";
import { CAR_FIELDS, cloneCar, unpackCar } from "./sim/snapshot";
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
const view = new RaceView($("scene") as HTMLCanvasElement, world, $("speedfx") as HTMLCanvasElement);

/** Classé (race.html?classe) : 10 essais. Solo : essais illimités. */
const ranked = params.has("classe");
const newSession = (): Session => new Session(ranked ? ATTEMPTS_PER_MATCH : Infinity);
let session = newSession();
/**
 * La simulation tourne dans un Web Worker (sim/worker.ts) : physique à pas fixe, chrono, fantôme, replay.
 * Ici, on garde seulement le dernier instantané reçu, pour l'afficher.
 */
const sim = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });
const toSim = (m: ToSim) => sim.postMessage(m);
interface Live {
  id: number;
  tick: number;
  status: AttemptStatus;
  time: number;
  prev: CarState;
  car: CarState;
  ghost: { prev: CarState; cur: CarState } | null;
  splits: number[];
}
let live: Live | null = null;
let attemptId = 0;
let ghostTime: number | null = null;
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
  attemptId++;
  const best = session.best;
  ghostTime = best && best.time !== null ? best.time : null;
  // Le Worker libère l'essai précédent et son fantôme, et répond avec la voiture posée sur la ligne
  toSim({ type: "begin", id: attemptId, ghost: best && best.time !== null ? best.inputs.slice() : null });
  view.snapCamera();
  hud.setAttempt(session.current, session.attempts);
  hud.setTime(0);
  hud.clearFlash();
  accumulator = 0;
  phase = "ready";
}

/** Instantané reçu de la simulation. */
sim.onmessage = (e: MessageEvent<FromSim>) => {
  const m = e.data;
  if (m.type === "ready") return void beginAttempt();
  if (m.id !== attemptId) return;
  const cars = m.cars;
  const first = !live || live.id !== m.id;
  live = {
    id: m.id,
    tick: m.tick,
    status: m.status,
    time: m.time,
    prev: unpackCar(cars, 0),
    car: unpackCar(cars, CAR_FIELDS),
    ghost: m.ghost ? { prev: unpackCar(cars, 2 * CAR_FIELDS), cur: unpackCar(cars, 3 * CAR_FIELDS) } : null,
    splits: first ? [] : live!.splits,
  };
  if (first) view.snapCamera();
  for (const ev of m.events) {
    live.splits.push(ev.time);
    const ref = session.best?.splits?.[ev.index];
    hud.showSplit(ev.index, ev.time, ref === undefined ? null : ev.time - ref);
  }
  if (m.end && phase === "running") finishAttempt(m.status, m.end);
};

function finishAttempt(status: AttemptStatus, end: { time: number | null; splits: number[]; inputs: Uint8Array }): void {
  const time = status === "finished" ? end.time : null;
  const { isBest, previousBest } = session.record({ time, splits: end.splits, inputs: Array.from(end.inputs) });
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
  if (phase === "results" || settingsOpen() || !live) return;
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
const devPilot = import.meta.env.DEV && params.has("pilote");

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
    // Pas fixe : on demande au Worker autant de pas de 1/120 s que le temps écoulé en contient
    accumulator += dt;
    const ticks = Math.floor(accumulator / DT);
    if (ticks > 0) {
      accumulator -= ticks * DT;
      toSim({ type: "step", id: attemptId, ticks, bits: controls.bits });
    }
    if (live) hud.setTime(live.time);
  } else if (phase === "between") {
    phaseTimer -= dt;
    if (phaseTimer <= 0) {
      if (session.done) showResults();
      else beginAttempt();
    }
  }

  if (live) {
    // Entre les deux derniers pas reçus, selon le temps déjà écoulé vers le pas suivant
    const alpha = phase === "running" ? accumulator / DT : 1;
    const g = live.ghost && ghostTime !== null ? { prev: live.ghost.prev, cur: live.ghost.cur, time: ghostTime } : null;
    const prev = live.tick > 0 ? live.prev : cloneCar(live.car);
    view.render(prev, live.car, Math.min(1, alpha), g, dt);
    hud.setSpeed(Math.hypot(live.car.vx, live.car.vz));
  }
  requestAnimationFrame(frame);
}

hud.setBest(null, null);
const pb = loadPersonalBest();
if (pb !== null) $("pb").textContent = formatTime(pb);
// La simulation charge le moteur physique, construit la piste, puis la voiture se pose sur la ligne
toSim({ type: "init", map: mapDef, autopilot: devPilot });
requestAnimationFrame(frame);
