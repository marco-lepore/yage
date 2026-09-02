import { describe, it, expect, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockFilter {
    enabled = true;
    constructor(public label = "filter") {}
  }
  return { mocks: { MockFilter } };
});

vi.mock("pixi.js", () => ({
  Filter: mocks.MockFilter,
}));

import { EFFECT_META, defineEffect, getEffectMeta } from "./defineEffect.js";
import type { EffectHandle } from "./EffectHandle.js";

describe("defineEffect", () => {
  it("returns a named callable that produces a factory", () => {
    interface FooOpts {
      strength: number;
    }
    const foo = defineEffect<EffectHandle, FooOpts>({
      name: "test:foo",
      factory: () => ({
        filter: new mocks.MockFilter() as never,
        getIntensity: () => 0,
        setIntensity: () => {},
      }),
    });
    expect(foo.name).toBe("test:foo");
    const factory = foo({ strength: 2 });
    expect(typeof factory).toBe("function");
  });

  it("tags the built Effect with metadata via the EFFECT_META symbol", () => {
    interface BarOpts {
      x: number;
    }
    const bar = defineEffect<EffectHandle, BarOpts>({
      name: "test:bar",
      factory: () => ({
        filter: new mocks.MockFilter() as never,
        getIntensity: () => 0,
        setIntensity: () => {},
      }),
    });
    const effect = bar({ x: 7 })();
    const meta = getEffectMeta(effect);
    expect(meta).toEqual({ definitionName: "test:bar" });
    // Symbol is non-enumerable — shouldn't show up in spread.
    expect(Object.keys(effect as unknown as object)).not.toContain(
      EFFECT_META as unknown as string,
    );
  });
});
