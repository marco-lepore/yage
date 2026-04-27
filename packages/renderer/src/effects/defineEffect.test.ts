import { describe, it, expect, vi, beforeEach } from "vitest";

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

import {
  EFFECT_META,
  defineEffect,
  getEffectMeta,
  getRegisteredEffect,
  _resetEffectRegistry,
} from "./defineEffect.js";
import type { Effect } from "./Effect.js";
import type { EffectHandle } from "./EffectHandle.js";

describe("defineEffect", () => {
  beforeEach(() => {
    _resetEffectRegistry();
  });

  it("registers and returns a callable that produces a factory", () => {
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
    expect(meta).toEqual({ definitionName: "test:bar", options: { x: 7 } });
    // Symbol is non-enumerable — shouldn't show up in spread.
    expect(Object.keys(effect as unknown as object)).not.toContain(
      EFFECT_META as unknown as string,
    );
  });

  it("getRegisteredEffect resolves by name", () => {
    const baz = defineEffect<EffectHandle, { v: number }>({
      name: "test:baz",
      factory: (opts) => ({
        filter: new mocks.MockFilter() as never,
        getIntensity: () => opts.v,
        setIntensity: () => {},
      }),
    });
    void baz; // registry hold via side-effect of defineEffect.
    const reg = getRegisteredEffect("test:baz");
    expect(reg).toBeDefined();
    const built = reg?.factory({ v: 3 }) as Effect<EffectHandle>;
    expect(built.getIntensity()).toBe(3);
  });

  it("re-registering the same name warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    defineEffect<EffectHandle, undefined>({
      name: "test:dup",
      factory: () => ({
        filter: new mocks.MockFilter() as never,
        getIntensity: () => 0,
        setIntensity: () => {},
      }),
    });
    defineEffect<EffectHandle, undefined>({
      name: "test:dup",
      factory: () => ({
        filter: new mocks.MockFilter() as never,
        getIntensity: () => 0,
        setIntensity: () => {},
      }),
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
