import { describe, expect, it } from "vitest";
import { formatDelta, formatTime, medalFor, Session } from "../src/race/session/session";

const medals = { auteur: 20, or: 21, argent: 23, bronze: 26 };

describe("série de 10 tentatives", () => {
  it("compte les tentatives et garde le meilleur temps", () => {
    const s = new Session();
    expect(s.current).toBe(1);
    expect(s.record({ time: 24.5, splits: [], inputs: [] }).isBest).toBe(true);
    expect(s.record({ time: null, splits: [], inputs: [] }).isBest).toBe(false);
    const r = s.record({ time: 22.1, splits: [], inputs: [] });
    expect(r.isBest).toBe(true);
    expect(r.previousBest).toBe(24.5);
    expect(s.bestTime).toBe(22.1);
    expect(s.used).toBe(3);
    expect(s.remaining).toBe(7);
  });

  it("s'arrête après 10 tentatives", () => {
    const s = new Session();
    for (let i = 0; i < 10; i++) s.record({ time: 30 - i, splits: [], inputs: [] });
    expect(s.done).toBe(true);
    expect(() => s.record({ time: 1, splits: [], inputs: [] })).toThrow();
    expect(s.bestTime).toBe(21);
  });

  it("en solo, les essais sont illimités", () => {
    const s = new Session(Infinity);
    for (let i = 0; i < 50; i++) s.record({ time: 60 - i, splits: [], inputs: [] });
    expect(s.done).toBe(false);
    expect(s.current).toBe(51);
    expect(s.bestTime).toBe(11);
  });

  it("donne la bonne médaille", () => {
    expect(medalFor(19.9, medals)).toBe("auteur");
    expect(medalFor(20.5, medals)).toBe("or");
    expect(medalFor(22, medals)).toBe("argent");
    expect(medalFor(25, medals)).toBe("bronze");
    expect(medalFor(40, medals)).toBe(null);
    expect(medalFor(null, medals)).toBe(null);
  });

  it("affiche les temps à la milliseconde", () => {
    expect(formatTime(34.218)).toBe("0:34,218");
    expect(formatTime(61.005)).toBe("1:01,005");
    expect(formatTime(null)).toBe("--:--,---");
    expect(formatDelta(-0.084)).toBe("-0,084");
    expect(formatDelta(1.2)).toBe("+1,200");
  });
});
