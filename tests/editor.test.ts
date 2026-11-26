import { describe, expect, it } from "vitest";
import { exampleMap } from "../src/editor/examples";
import { customMapId, decodeMap, encodeMap } from "../src/race/world/code";
import { findRoute } from "../src/race/world/route";
import { buildWorld, groundAt, validateMap } from "../src/race/world/world";

describe("éditeur et blocs", () => {
  it("la map d'exemple a un chemin complet du départ à l'arrivée", () => {
    const m = exampleMap();
    expect(validateMap(m.blocks)).toBeNull();
    const r = findRoute(m.blocks);
    expect(r).not.toBeNull();
    expect(r!.order.length).toBe(m.blocks.length);
  });

  it("demande un départ et une arrivée", () => {
    expect(validateMap([])).toMatch(/Départ/);
    expect(validateMap([{ kind: "depart", x: 0, z: 0, level: 0, rot: 0 }])).toMatch(/Arrivée/);
  });

  it("deux routes côte à côte perdent le rebord entre elles", () => {
    const w = buildWorld({
      id: "t",
      name: "t",
      medals: { auteur: 1, or: 1, argent: 1, bronze: 1 },
      blocks: [
        { kind: "route", x: 0, z: 0, level: 0, rot: 0 },
        { kind: "route", x: 1, z: 0, level: 0, rot: 0 },
      ],
    });
    // La route en x = 0 a la route voisine à l'est (côté « - ») ; celle en x = 1 l'a à l'ouest (côté « + »)
    expect(w.blocks[0]!.borderNeg).toBe(false);
    expect(w.blocks[0]!.borderPos).toBe(true);
    expect(w.blocks[1]!.borderPos).toBe(false);
  });

  it("le sol choisit la pièce juste sous la voiture quand deux pièces sont empilées", () => {
    const w = buildWorld({
      id: "t",
      name: "t",
      medals: { auteur: 1, or: 1, argent: 1, bronze: 1 },
      blocks: [
        { kind: "plaque", x: 0, z: 0, level: 0, rot: 0 },
        { kind: "plaque", x: 0, z: 0, level: 5, rot: 0 },
      ],
    });
    expect(groundAt(w, 0, 0, 0.1)!.groundY).toBe(0);
    expect(groundAt(w, 0, 0, 10.2)!.groundY).toBe(10);
    expect(groundAt(w, 0, 0, 5)!.groundY).toBe(0);
    expect(groundAt(w, 15, 0, 5)).toBeNull();
  });

  it("le code texte redonne exactement la même map", () => {
    const m = exampleMap();
    m.name = "Évasion à l'école";
    m.authorTime = 31.482;
    m.blocks.push({ kind: "plaque", x: -5, z: 7, level: 40, rot: 3 });
    expect(decodeMap(encodeMap(m))).toEqual(m);
  });

  it("l'identifiant de map ne dépend que des pièces", () => {
    const m = exampleMap();
    const id = customMapId(m.blocks);
    m.name = "autre";
    expect(customMapId(m.blocks)).toBe(id);
  });

  it("refuse un code abîmé ou de l'ancien format", () => {
    expect(() => decodeMap("bonjour")).toThrow();
    expect(() => decodeMap("RL2-Ag")).toThrow();
    expect(() => decodeMap("RL1-AQtNb24")).toThrow(/ancien/);
  });
});
