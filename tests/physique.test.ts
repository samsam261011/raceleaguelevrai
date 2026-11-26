import { beforeAll, describe, expect, it } from "vitest";
import { CarSim, initPhysics, type CarState } from "../src/race/physics/car";
import * as C from "../src/race/physics/constants";
import { IN_BRAKE, IN_LEFT, IN_RIGHT, IN_THROTTLE } from "../src/race/physics/input";
import { Attempt } from "../src/race/sim/attempt";
import { makeAutopilot } from "../src/race/sim/autopilot";
import { GRAND_SAUT } from "../src/race/world/maps/grandSaut";
import { LABO } from "../src/race/world/maps/labo";
import { LOOP_R } from "../src/race/world/pieces";
import { findRoute } from "../src/race/world/route";
import { buildWorld, type Block, type CompiledBlock, type World } from "../src/race/world/world";

/**
 * Scène de test physique : chaque comportement de la voiture, mesuré.
 * Repos, suspensions indépendantes, virage serré, haute vitesse, saut et réception,
 * virage relevé, looping, mur roulable, collisions.
 */
beforeAll(() => initPhysics());

const flat = () => {
  const blocks: Block[] = [{ kind: "depart", x: 0, z: -20, level: 0, rot: 0 }, { kind: "arrivee", x: 30, z: 30, level: 0, rot: 0 }];
  for (let x = -20; x <= 20; x++) for (let z = -19; z <= 20; z++) blocks.push({ kind: "plaque", x, z, level: 0, rot: 0 });
  return buildWorld({ id: "e", name: "e", medals: GRAND_SAUT.medals, blocks });
};
const labo = buildWorld(LABO);
/** Pilote du labo : suit la ligne centrale en 3D, à partir de n'importe quel point du parcours. */
const laboPilot = () => makeAutopilot(findRoute(LABO.blocks)!);

/** Axes de la voiture : haut et gauche. */
const up = (c: CarState) => [2 * (c.qx * c.qy - c.qw * c.qz), 1 - 2 * (c.qx * c.qx + c.qz * c.qz), 2 * (c.qy * c.qz + c.qw * c.qx)] as const;
const left = (c: CarState) => [1 - 2 * (c.qy * c.qy + c.qz * c.qz), 2 * (c.qx * c.qy + c.qw * c.qz), 2 * (c.qx * c.qz - c.qw * c.qy)] as const;
/** Roulis par rapport à la surface de normale n : hauteur prise par l'axe gauche-droite. */
const rollTo = (c: CarState, n: readonly number[]) => {
  const l = left(c);
  return Math.abs(l[0] * n[0]! + l[1] * n[1]! + l[2] * n[2]!);
};
const heading = (h: number) => ({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) });
const blockOf = (w: World, kind: string) => w.blocks.find((b) => b.def.kind === kind)!;
/** Pose la voiture à `back` mètres avant l'entrée d'une pièce, lancée à `speed` dans l'axe. */
function launchBefore(sim: CarSim, cb: CompiledBlock, back: number, speed: number) {
  const dx = cb.px[1]! - cb.px[0]!;
  const dz = cb.pz[1]! - cb.pz[0]!;
  const L = Math.hypot(dx, dz);
  const h = Math.atan2(dx / L, dz / L);
  sim.teleport(cb.px[0]! - (dx / L) * back, cb.py[0]! + 0.02, cb.pz[0]! - (dz / L) * back, heading(h), { x: (dx / L) * speed, y: 0, z: (dz / L) * speed });
}

describe("labo physique : la voiture", () => {
  it("au repos : posée sur ses quatre suspensions, à la bonne hauteur, sans vibration", () => {
    const sim = new CarSim(flat());
    let s = sim.state;
    for (let i = 0; i < 120; i++) s = sim.step(0);
    // Vibration mesurée sur la position (la vitesse lue entre deux pas contient la gravité du pas)
    let maxDy = 0;
    for (let i = 0; i < 120; i++) {
      const y0 = s.y;
      s = sim.step(0);
      maxDy = Math.max(maxDy, Math.abs(s.y - y0));
    }
    expect(s.wheels.every((w) => w.contact)).toBe(true);
    for (const w of s.wheels) expect(Math.abs(w.drop - (C.SUSPENSION_REST - C.SUSPENSION_SAG))).toBeLessThan(0.03);
    expect(maxDy).toBeLessThan(0.0005);
    sim.dispose();
  });

  it("les quatre suspensions sont indépendantes : une bosse sous les roues gauches n'enfonce qu'elles", () => {
    const sim = new CarSim(flat());
    // Bosse de 12 cm sous la trace des roues gauches (+x), devant la voiture
    sim.addBox(1.0, 0.06 - 0.5, 0, 0.5, 0.5, 0.6);
    sim.teleport(0, 0.02, -15, heading(0), { x: 0, y: 0, z: 8 });
    let maxDiff = 0;
    let worstRoll = 0;
    for (let i = 0; i < 300; i++) {
      const s = sim.step(0);
      const front = s.wheels[1]!.drop - s.wheels[0]!.drop;
      const rear = s.wheels[3]!.drop - s.wheels[2]!.drop;
      maxDiff = Math.max(maxDiff, front, rear);
      worstRoll = Math.max(worstRoll, rollTo(s, [0, 1, 0]));
    }
    // La roue gauche s'enfonce nettement plus que la droite au passage de la bosse
    expect(maxDiff).toBeGreaterThan(0.05);
    expect(worstRoll).toBeLessThan(0.08);
    sim.dispose();
  });

  it("virage serré à fond : la voiture tourne sans décoller une roue ni rouler sur le flanc", () => {
    const sim = new CarSim(flat());
    let s = sim.state;
    for (let i = 0; i < 240; i++) s = sim.step(IN_THROTTLE);
    let worstRoll = 0;
    let lifted = 0;
    const h0 = s.heading;
    for (let i = 0; i < 360; i++) {
      s = sim.step(IN_THROTTLE | IN_RIGHT);
      if (i > 60) {
        worstRoll = Math.max(worstRoll, rollTo(s, [0, 1, 0]));
        if (!s.wheels.every((w) => w.contact)) lifted++;
      }
    }
    expect(Math.abs(s.heading - h0)).toBeGreaterThan(1);
    expect(worstRoll).toBeLessThan(0.06);
    expect(lifted).toBe(0);
    sim.dispose();
  });

  it("à pleine vitesse en ligne droite : stable, sans vibration", () => {
    const sim = new CarSim(flat());
    sim.teleport(0, 0.02, -380, heading(0), { x: 0, y: 0, z: 55 });
    let maxDy = 0;
    let s = sim.state;
    for (let i = 0; i < 600; i++) {
      const y0 = s.y;
      s = sim.step(IN_THROTTLE);
      if (i > 60) maxDy = Math.max(maxDy, Math.abs(s.y - y0));
    }
    expect(s.speed).toBeGreaterThan(50);
    // Moins de 2 mm de mouvement vertical par pas, à 200 km/h
    expect(maxDy).toBeLessThan(0.002);
    sim.dispose();
  });

  it("saut et réception : long vol, réception sur les quatre roues sans rebond, sans talonner", () => {
    const world = buildWorld(GRAND_SAUT);
    const pilot = makeAutopilot(findRoute(GRAND_SAUT.blocks)!);
    const a = new Attempt(world);
    let air = 0;
    let longest = 0;
    let landedAt = -1;
    let rebounds = 0;
    let minLen = Infinity;
    let dive = 0;
    let peakNose = -1;
    while (a.status === "running" && a.tick < 120 * 60) {
      a.step(pilot(a.car));
      const c = a.car;
      if (!c.grounded) {
        air++;
        const nose = 2 * (c.qy * c.qz - c.qw * c.qx);
        peakNose = Math.max(peakNose, nose);
        dive = Math.max(dive, peakNose - nose);
      } else {
        if (air > 60 && longest < air) {
          longest = air;
          landedAt = a.tick;
        }
        air = 0;
        peakNose = -1;
      }
      if (landedAt > 0 && a.tick > landedAt && a.tick < landedAt + 120) {
        // Un rebond, c'est repartir en l'air dans la demi-seconde qui suit la réception (après, c'est la bosse suivante)
        if (!c.grounded && a.tick < landedAt + 60) rebounds++;
        for (const w of c.wheels) if (w.contact) minLen = Math.min(minLen, w.drop);
      }
    }
    expect(a.status).toBe("finished");
    expect(longest / 120).toBeGreaterThan(1.5);
    expect(rebounds).toBe(0);
    expect(minLen).toBeGreaterThan(0.02);
    // Le nez ne plonge pas en l'air
    expect(dive).toBeLessThan(0.05);
    a.dispose();
  });

  it("freiner en l'air arrête les rotations sans ralentir la voiture", () => {
    const sim = new CarSim(flat());
    sim.teleport(0, 30, 0, heading(0), { x: 0, y: 0, z: 30 });
    // Une rotation parasite au départ
    for (let i = 0; i < 20; i++) sim.step(IN_RIGHT);
    let s = sim.state;
    const v0 = Math.hypot(s.vx, s.vz);
    for (let i = 0; i < 90; i++) s = sim.step(IN_BRAKE);
    // On mesure la rotation résiduelle par l'écart d'orientation sur un pas
    const a = s;
    const b = sim.step(IN_BRAKE);
    const dq = Math.abs(a.qx - b.qx) + Math.abs(a.qy - b.qy) + Math.abs(a.qz - b.qz);
    expect(dq).toBeLessThan(0.0005);
    expect(Math.abs(Math.hypot(b.vx, b.vz) - v0)).toBeLessThan(0.5);
    sim.dispose();
  });

  it("virage relevé : la voiture suit l'inclinaison, roues au sol, à bonne vitesse", () => {
    const sim = new CarSim(labo);
    const cb = blockOf(labo, "virageReleve");
    launchBefore(sim, cb, 25, 30);
    let s = sim.state;
    let maxTilt = 0;
    let lostAll = 0;
    const pilot = laboPilot();
    for (let i = 0; i < 420; i++) {
      s = sim.step(pilot(s));
      const u = up(s);
      maxTilt = Math.max(maxTilt, 1 - u[1]);
      if (s.wheels.every((w) => !w.contact)) lostAll++;
    }
    // Elle s'est penchée avec la piste (au moins 15°), sans jamais quitter la surface
    expect(maxTilt).toBeGreaterThan(1 - Math.cos((15 * Math.PI) / 180));
    expect(lostAll).toBe(0);
    expect(s.x).toBeGreaterThan(cb.px[cb.px.length - 1]! - 5);
    sim.dispose();
  });

  it("looping : la voiture fait le tour, roues collées en haut, et ressort à l'endroit", () => {
    const sim = new CarSim(labo);
    const cb = blockOf(labo, "looping");
    launchBefore(sim, cb, 20, 38);
    let s = sim.state;
    let topContact = false;
    let maxY = 0;
    const pilot = laboPilot();
    const end = cb.px[cb.px.length - 1]!;
    for (let i = 0; i < 720 && !s.fell && s.x < end + 5; i++) {
      s = sim.step(pilot(s) | IN_THROTTLE);
      maxY = Math.max(maxY, s.y);
      if (s.y > 2 * LOOP_R - 3 && up(s)[1] < -0.8 && s.wheels.some((w) => w.contact)) topContact = true;
    }
    expect(s.fell).toBe(false);
    expect(maxY).toBeGreaterThan(2 * LOOP_R - 3);
    expect(topContact).toBe(true);
    // Sortie : au-delà du looping, à l'endroit, sur ses roues
    expect(s.x).toBeGreaterThan(end);
    expect(up(s)[1]).toBeGreaterThan(0.95);
    sim.dispose();
  });

  it("mur roulable : la voiture monte sur le mur à plus de 60°, roues au contact, puis redescend à l'endroit", () => {
    const sim = new CarSim(labo);
    const cb = blockOf(labo, "mur");
    const x0 = cb.px[0]!;
    const x1 = cb.px[cb.px.length - 1]!;
    const h = Math.PI / 2;
    // Arrivée à 34 m/s, à 6 m du centre côté mur (le mur se dresse à droite, vers +z)
    sim.teleport(x0 - 15, 0.02, cb.pz[0]! + 6, heading(h), { x: 34, y: 0, z: 0 });
    let s = sim.state;
    let riding = 0;
    for (let i = 0; i < 300 && !s.fell; i++) {
      const u = (s.x - x0) / (x1 - x0);
      let bits = IN_THROTTLE;
      if (u > 0 && u < 0.5) {
        // Sur la route : on prend le mur avec un angle de 20° ; sur le mur, la droite fait monter
        if (up(s)[1] > 0.85 && s.y < 1) bits |= s.heading > h - 0.35 ? IN_RIGHT : s.heading < h - 0.4 ? IN_LEFT : 0;
        else bits |= s.vy < 2 * (4 - s.y) ? IN_RIGHT : IN_LEFT;
      } else if (u > 0) {
        // On redescend, puis on se remet dans l'axe
        bits |= up(s)[1] < 0.95 ? IN_LEFT : s.heading < h - 0.03 ? IN_LEFT : s.heading > h + 0.03 ? IN_RIGHT : 0;
      }
      s = sim.step(bits);
      if (up(s)[1] < 0.5 && s.wheels.filter((w) => w.contact).length >= 3) riding++;
    }
    expect(s.fell).toBe(false);
    // Plus d'un quart de seconde penchée à plus de 60°, au moins trois roues sur la paroi
    expect(riding).toBeGreaterThan(30);
    expect(s.x).toBeGreaterThan(x1);
    expect(up(s)[1]).toBeGreaterThan(0.95);
    sim.dispose();
  });

  it("collision : foncer dans un pylône arrête la voiture, sans la traverser", () => {
    const sim = new CarSim(flat());
    sim.addBox(0, 2, 20, 1.2, 2, 1.2);
    sim.teleport(0, 0.02, 0, heading(0), { x: 0, y: 0, z: 30 });
    let s = sim.state;
    for (let i = 0; i < 240; i++) s = sim.step(IN_THROTTLE);
    expect(s.z).toBeLessThan(20);
    sim.dispose();
  });

  it("le labo complet se termine au pilote automatique", () => {
    const pilot = makeAutopilot(findRoute(LABO.blocks)!);
    const a = new Attempt(labo);
    while (a.status === "running" && a.tick < 120 * 90) a.step(pilot(a.car));
    expect(a.status).toBe("finished");
    a.dispose();
  });
});
