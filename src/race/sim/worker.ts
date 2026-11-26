/// <reference lib="webworker" />
import { initPhysics } from "../physics/car";
import { findRoute } from "../world/route";
import { buildWorld, type World } from "../world/world";
import { Attempt, type CheckpointEvent } from "./attempt";
import { makeAutopilot } from "./autopilot";
import type { FromSim, ToSim } from "./protocol";
import { CAR_FIELDS, packCar } from "./snapshot";

/**
 * La simulation, dans son propre fil : la physique ne ralentit jamais l'affichage et inversement.
 * Tout ce qui compte pour le chrono et le replay se passe ici, à pas fixe.
 */
declare const self: DedicatedWorkerGlobalScope;

let world: World | null = null;
let attempt: Attempt | null = null;
let ghost: { attempt: Attempt; inputs: number[] } | null = null;
let id = 0;
let pilotRoute: ReturnType<typeof findRoute> = null;
let pilot: ((c: Attempt["car"]) => number) | null = null;
const queue: ToSim[] = [];
let loaded = false;

function post(m: FromSim, transfer: Transferable[] = []): void {
  self.postMessage(m, transfer);
}

function handle(m: ToSim): void {
  if (m.type === "init") {
    world = buildWorld(m.map);
    pilotRoute = m.autopilot ? findRoute(m.map.blocks) : null;
    post({ type: "ready" });
  } else if (m.type === "begin") {
    if (!world) return;
    attempt?.dispose();
    ghost?.attempt.dispose();
    id = m.id;
    attempt = new Attempt(world);
    ghost = m.ghost ? { attempt: new Attempt(world), inputs: m.ghost } : null;
    pilot = pilotRoute ? makeAutopilot(pilotRoute) : null;
    send([]);
  } else if (m.type === "step") {
    if (!attempt || m.id !== id) return;
    const events: CheckpointEvent[] = [];
    for (let k = 0; k < m.ticks && attempt.status === "running"; k++) {
      // Pilote de développement : il conduit quand on tient l'accélérateur
      const bits = pilot && m.bits & 1 ? pilot(attempt.car) : m.bits;
      const ev = attempt.step(bits);
      if (ev) events.push(ev);
      if (ghost && ghost.attempt.status === "running") {
        const i = ghost.attempt.tick;
        if (i < ghost.inputs.length) ghost.attempt.step(ghost.inputs[i]!);
      }
    }
    send(events);
  }
}

function send(events: CheckpointEvent[]): void {
  const a = attempt!;
  const g = ghost && ghost.attempt.tick > 0 ? ghost.attempt : null;
  const cars = new Float64Array(CAR_FIELDS * (g ? 4 : 2));
  packCar(a.tick > 0 ? a.prev : a.car, cars, 0);
  packCar(a.car, cars, CAR_FIELDS);
  if (g) {
    packCar(g.prev, cars, 2 * CAR_FIELDS);
    packCar(g.car, cars, 3 * CAR_FIELDS);
  }
  const done = a.status !== "running";
  post(
    {
      type: "state",
      id,
      tick: a.tick,
      status: a.status,
      time: a.time,
      cars,
      ghost: g !== null,
      events,
      end: done ? { time: a.finishTime, splits: a.splits.slice(), inputs: Uint8Array.from(a.inputs) } : undefined,
    },
    [cars.buffer],
  );
}

self.onmessage = (e: MessageEvent<ToSim>) => {
  if (!loaded) return void queue.push(e.data);
  handle(e.data);
};

// Le moteur physique se charge une fois ; les messages arrivés avant attendent
initPhysics().then(() => {
  loaded = true;
  for (const m of queue.splice(0)) handle(m);
});
