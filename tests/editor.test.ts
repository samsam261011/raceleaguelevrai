import { describe, expect, it } from "vitest";
import { decodeMap, encodeMap } from "../src/editor/code";
import { exampleMap } from "../src/editor/examples";
import { walk, type EditorMap } from "../src/editor/layout";
import { Attempt } from "../src/race/sim/attempt";
import { autopilot } from "../src/race/sim/autopilot";
import { buildTrack } from "../src/race/track/build";

function drive(map: EditorMap) {
  const r = walk(map);
  if (!r.ok) throw new Error(r.error);
  const track = buildTrack(r.def);
  const a = new Attempt(track);
  while (a.status === "running" && a.tick < 120 * 120) a.step(autopilot(a.car, track));
  return { status: a.status, time: a.finishTime, track, def: r.def };
}

describe("éditeur de circuits", () => {
  it("la map d'exemple forme un circuit complet du départ à l'arrivée", () => {
    const r = walk(exampleMap());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.length).toBe(exampleMap().tiles.length);
    expect(r.def.checkpoints.length).toBe(1);
    expect(r.def.points.some((p) => p.gap)).toBe(true);
  });

  it("la map d'exemple se termine au pilote automatique (tremplin compris)", () => {
    const res = drive(exampleMap());
    expect(res.status).toBe("finished");
  });

  it("signale l'endroit où le circuit s'arrête", () => {
    const m = exampleMap();
    m.tiles = m.tiles.filter((t) => !(t.x === 0 && t.z === 6));
    const r = walk(m);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/s'arrête/);
    expect(r.at).toMatchObject({ x: 0, z: 5 });
  });

  it("demande un départ et une arrivée", () => {
    expect(walk({ name: "x", authorTime: null, tiles: [] }).ok).toBe(false);
  });

  it("le code texte redonne exactement la même map", () => {
    const m = exampleMap();
    m.name = "Évasion à l'école";
    m.authorTime = 31.482;
    const back = decodeMap(encodeMap(m));
    expect(back).toEqual(m);
  });

  it("refuse un code abîmé", () => {
    expect(() => decodeMap("bonjour")).toThrow();
    expect(() => decodeMap("RL1-AQ")).toThrow();
  });
});
