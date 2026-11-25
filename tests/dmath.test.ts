import { describe, expect, it } from "vitest";
import { dcos, dsin, wrapAngle } from "../src/race/math/dmath";

describe("maths déterministes", () => {
  it("dsin et dcos collent à Math.sin et Math.cos", () => {
    for (let a = -20; a <= 20; a += 0.0137) {
      expect(Math.abs(dsin(a) - Math.sin(a))).toBeLessThan(1e-9);
      expect(Math.abs(dcos(a) - Math.cos(a))).toBeLessThan(1e-9);
    }
  });

  it("wrapAngle ramène dans [-PI, PI]", () => {
    for (let a = -50; a <= 50; a += 0.31) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI - 1e-12);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
      expect(Math.abs(Math.sin(w) - Math.sin(a))).toBeLessThan(1e-9);
    }
  });
});
