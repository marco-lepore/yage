import { describe, expect, it } from "vitest";
import {
  coneFactor,
  coneInnerCosine,
  coneMidHalfAngle,
  coneOuterCosine,
} from "./cone.js";

const QUARTER_TURN = Math.PI / 2;

/** The factor a direction `degrees` off a cone's aim gets. */
function factorAt(degrees: number, angle: number, softness: number): number {
  return coneFactor(
    Math.cos((degrees * Math.PI) / 180),
    coneOuterCosine(angle),
    coneInnerCosine(angle, softness),
  );
}

describe("cone cosines", () => {
  it("puts both cosines on the spread's edge without softness", () => {
    expect(coneOuterCosine(QUARTER_TURN)).toBeCloseTo(
      Math.cos(Math.PI / 4),
      12,
    );
    expect(coneInnerCosine(QUARTER_TURN, 0)).toBe(
      coneOuterCosine(QUARTER_TURN),
    );
  });

  it("pulls the full-strength cosine in by the share it is given", () => {
    expect(coneInnerCosine(QUARTER_TURN, 0.5)).toBeCloseTo(
      Math.cos(Math.PI / 8),
      12,
    );
  });
});

describe("coneFactor", () => {
  it("steps from lit to dark at the spread without softness", () => {
    expect(factorAt(44, QUARTER_TURN, 0)).toBe(1);
    expect(factorAt(46, QUARTER_TURN, 0)).toBe(0);
  });

  it("fades across the share of the spread it is given", () => {
    // A quarter turn faded over half of it runs from full at 22.5 degrees to
    // nothing at 45.
    expect(factorAt(20, QUARTER_TURN, 0.5)).toBe(1);
    expect(factorAt(46, QUARTER_TURN, 0.5)).toBe(0);
    const middle = factorAt(34, QUARTER_TURN, 0.5);
    expect(middle).toBeGreaterThan(0.2);
    expect(middle).toBeLessThan(0.8);
  });

  it("never rises as a direction turns away from the aim", () => {
    let previous = 1;
    for (let degrees = 0; degrees <= 60; degrees += 2) {
      const factor = factorAt(degrees, QUARTER_TURN, 0.6);
      expect(factor).toBeLessThanOrEqual(previous + 1e-12);
      previous = factor;
    }
  });
});

describe("coneMidHalfAngle", () => {
  it("is half the spread without softness", () => {
    expect(coneMidHalfAngle(QUARTER_TURN, 0)).toBeCloseTo(Math.PI / 4, 12);
  });

  it("lands where the fade passes one half", () => {
    const angle = QUARTER_TURN;
    const softness = 0.7;
    const half = coneMidHalfAngle(angle, softness);
    expect(
      coneFactor(
        Math.cos(half),
        coneOuterCosine(angle),
        coneInnerCosine(angle, softness),
      ),
    ).toBeCloseTo(0.5, 12);
    expect(half).toBeLessThan(angle / 2);
    expect(half).toBeGreaterThan((angle / 2) * (1 - softness));
  });
});
