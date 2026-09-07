import { describe, it, expect } from "vitest";
import * as barrel from "./index.js";
import {
  easeLinear,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,
  easeInQuint,
  easeOutQuint,
  easeInOutQuint,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
  easeInCirc,
  easeOutCirc,
  easeInOutCirc,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  easeInElastic,
  easeOutElastic,
  easeInOutElastic,
  easeInBounce,
  easeOutBounce,
  easeInOutBounce,
} from "./easing.js";
import type { EasingFunction } from "./types.js";

/** Every family with an in / out / in-out triple. */
const families: Record<
  string,
  { in: EasingFunction; out: EasingFunction; inOut: EasingFunction }
> = {
  sine: { in: easeInSine, out: easeOutSine, inOut: easeInOutSine },
  quad: { in: easeInQuad, out: easeOutQuad, inOut: easeInOutQuad },
  cubic: { in: easeInCubic, out: easeOutCubic, inOut: easeInOutCubic },
  quart: { in: easeInQuart, out: easeOutQuart, inOut: easeInOutQuart },
  quint: { in: easeInQuint, out: easeOutQuint, inOut: easeInOutQuint },
  expo: { in: easeInExpo, out: easeOutExpo, inOut: easeInOutExpo },
  circ: { in: easeInCirc, out: easeOutCirc, inOut: easeInOutCirc },
  back: { in: easeInBack, out: easeOutBack, inOut: easeInOutBack },
  elastic: {
    in: easeInElastic,
    out: easeOutElastic,
    inOut: easeInOutElastic,
  },
  bounce: { in: easeInBounce, out: easeOutBounce, inOut: easeInOutBounce },
};

/** Every export, by name. */
const all: Record<string, EasingFunction> = { easeLinear };
for (const [family, forms] of Object.entries(families)) {
  const cap = family[0]!.toUpperCase() + family.slice(1);
  all[`easeIn${cap}`] = forms.in;
  all[`easeOut${cap}`] = forms.out;
  all[`easeInOut${cap}`] = forms.inOut;
}

/** Names that leave [0,1] between the endpoints, by design. */
const overshooting = new Set([
  "easeInBack",
  "easeOutBack",
  "easeInOutBack",
  "easeInElastic",
  "easeOutElastic",
  "easeInOutElastic",
]);

const grid = Array.from({ length: 11 }, (_, i) => i / 10);
const sample = (f: EasingFunction) =>
  Array.from({ length: 101 }, (_, i) => f(i / 100));

describe("easing", () => {
  it("the barrel exports exactly 31 easings", () => {
    const names = Object.keys(barrel).filter((k) => k.startsWith("ease"));
    expect(names).toHaveLength(31);
  });

  it.each(Object.entries(all))("%s hits both endpoints", (_name, f) => {
    expect(f(0)).toBeCloseTo(0, 12);
    expect(f(1)).toBeCloseTo(1, 12);
  });

  it("matches the known midpoints", () => {
    const midpoints: Record<string, number> = {
      easeLinear: 0.5,
      easeInSine: 0.2928932188134524,
      easeOutSine: 0.7071067811865475,
      easeInQuad: 0.25,
      easeOutQuad: 0.75,
      easeInCubic: 0.125,
      easeOutCubic: 0.875,
      easeInQuart: 0.0625,
      easeOutQuart: 0.9375,
      easeInQuint: 0.03125,
      easeOutQuint: 0.96875,
      easeInExpo: 0.03125,
      easeOutExpo: 0.96875,
      easeInCirc: 0.1339745962155614,
      easeOutCirc: 0.8660254037844386,
      easeInBack: -0.0876975,
      easeOutBack: 1.0876975,
      easeInElastic: -0.015625,
      easeOutElastic: 1.015625,
      easeInBounce: 0.234375,
      easeOutBounce: 0.765625,
    };
    for (const [name, expected] of Object.entries(midpoints)) {
      expect(all[name]!(0.5), name).toBeCloseTo(expected, 10);
    }
  });

  it.each(Object.keys(families))("easeInOut%s crosses at 0.5", (family) => {
    expect(families[family]!.inOut(0.5)).toBeCloseTo(0.5, 12);
  });

  it.each(Object.keys(families))(
    "%s: easeOut(t) mirrors easeIn(1 - t)",
    (family) => {
      const { in: fin, out } = families[family]!;
      for (const t of grid) expect(out(t)).toBeCloseTo(1 - fin(1 - t), 12);
    },
  );

  it.each(Object.keys(families))(
    "%s: easeInOut is symmetric about (0.5, 0.5)",
    (family) => {
      const { inOut } = families[family]!;
      for (const t of grid) expect(inOut(t) + inOut(1 - t)).toBeCloseTo(1, 12);
    },
  );

  it.each(Object.keys(families))(
    "%s: easeInOut is continuous across the midpoint",
    (family) => {
      // 5e-3 rather than something tighter because easeInOutCirc's slope at
      // the midpoint is unbounded — the arc is vertical there, so a 2e-6 window
      // spans 2e-3. A mistyped second branch jumps by far more than this.
      const { inOut } = families[family]!;
      expect(Math.abs(inOut(0.5 - 1e-6) - inOut(0.5 + 1e-6))).toBeLessThan(
        5e-3,
      );
    },
  );

  it.each(Object.entries(all).filter(([name]) => !overshooting.has(name)))(
    "%s stays within [0,1]",
    (_name, f) => {
      for (const v of sample(f)) {
        expect(v).toBeGreaterThanOrEqual(-1e-12);
        expect(v).toBeLessThanOrEqual(1 + 1e-12);
      }
    },
  );

  it("overshoots by the documented amount where it should", () => {
    const max = (f: EasingFunction) => Math.max(...sample(f));
    const min = (f: EasingFunction) => Math.min(...sample(f));

    expect(max(easeOutBack)).toBeGreaterThan(1.09);
    expect(max(easeOutBack)).toBeLessThan(1.11);
    expect(min(easeInBack)).toBeLessThan(-0.09);
    expect(min(easeInBack)).toBeGreaterThan(-0.11);

    expect(max(easeOutElastic)).toBeGreaterThan(1.37);
    expect(max(easeOutElastic)).toBeLessThan(1.38);
    expect(min(easeInElastic)).toBeLessThan(-0.37);
    expect(min(easeInElastic)).toBeGreaterThan(-0.38);

    expect(max(easeInOutBack)).toBeGreaterThan(1);
    expect(min(easeInOutBack)).toBeLessThan(0);
    expect(max(easeInOutElastic)).toBeGreaterThan(1);
    expect(min(easeInOutElastic)).toBeLessThan(0);
  });

  it("returns exact endpoints for expo and elastic", () => {
    // The formulas are branchless everywhere else; without these cases they
    // return 0.0009765625 and 0.9990234375 at the endpoints.
    for (const f of [
      easeInExpo,
      easeOutExpo,
      easeInOutExpo,
      easeInElastic,
      easeOutElastic,
      easeInOutElastic,
    ]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
    }
  });

  it.each(["sine", "quad", "cubic", "quart", "quint", "expo", "circ"])(
    "%s rises monotonically",
    (family) => {
      // back, elastic and bounce are excluded: they overshoot or bounce back
      // by design.
      const { in: fin, out, inOut } = families[family]!;
      for (const f of [fin, out, inOut]) {
        let previous = -Infinity;
        for (const v of sample(f)) {
          expect(v).toBeGreaterThanOrEqual(previous - 1e-12);
          previous = v;
        }
      }
    },
  );

  it("easeOutBounce covers all four branches", () => {
    expect(easeOutBounce(0.2)).toBeCloseTo(0.30250000000000005, 10);
    expect(easeOutBounce(0.5)).toBeCloseTo(0.765625, 10);
    expect(easeOutBounce(0.8)).toBeCloseTo(0.94, 10);
    expect(easeOutBounce(0.97)).toBeCloseTo(0.98618125, 10);
  });

  it("is re-exported in full from the package barrel", () => {
    for (const name of Object.keys(all)) {
      expect(typeof (barrel as Record<string, unknown>)[name], name).toBe(
        "function",
      );
    }
  });
});
