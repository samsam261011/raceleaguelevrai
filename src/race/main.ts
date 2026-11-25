import "./ui/race.css";
import { Controls } from "./input/controls";
import { copyCar, type CarState } from "./physics/car";
import { DT } from "./physics/constants";
import { IN_BRAKE, IN_DRIFT, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "./physics/input";
import { RaceView } from "./render/view";
import { Session, medalFor, formatDelta, formatTime } from "./session/session";
import { Attempt } from "./sim/attempt";
import { buildTrack } from "./track/build";
import { DEFAULT_MAP, MAPS } from "./track/maps";
import { Hud } from "./ui/hud";

type Phase = "countdown" | "running" | "between" | "results";

const params = new URLSearchParams(location.search);
const mapDef = MAPS[params.get("map") ?? DEFAULT_MAP] ?? MAPS[DEFAULT_MAP]!;
const track = buildTrack(mapDef);
document.title = `${mapDef.name} · RaceLeague`;
document.getElementById("mapName")!.textContent = mapDef.name;

const hud = new Hud();
const view = new RaceView(document.getElementById("scene") as HTMLCanvasElement, track);

let session = new Session();
let attempt = new Attempt(track);
let ghost: { attempt: Attempt; inputs: number[] } | null = null;
let phase: Phase = "countdown";
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
  onMenu: () => goMenu(),
});
for (const [id, flag] of [
  ["tLeft", IN_LEFT],
  ["tRight", IN_RIGHT],
  ["tGas", IN_THROTTLE],
  ["tBrake", IN_BRAKE],
  ["tDrift", IN_DRIFT],
] as const) {
  controls.bindTouchButton(document.getElementById(id)!, flag);
}
document.getElementById("restartBtn")!.addEventListener("click", () => restart());
document.getElementById("menuBtn")!.addEventListener("click", () => goMenu());
// Affiche les commandes tactiles dès qu'on touche l'écran
window.addEventListener("touchstart", () => document.body.classList.add("touch"), { once: true, passive: true });
if (window.matchMedia("(pointer: coarse)").matches) document.body.classList.add("touch");

function goMenu(): void {
  location.href = "./index.html";
}

function refreshBest(): void {
  const best = session.bestTime;
  hud.setBest(best, medalFor(best, mapDef.medals));
}

/** Prépare un nouvel essai. Le premier a un compte à rebours, les suivants partent tout de suite. */
function beginAttempt(withCountdown: boolean): void {
  attempt = new Attempt(track);
  const best = session.best;
  ghost = best ? { attempt: new Attempt(track), inputs: best.inputs } : null;
  view.snapCamera();
  hud.setAttempt(session.current);
  hud.setTime(0);
  accumulator = 0;
  if (withCountdown) {
    phase = "countdown";
    phaseTimer = 3;
  } else {
    phase = "running";
    hud.clearFlash();
  }
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

/** Recommencer : abandonne l'essai en cours (il compte) et repart aussitôt. */
function restart(): void {
  if (phase === "results") return;
  if (phase === "running" && attempt.tick > 0) {
    session.record({ time: null, splits: [], inputs: attempt.inputs.slice() });
    refreshBest();
  }
  if (phase === "countdown") return;
  if (session.done) return showResults();
  beginAttempt(false);
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
      beginAttempt(true);
    },
    goMenu,
  );
}

function tick(): void {
  const ev = attempt.step(controls.bits);
  if (ghost && ghost.attempt.status === "running") {
    const i = ghost.attempt.tick;
    if (i < ghost.inputs.length) ghost.attempt.step(ghost.inputs[i]!);
  }
  if (ev) {
    const bestSplits = session.best?.splits;
    const ref = bestSplits?.[ev.index];
    hud.showSplit(ev.index, ev.time, ref === undefined ? null : ev.time - ref);
  }
  if (attempt.status !== "running") finishAttempt();
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;

  if (phase === "countdown") {
    const before = Math.ceil(phaseTimer);
    phaseTimer -= dt;
    const after = Math.ceil(phaseTimer);
    if (after !== before || !document.querySelector(".center.show")) {
      if (phaseTimer > 0) hud.flash(`<b class="count">${after}</b>`, 0, "count");
    }
    if (phaseTimer <= 0) {
      phase = "running";
      hud.flash('<b class="count go">GO</b>', 600, "count");
    }
  } else if (phase === "running") {
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
      else beginAttempt(false);
    }
  }

  const alpha = phase === "running" ? accumulator / DT : 1;
  const g = ghost && ghost.attempt.tick > 0 ? { prev: ghost.attempt.prev, cur: ghost.attempt.car } : null;
  const prev: CarState = attempt.tick > 0 ? attempt.prev : copyCar(attempt.car);
  view.render(prev, attempt.car, Math.min(1, alpha), g, dt);
  hud.setSpeed(Math.hypot(attempt.car.vx, attempt.car.vz));
  requestAnimationFrame(frame);
}

hud.setBest(null, null);
const pb = loadPersonalBest();
if (pb !== null) document.getElementById("pb")!.textContent = formatTime(pb);
beginAttempt(true);
requestAnimationFrame(frame);
