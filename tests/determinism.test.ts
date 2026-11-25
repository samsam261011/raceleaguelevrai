import { describe, expect, it } from "vitest";
import { buildTrack } from "../src/race/track/build";
import { GRAND_SAUT } from "../src/race/track/maps/grandSaut";
import { Attempt, replayAttempt } from "../src/race/sim/attempt";
import { autopilot } from "../src/race/sim/autopilot";
import { decodeInputs, encodeInputs, fromBase64, toBase64 } from "../src/race/replay/codec";
import { IN_LEFT, IN_RIGHT, IN_THROTTLE } from "../src/race/physics/input";

function drive(lookahead = 16, turnSpeed = 36) {
  const track = buildTrack(GRAND_SAUT);
  const a = new Attempt(track);
  while (a.status === "running" && a.tick < 120 * 90) a.step(autopilot(a.car, track, lookahead, turnSpeed));
  return a;
}

describe("physique déterministe", () => {
  it("la map est faisable de bout en bout", () => {
    const a = drive();
    expect(a.status).toBe("finished");
    expect(a.splits).toHaveLength(3);
    expect(a.finishTime!).toBeGreaterThan(15);
    expect(a.finishTime!).toBeLessThan(GRAND_SAUT.medals.argent);
  });

  it("deux runs avec les mêmes entrées donnent exactement le même résultat", () => {
    const a = drive();
    const b = drive();
    expect(b.car).toEqual(a.car);
    expect(b.finishTime).toBe(a.finishTime);
  });

  it("rejouer les entrées enregistrées redonne le même temps (fantôme, anti-triche)", () => {
    const a = drive(20, 40);
    const replay = replayAttempt(buildTrack(GRAND_SAUT), a.inputs);
    expect(replay.status).toBe("finished");
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
    const track = buildTrack(GRAND_SAUT);
    const a = new Attempt(track);
    let touched = false;
    let maxSpeed = 0;
    while (a.tick < 120 * 10) {
      a.step(IN_THROTTLE);
      const speed = Math.hypot(a.car.vx, a.car.vz);
      maxSpeed = Math.max(maxSpeed, speed);
      if (a.car.onWall) touched = true;
    }
    expect(a.status).toBe("running");
    expect(touched).toBe(true);
    expect(Math.hypot(a.car.vx, a.car.vz)).toBeLessThan(maxSpeed * 0.5);
  });

  it("la voiture ne sort jamais de la piste à cause des rebords", () => {
    const track = buildTrack(GRAND_SAUT);
    const a = new Attempt(track);
    // Zigzag brutal : gauche, droite, gauche...
    while (a.status === "running" && a.tick < 120 * 20) a.step(IN_THROTTLE | (Math.floor(a.tick / 90) % 2 ? IN_LEFT : IN_RIGHT));
    expect(a.status).not.toBe("fell");
  });
});
