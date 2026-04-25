import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pixi.js", () => {
  class MockFilter {
    enabled = true;
    constructor(public label = "filter") {}
  }
  return { Filter: MockFilter };
});

import { rawFilter, _resetRawFilterWarning } from "./rawFilter.js";

interface MockFilterShape {
  enabled: boolean;
  label: string;
}

describe("rawFilter", () => {
  beforeEach(() => {
    _resetRawFilterWarning();
  });

  it("returns an effect whose filter is the supplied pixi filter", () => {
    const f: MockFilterShape = { enabled: true, label: "user" };
    const effect = rawFilter(f as never)();
    expect(effect.filter).toBe(f);
  });

  it("getIntensity returns 1 when no intensity option supplied", () => {
    const f: MockFilterShape = { enabled: true, label: "user" };
    const effect = rawFilter(f as never)();
    expect(effect.getIntensity()).toBe(1);
  });

  it("setIntensity is a no-op without an intensity option, warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f: MockFilterShape = { enabled: true, label: "user" };
    const effect = rawFilter(f as never)();

    effect.setIntensity(0.5);
    effect.setIntensity(0.2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/no-op/);
    warn.mockRestore();
  });

  it("setIntensity drives the supplied accessor when provided", () => {
    const f: MockFilterShape = { enabled: true, label: "user" };
    let value = 0.5;
    const effect = rawFilter(f as never, {
      intensity: {
        get: () => value,
        set: (v) => {
          value = v;
        },
      },
    })();
    effect.setIntensity(0.9);
    expect(value).toBe(0.9);
    expect(effect.getIntensity()).toBe(0.9);
  });

  it("does not warn when an intensity option is supplied", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f: MockFilterShape = { enabled: true, label: "user" };
    const effect = rawFilter(f as never, {
      intensity: { get: () => 0, set: () => {} },
    })();
    effect.setIntensity(0.5);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
