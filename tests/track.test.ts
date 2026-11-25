import { describe, expect, it } from "vitest";
import { buildTrack, queryTrack } from "../src/race/track/build";
import { GRAND_SAUT } from "../src/race/track/maps/grandSaut";

describe("piste", () => {
  const track = buildTrack(GRAND_SAUT);

  it("a une longueur cohérente et des checkpoints dans l'ordre", () => {
    expect(track.length).toBeGreaterThan(800);
    expect(track.length).toBeLessThan(1100);
    for (let i = 1; i < track.checkpointDist.length; i++) {
      expect(track.checkpointDist[i]!).toBeGreaterThan(track.checkpointDist[i - 1]!);
    }
  });

  it("contient un trou à sauter", () => {
    expect(Array.from(track.solid).includes(0)).toBe(true);
  });

  it("repère le centre de la piste et le vide à côté", () => {
    const i = 100;
    const onCenter = queryTrack(track, track.px[i]!, track.pz[i]!, track.py[i]!, i);
    expect(onCenter.onSurface).toBe(true);
    expect(Math.abs(onCenter.lateral)).toBeLessThan(0.01);
    // 30 m sur le côté : dans le vide
    const off = queryTrack(track, track.px[i]! + track.tz[i]! * 30, track.pz[i]! - track.tx[i]! * 30, track.py[i]!, i);
    expect(off.onSurface).toBe(false);
    expect(off.lateral).toBeGreaterThan(20);
  });
});
