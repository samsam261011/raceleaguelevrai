import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics } from "../src/race/physics/car";
import { Attempt } from "../src/race/sim/attempt";
import { makeAutopilot } from "../src/race/sim/autopilot";
import { decodeMap, encodeMap } from "../src/race/world/code";
import { OFFICIAL_MAPS } from "../src/race/world/maps";
import { findRoute } from "../src/race/world/route";
import { blockClashes, buildWorld, validateMap } from "../src/race/world/world";

beforeAll(() => initPhysics());

/** Réglages du pilote automatique (regard devant, vitesse visée en virage) qui ont donné le temps auteur de chaque map. */
const PILOT: Record<string, [number, number]> = {
  "le-grand-saut": [22, 38],
  spirale: [22, 48],
  "fil-du-rasoir": [22, 48],
  "double-boucle": [16, 38],
  "la-chute": [16, 999],
  serpentin: [22, 38],
  "pont-casse": [16, 38],
  tremplin: [22, 38],
};

describe("les 8 maps officielles", () => {
  it("sont 8, avec des noms et des identifiants uniques", () => {
    expect(OFFICIAL_MAPS).toHaveLength(8);
    expect(new Set(OFFICIAL_MAPS.map((m) => m.id)).size).toBe(8);
  });

  for (const map of OFFICIAL_MAPS) {
    describe(map.name, () => {
      it("est valide, sans pièces qui se gênent, et son chemin va du départ à l'arrivée", () => {
        expect(validateMap(map.blocks)).toBeNull();
        expect(blockClashes(map.blocks)).toEqual([]);
        const route = findRoute(map.blocks);
        expect(route).not.toBeNull();
        // Tous les checkpoints sont sur le chemin
        const world = buildWorld(map);
        const onRoute = new Set(route!.order);
        for (const g of world.gates) expect(onRoute.has(g.block)).toBe(true);
        expect(world.checkpointCount).toBeGreaterThanOrEqual(2);
      });

      it("se relit à l'identique depuis son code d'éditeur", () => {
        const back = decodeMap(encodeMap({ name: map.name, authorTime: null, blocks: map.blocks }));
        expect(back.blocks).toEqual(map.blocks);
      });

      it("se termine au pilote automatique dans le temps auteur, tous les checkpoints passés", () => {
        const [la, ts] = PILOT[map.id]!;
        const world = buildWorld(map);
        const a = new Attempt(world);
        const pilot = makeAutopilot(findRoute(map.blocks)!, la, ts);
        while (a.status === "running" && a.tick < 120 * 90) a.step(pilot(a.car));
        expect(a.status).toBe("finished");
        expect(a.splits).toHaveLength(world.checkpointCount);
        expect(a.finishTime!).toBeLessThanOrEqual(map.medals.auteur + 0.05);
        expect(map.medals.auteur).toBeLessThan(map.medals.or);
        expect(map.medals.or).toBeLessThan(map.medals.argent);
        expect(map.medals.argent).toBeLessThan(map.medals.bronze);
        a.dispose();
      });
    });
  }
});
