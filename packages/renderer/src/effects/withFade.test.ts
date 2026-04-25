import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => {
  class MockFilter {
    enabled = true;
    constructor(public label = "filter") {}
  }
  class AlphaFilter extends MockFilter {
    alpha: number;
    constructor(opts?: { alpha?: number }) {
      super("alpha");
      this.alpha = opts?.alpha ?? 1;
    }
  }
  return { Filter: MockFilter, AlphaFilter };
});

import { withFade } from "./withFade.js";
import type { Effect, EffectFactory } from "./Effect.js";
import type { EffectHandle } from "./EffectHandle.js";

interface MockFilterShape {
  enabled: boolean;
  label: string;
}

interface AlphaFilterShape extends MockFilterShape {
  alpha: number;
}

describe("withFade", () => {
  it("returns a chain of [innerFilter, AlphaFilter]", () => {
    const inner: MockFilterShape = { enabled: true, label: "inner" };
    const innerFactory: EffectFactory = () =>
      ({
        filter: inner as never,
        getIntensity: () => 0,
        setIntensity: () => {},
      }) as Effect;

    const wrapped = withFade(innerFactory)();
    expect(Array.isArray(wrapped.filter)).toBe(true);
    const filters = wrapped.filter as unknown as MockFilterShape[];
    expect(filters[0]).toBe(inner);
    expect(filters[1]?.label).toBe("alpha");
  });

  it("setIntensity drives the AlphaFilter alpha (clamped to 0..1)", () => {
    const inner: MockFilterShape = { enabled: true, label: "inner" };
    const innerSet = vi.fn();
    const innerFactory: EffectFactory = () =>
      ({
        filter: inner as never,
        getIntensity: () => 1,
        setIntensity: innerSet,
      }) as Effect;

    const wrapped = withFade(innerFactory)();
    const alpha = (wrapped.filter as unknown as MockFilterShape[])[1] as AlphaFilterShape;
    wrapped.setIntensity(0.5);
    expect(alpha.alpha).toBe(0.5);
    wrapped.setIntensity(2);
    expect(alpha.alpha).toBe(1);
    wrapped.setIntensity(-1);
    expect(alpha.alpha).toBe(0);
    expect(innerSet).not.toHaveBeenCalled();
  });

  it("preserves the inner factory's onAttach / onDetach / buildExtras", () => {
    const onAttach = vi.fn();
    const onDetach = vi.fn();
    const extras = vi.fn(() => ({ trigger: () => {} }));
    const inner: MockFilterShape = { enabled: true, label: "inner" };
    interface H extends EffectHandle {
      trigger: () => void;
    }
    const innerFactory: EffectFactory<H> = () =>
      ({
        filter: inner as never,
        getIntensity: () => 0,
        setIntensity: () => {},
        onAttach,
        onDetach,
        buildExtras: extras,
      }) as Effect<H>;

    const wrapped = withFade(innerFactory)();
    expect(wrapped.onAttach).toBe(onAttach);
    expect(wrapped.onDetach).toBe(onDetach);
    expect(wrapped.buildExtras).toBe(extras);
  });

  it("flattens an inner factory whose filter is already an array", () => {
    const f1: MockFilterShape = { enabled: true, label: "f1" };
    const f2: MockFilterShape = { enabled: true, label: "f2" };
    const innerFactory: EffectFactory = () =>
      ({
        filter: [f1 as never, f2 as never],
        getIntensity: () => 0,
        setIntensity: () => {},
      }) as Effect;

    const wrapped = withFade(innerFactory)();
    const arr = wrapped.filter as unknown as MockFilterShape[];
    expect(arr.map((f) => f.label)).toEqual(["f1", "f2", "alpha"]);
  });
});
