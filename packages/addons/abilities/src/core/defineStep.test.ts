import { describe, expect, it, vi } from "vitest";
import { defineStep } from "./defineStep.js";

describe("defineStep", () => {
  it("builds a point step: kind + at extracted, rest becomes params, hooks attached", () => {
    const hooks = { fire: vi.fn() };
    const beep = defineStep<{ volume: number }>("beep", hooks);
    const step = beep({ at: 0.5, volume: 3 });
    expect(step).toEqual({
      kind: "beep",
      at: 0.5,
      params: { volume: 3 },
      hooks,
    });
  });

  it("builds a window step: kind + from/to/every extracted, rest becomes params, hooks attached", () => {
    const hooks = { enter: vi.fn(), exit: vi.fn() };
    const zone = defineStep<{ radius: number }>("zone", hooks);
    const step = zone({ from: 0.1, to: 0.4, every: 0.1, radius: 5 });
    expect(step).toEqual({
      kind: "zone",
      from: 0.1,
      to: 0.4,
      every: 0.1,
      params: { radius: 5 },
      hooks,
    });
  });

  it("omits `every` entirely when not passed, rather than setting it to undefined", () => {
    const zone = defineStep<{ radius: number }>("zone", { enter: vi.fn() });
    const step = zone({ from: 0, to: 1, radius: 2 });
    expect("every" in step).toBe(false);
  });

  it("selects the point factory when hooks declares `fire`", () => {
    const beep = defineStep<object>("beep", { fire: vi.fn() });
    const step = beep({ at: 0 });
    expect(step).toHaveProperty("at");
    expect(step).not.toHaveProperty("from");
  });

  it("selects the window factory when hooks has no `fire`", () => {
    const zone = defineStep<object>("zone", { enter: vi.fn() });
    const step = zone({ from: 0, to: 1 });
    expect(step).toHaveProperty("from");
    expect(step).toHaveProperty("to");
    expect(step).not.toHaveProperty("at");
  });

  it("a point factory's arg type rejects from/to at compile time", () => {
    const beep = defineStep<{ x: number }>("beep", { fire: vi.fn() });
    // @ts-expect-error - point step args must not accept `from`/`to`
    beep({ at: 0, x: 1, from: 5 });
  });

  it("a window factory's arg type rejects at at compile time", () => {
    const zone = defineStep<{ x: number }>("zone", { enter: vi.fn() });
    // @ts-expect-error - window step args must not accept `at`
    zone({ from: 0, to: 1, x: 1, at: 5 });
  });
});
