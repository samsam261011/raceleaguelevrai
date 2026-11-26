import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics } from "../src/race/physics/car";
import { IN_RIGHT, IN_THROTTLE } from "../src/race/physics/input";
import { Attempt } from "../src/race/sim/attempt";
import { makeAutopilot } from "../src/race/sim/autopilot";
import { GRAND_SAUT } from "../src/race/world/maps/grandSaut";
import { findRoute } from "../src/race/world/route";
import { buildWorld, type Block } from "../src/race/world/world";

beforeAll(() => initPhysics());

/** Une grande esplanade de plaques, pour tester la voiture sans rebords. */
function esplanade() {
  const blocks: Block[] = [{ kind: "depart", x: 0, z: -20, level: 0, rot: 0 }, { kind: "arrivee", x: 30, z: 30, level: 0, rot: 0 }];
  for (let x = -20; x <= 20; x++) for (let z = -19; z <= 20; z++) blocks.push({ kind: "plaque", x, z, level: 0, rot: 0 });
  return buildWorld({ id: "e", name: "e", medals: GRAND_SAUT.medals, blocks });
}

/** Inclinaison sur le côté (roulis), en radians environ : composante latérale du haut de la voiture. */
const roll = (c: { qx: number; qy: number; qz: number; qw: number }) => Math.abs(2 * (c.qx * c.qy - c.qw * c.qz));

describe("moteur de conduite v3", () => {
  it("au repos, la voiture se pose sur ses quatre roues", () => {
    const a = new Attempt(esplanade());
    for (let i = 0; i < 120; i++) a.step(0);
    expect(a.car.wheels.every((w) => w.contact)).toBe(true);
    expect(Math.abs(a.car.y - a.world.spawn.y)).toBeLessThan(0.1);
    a.dispose();
  });

  it("elle reste à plat dans un virage à fond (pas de roulis visible)", () => {
    const a = new Attempt(esplanade());
    while (a.car.speed < 45) a.step(IN_THROTTLE);
    let worst = 0;
    for (let i = 0; i < 90; i++) {
      a.step(IN_THROTTLE | IN_RIGHT);
      worst = Math.max(worst, roll(a.car));
    }
    expect(worst).toBeLessThan(0.03);
    expect(a.car.speed).toBeGreaterThan(40);
    a.dispose();
  });

  it("elle tourne à droite avec la touche droite", () => {
    const a = new Attempt(esplanade());
    while (a.car.speed < 20) a.step(IN_THROTTLE);
    const x0 = a.car.x;
    for (let i = 0; i < 60; i++) a.step(IN_THROTTLE | IN_RIGHT);
    // Départ vers +z : la droite de la voiture est du côté des x négatifs
    expect(a.car.x).toBeLessThan(x0 - 2);
    a.dispose();
  });

  it("après le grand saut, elle retombe sur ses roues et repart", () => {
    const world = buildWorld(GRAND_SAUT);
    const pilot = makeAutopilot(findRoute(GRAND_SAUT.blocks)!);
    const a = new Attempt(world);
    let flew = false;
    let airTicks = 0;
    let landedFlat = false;
    while (a.status === "running" && a.tick < 120 * 60) {
      a.step(pilot(a.car));
      if (!a.car.grounded) airTicks++;
      else if (airTicks > 120) flew = true;
      // Une fois retombée : les quatre roues au sol et la caisse à plat
      if (flew && a.car.wheels.every((w) => w.contact) && roll(a.car) < 0.05) landedFlat = true;
    }
    expect(flew).toBe(true);
    expect(landedFlat).toBe(true);
    expect(a.status).toBe("finished");
    a.dispose();
  });
});
