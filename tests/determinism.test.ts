import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics } from "../src/race/physics/car";
import { IN_LEFT, IN_RIGHT, IN_THROTTLE } from "../src/race/physics/input";
import { decodeInputs, encodeInputs, fromBase64, toBase64 } from "../src/race/replay/codec";
import { Attempt, replayAttempt } from "../src/race/sim/attempt";
import { makeAutopilot } from "../src/race/sim/autopilot";
import { GRAND_SAUT } from "../src/race/world/maps/grandSaut";
import { findRoute } from "../src/race/world/route";
import { buildWorld } from "../src/race/world/world";

const world = buildWorld(GRAND_SAUT);
beforeAll(() => initPhysics());

function drive(lookahead = 14, turnSpeed = 34) {
  const route = findRoute(GRAND_SAUT.blocks)!;
  const pilot = makeAutopilot(route, lookahead, turnSpeed);
  const a = new Attempt(world);
  while (a.status === "running" && a.tick < 120 * 90) a.step(pilot(a.car));
  return a;
}

describe("physique déterministe", () => {
  it("la map est faisable de bout en bout (saut compris)", () => {
    const a = drive();
    expect(a.status).toBe("finished");
    expect(a.splits).toHaveLength(2);
    expect(a.finishTime!).toBeLessThan(GRAND_SAUT.medals.bronze);
  });

  it("deux runs avec les mêmes entrées donnent exactement le même résultat", () => {
    const a = drive();
    const b = drive();
    expect(b.car).toEqual(a.car);
    expect(b.finishTime).toBe(a.finishTime);
  });

  it("rejouer les entrées enregistrées redonne le même temps (fantôme, anti-triche)", () => {
    const a = drive(18, 38);
    const replay = replayAttempt(world, a.inputs);
    expect(replay.status).toBe(a.status);
    expect(replay.time).toBe(a.finishTime);
    expect(replay.splits).toEqual(a.splits);
  });

  it("un replay compressé fait quelques centaines d'octets et se relit à l'identique", () => {
    const a = drive();
    const packed = encodeInputs(a.inputs);
    expect(packed.length).toBeLessThan(2000);
    expect(decodeInputs(fromBase64(toBase64(packed)))).toEqual(a.inputs);
  });

  it("foncer tout droit fait taper le rebord du premier virage, qui freine la voiture", () => {
    const a = new Attempt(world);
    let before = 0;
    let after = -1;
    let hit = 0;
    while (a.tick < 120 * 6 && a.status === "running") {
      const sp = Math.hypot(a.car.vx, a.car.vz);
      a.step(IN_THROTTLE);
      if (a.car.onWall && hit === 0) {
        before = sp;
        hit = a.tick;
      }
      // Le choc vient du moteur physique : il dure quelques pas, on mesure la vitesse un quart de seconde après
      if (hit > 0 && a.tick === hit + 30) after = Math.hypot(a.car.vx, a.car.vz);
    }
    expect(after).toBeGreaterThanOrEqual(0);
    expect(a.status).toBe("running");
    expect(after).toBeLessThan(before * 0.8);
  });

  it("les rebords empêchent de tomber en zigzaguant sur la ligne droite", () => {
    const a = new Attempt(world);
    while (a.status === "running" && a.tick < 120 * 3) a.step(IN_THROTTLE | (Math.floor(a.tick / 40) % 2 ? IN_LEFT : IN_RIGHT));
    expect(a.status).not.toBe("fell");
  });

  it("l'arrivée ne compte pas si un checkpoint manque", () => {
    // Map minimale : départ, checkpoint à côté (pas sur le chemin), arrivée
    const w = buildWorld({
      id: "t",
      name: "t",
      medals: GRAND_SAUT.medals,
      blocks: [
        { kind: "depart", x: 0, z: 0, level: 0, rot: 0 },
        { kind: "route", x: 0, z: 1, level: 0, rot: 0 },
        { kind: "arrivee", x: 0, z: 2, level: 0, rot: 0 },
        { kind: "checkpoint", x: 3, z: 1, level: 0, rot: 0 },
      ],
    });
    const a = new Attempt(w);
    while (a.status === "running" && a.tick < 120 * 4) a.step(IN_THROTTLE);
    expect(a.status).not.toBe("finished");
  });
});
