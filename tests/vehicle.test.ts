import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics } from "../src/race/physics/car";
import { IN_BRAKE, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "../src/race/physics/input";
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

/** Inclinaison sur le côté (roulis), en radians environ : hauteur prise par l'axe gauche-droite de la voiture, quel que soit son cap. */
const roll = (c: { qx: number; qy: number; qz: number; qw: number }) => Math.abs(2 * (c.qx * c.qy + c.qw * c.qz));

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

  it("frotter un parapet ralentit sans accrocher ni faire basculer la voiture", () => {
    const blocks: Block[] = [{ kind: "depart", x: 0, z: 0, level: 0, rot: 0 }, { kind: "arrivee", x: 0, z: 16, level: 0, rot: 0 }];
    for (let z = 1; z < 16; z++) blocks.push({ kind: "route", x: 0, z, level: 0, rot: 0 });
    const a = new Attempt(buildWorld({ id: "m", name: "m", medals: GRAND_SAUT.medals, blocks }));
    while (a.car.speed < 50) a.step(IN_THROTTLE);
    let touched = false;
    let worstTilt = 0;
    let slowest = Infinity;
    for (let i = 0; i < 240 && a.status === "running"; i++) {
      // On dérive en biais vers le mur de gauche (environ 15°), puis on reste collé contre lui
      a.step(IN_THROTTLE | (i < 30 || i % 20 < 6 ? IN_LEFT : 0));
      if (a.car.onWall) touched = true;
      if (i > 80) slowest = Math.min(slowest, a.car.speed);
      worstTilt = Math.max(worstTilt, roll(a.car));
    }
    expect(touched).toBe(true);
    expect(a.status).toBe("running");
    // Ça freine, mais pas d'arrêt net aux jonctions entre deux pièces
    expect(slowest).toBeGreaterThan(15);
    expect(worstTilt).toBeLessThan(0.12);
    a.dispose();
  });

  it("une voiture retournée est remise sur ses roues", () => {
    const a = new Attempt(esplanade());
    for (let i = 0; i < 30; i++) a.step(0);
    a.sim.teleport(0, 1.5, 0, { x: 0, y: 0, z: 1, w: 0 });
    let t = 0;
    while (t < 360 && !(t > 10 && a.car.wheels.every((w) => w.contact))) {
      a.step(0);
      t++;
    }
    expect(t).toBeLessThan(300);
    expect(1 - 2 * (a.car.qx * a.car.qx + a.car.qz * a.car.qz)).toBeGreaterThan(0.95);
    a.dispose();
  });

  it("on passe sous un pont : pas de pylône au milieu de la route du dessous", () => {
    const blocks: Block[] = [{ kind: "depart", x: 0, z: 0, level: 0, rot: 0 }, { kind: "arrivee", x: 0, z: 6, level: 0, rot: 0 }];
    for (let z = 1; z < 6; z++) blocks.push({ kind: "route", x: 0, z, level: 0, rot: 0 });
    for (let x = -3; x <= 3; x++) blocks.push({ kind: "route", x, z: 3, level: 4, rot: 1 });
    const a = new Attempt(buildWorld({ id: "p", name: "p", medals: GRAND_SAUT.medals, blocks }));
    while (a.status === "running" && a.tick < 120 * 8) a.step(IN_THROTTLE);
    expect(a.status).toBe("finished");
    a.dispose();
  });

  it("le grand saut dure longtemps, sans plongeon du nez, et freiner en l'air arrête les rotations sans ralentir la voiture", () => {
    const pilot = makeAutopilot(findRoute(GRAND_SAUT.blocks)!);
    const a = new Attempt(buildWorld(GRAND_SAUT));
    let air = 0;
    let longest = 0;
    let worst = 0;
    let lost = 0;
    let takeoff = 0;
    let peakNose = -1;
    let dive = 0;
    let spin = 0;
    let flightRoll = 0;
    let flightSpin = 0;
    while (a.status === "running" && a.tick < 120 * 60) {
      const flying = !a.car.grounded;
      const q0 = a.car;
      if (flying && air === 0) takeoff = Math.hypot(a.car.vx, a.car.vz);
      a.step(flying ? IN_BRAKE : pilot(a.car));
      if (!a.car.grounded) {
        air++;
        // Le nez ne plonge jamais : il ne descend pas sous la plus haute position prise depuis le décollage
        const c = a.car;
        const nose = 2 * (c.qy * c.qz - c.qw * c.qx);
        peakNose = Math.max(peakNose, nose);
        dive = Math.max(dive, peakNose - nose);
        // Freiner en l'air ne redresse pas la voiture (aucune force artificielle) : il arrête ses rotations.
        // Après 0,4 s de vol, elle ne tourne presque plus et reste à plat.
        // Mesuré sur les vols de plus d'une seconde (les grands sauts) : un petit saut pris en plein virage
        // part avec du roulis, et 0,4 s de frein ne suffit pas toujours à l'arrêter avant de se poser.
        if (air > 48) {
          flightRoll = Math.max(flightRoll, roll(a.car));
          flightSpin = Math.max(flightSpin, Math.abs(c.qx - q0.qx) + Math.abs(c.qy - q0.qy) + Math.abs(c.qz - q0.qz));
        }
        lost = Math.max(lost, takeoff - Math.hypot(a.car.vx, a.car.vz));
      } else {
        longest = Math.max(longest, air);
        if (air > 120) {
          worst = Math.max(worst, flightRoll);
          spin = Math.max(spin, flightSpin);
        }
        flightRoll = 0;
        flightSpin = 0;
        air = 0;
        peakNose = -1;
      }
    }
    expect(a.status).toBe("finished");
    expect(longest / 120).toBeGreaterThan(1.8);
    expect(worst).toBeLessThan(0.08);
    expect(spin).toBeLessThan(0.001);
    expect(lost).toBeLessThan(1);
    expect(dive).toBeLessThan(0.03);
    a.dispose();
  });

  it("tenir une direction pendant un long saut ne fait pas atterrir en travers", () => {
    const pilot = makeAutopilot(findRoute(GRAND_SAUT.blocks)!);
    const a = new Attempt(buildWorld(GRAND_SAUT));
    let air = 0;
    let takeoff = 0;
    let watch = 0;
    let drift = 0;
    let slowest = Infinity;
    let checked = 0;
    while (a.status === "running" && a.tick < 120 * 30) {
      const flying = !a.car.grounded;
      a.step(flying ? IN_THROTTLE | IN_RIGHT : pilot(a.car));
      const c = a.car;
      const sp = Math.hypot(c.vx, c.vz);
      if (!c.grounded) {
        if (air === 0) takeoff = sp;
        air++;
      } else if (air > 0) {
        if (air > 120) {
          watch = 120;
          checked++;
        }
        air = 0;
      }
      if (watch > 0) {
        watch--;
        const cos = (c.vx * Math.sin(c.heading) + c.vz * Math.cos(c.heading)) / Math.max(sp, 1e-6);
        drift = Math.max(drift, Math.acos(Math.min(1, Math.max(-1, cos))));
        slowest = Math.min(slowest, sp / takeoff);
      }
    }
    expect(checked).toBeGreaterThan(0);
    // Moins de 20° de travers à la réception, et au moins 85 % de la vitesse gardée
    expect(drift).toBeLessThan(0.35);
    expect(slowest).toBeGreaterThan(0.85);
    a.dispose();
  });

  it("braquer à fond dans un parapet ne couche pas la voiture sur le côté", () => {
    const world = buildWorld(GRAND_SAUT);
    for (const dir of [IN_RIGHT, IN_LEFT]) {
      for (const from of [120, 240, 300, 480]) {
        const a = new Attempt(world);
        let lowest = 1;
        for (let i = 0; i < 900 && a.status === "running"; i++) {
          a.step(IN_THROTTLE | (i > from ? dir : 0));
          lowest = Math.min(lowest, 1 - 2 * (a.car.qx * a.car.qx + a.car.qz * a.car.qz));
        }
        expect(lowest).toBeGreaterThan(0.8);
        a.dispose();
      }
    }
  });
});
