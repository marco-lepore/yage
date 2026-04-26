import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    filters: unknown = null;
    destroyed = false;
    addChild(c: MockContainer): MockContainer {
      this.children.push(c);
      c.parent = this;
      return c;
    }
    removeChild(c: MockContainer): MockContainer {
      const i = this.children.indexOf(c);
      if (i !== -1) {
        this.children.splice(i, 1);
        c.parent = null;
      }
      return c;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockFilter {
    enabled = true;
    constructor(public label = "filter") {}
  }

  return { mocks: { MockContainer, MockFilter } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Filter: mocks.MockFilter,
  AlphaFilter: class extends mocks.MockFilter {
    alpha: number;
    constructor(opts?: { alpha?: number }) {
      super("alpha");
      this.alpha = opts?.alpha ?? 1;
    }
  },
}));

import type { Process } from "@yagejs/core";
import { EffectStack } from "./EffectStack.js";
import type { Effect, EffectFactory } from "./Effect.js";
import type {
  EffectHandle,
  EffectProcessHost,
} from "./EffectHandle.js";

function makeMockHost(): EffectProcessHost & { runs: Process[]; cancelled: number } {
  const runs: Process[] = [];
  return {
    runs,
    cancelled: 0,
    run(p) {
      runs.push(p);
      return p;
    },
    cancelAll() {
      for (const p of runs) {
        if (!p.completed) p.cancel();
      }
      this.cancelled += runs.length;
      runs.length = 0;
    },
  } as EffectProcessHost & { runs: Process[]; cancelled: number };
}

function makeEffect(
  filterLabel = "f",
): { factory: EffectFactory; effect: Effect; setIntensity: ReturnType<typeof vi.fn> } {
  const filter = new mocks.MockFilter(filterLabel);
  let intensity = 0.5;
  const setIntensity = vi.fn((v: number) => {
    intensity = v;
  });
  const effect: Effect = {
    filter: filter as never,
    getIntensity: () => intensity,
    setIntensity,
  };
  return { factory: () => effect, effect, setIntensity };
}

describe("EffectStack", () => {
  let target: InstanceType<typeof mocks.MockContainer>;
  let host: ReturnType<typeof makeMockHost>;
  let stack: EffectStack;

  beforeEach(() => {
    target = new mocks.MockContainer();
    host = makeMockHost();
    stack = new EffectStack(target as never, host, "component");
  });

  it("assigns the effect's filter onto target.filters on add", () => {
    const { factory, effect } = makeEffect("a");
    stack.add(factory);
    expect(target.filters).toEqual([effect.filter]);
  });

  it("composes multiple filters in array order", () => {
    const a = makeEffect("a");
    const b = makeEffect("b");
    stack.add(a.factory);
    stack.add(b.factory);
    expect(target.filters).toEqual([a.effect.filter, b.effect.filter]);
  });

  it("flattens an effect with a filter array", () => {
    const f1 = new mocks.MockFilter("inner");
    const f2 = new mocks.MockFilter("outer");
    const effect: Effect = {
      filter: [f1 as never, f2 as never],
      getIntensity: () => 1,
      setIntensity: () => {},
    };
    stack.add(() => effect);
    expect(target.filters).toEqual([f1, f2]);
  });

  it("calls onAttach when an effect is added", () => {
    const onAttach = vi.fn();
    stack.add(() => ({
      filter: new mocks.MockFilter() as never,
      getIntensity: () => 0,
      setIntensity: () => {},
      onAttach,
    }));
    expect(onAttach).toHaveBeenCalledWith({
      displayObject: target,
      scope: "component",
    });
  });

  it("removes the effect's filter on handle.remove()", () => {
    const a = makeEffect("a");
    const b = makeEffect("b");
    const handleA = stack.add(a.factory);
    stack.add(b.factory);
    handleA.remove();
    expect(target.filters).toEqual([b.effect.filter]);
  });

  it("clears target.filters when the last effect is removed", () => {
    const handle = stack.add(makeEffect().factory);
    handle.remove();
    expect(target.filters).toBeNull();
  });

  it("calls onDetach exactly once on remove", () => {
    const onDetach = vi.fn();
    const handle = stack.add(() => ({
      filter: new mocks.MockFilter() as never,
      getIntensity: () => 0,
      setIntensity: () => {},
      onDetach,
    }));
    handle.remove();
    handle.remove(); // idempotent
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("setEnabled toggles the underlying filter's enabled flag", () => {
    const a = makeEffect("a");
    const handle = stack.add(a.factory);
    handle.setEnabled(false);
    expect(
      (a.effect.filter as unknown as InstanceType<typeof mocks.MockFilter>)
        .enabled,
    ).toBe(false);
    expect(handle.enabled).toBe(false);
    handle.setEnabled(true);
    expect(handle.enabled).toBe(true);
  });

  it("setEnabled toggles all filters in a multi-filter effect", () => {
    const f1 = new mocks.MockFilter("a");
    const f2 = new mocks.MockFilter("b");
    const handle = stack.add(() => ({
      filter: [f1 as never, f2 as never],
      getIntensity: () => 1,
      setIntensity: () => {},
    }));
    handle.setEnabled(false);
    expect(f1.enabled).toBe(false);
    expect(f2.enabled).toBe(false);
    expect(handle.enabled).toBe(false);
  });

  it("fadeIn enqueues a process via the host", () => {
    const a = makeEffect();
    const handle = stack.add(a.factory);
    handle.fadeIn(100);
    expect(host.runs).toHaveLength(1);
  });

  it("fadeOut tweens setIntensity from current value to 0", () => {
    const a = makeEffect();
    a.effect.setIntensity(0.8);
    const handle = stack.add(a.factory);
    const proc = handle.fadeOut(100);
    proc._update(50); // halfway
    expect(a.setIntensity).toHaveBeenLastCalledWith(0.4);
    proc._update(50); // done
    expect(a.setIntensity).toHaveBeenLastCalledWith(0);
  });

  it("destroy clears all entries, target.filters, and cancels host processes", () => {
    const handle = stack.add(makeEffect().factory);
    const proc = handle.fadeIn(100);
    expect(target.filters).not.toBeNull();
    stack.destroy();
    expect(target.filters).toBeNull();
    expect(stack.size).toBe(0);
    expect(proc.completed).toBe(true); // cancelled by host.cancelAll
  });

  it("destroy invokes onDetach on every entry", () => {
    const detach = vi.fn();
    stack.add(() => ({
      filter: new mocks.MockFilter() as never,
      getIntensity: () => 0,
      setIntensity: () => {},
      onDetach: detach,
    }));
    stack.destroy();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("add after destroy throws", () => {
    stack.destroy();
    expect(() => stack.add(makeEffect().factory)).toThrow(/destroyed/);
  });

  it("buildExtras spreads onto the handle", () => {
    interface RichHandle extends EffectHandle {
      trigger(): void;
      magic: number;
    }
    const trigger = vi.fn();
    const factory: EffectFactory<RichHandle> = () => ({
      filter: new mocks.MockFilter() as never,
      getIntensity: () => 0,
      setIntensity: () => {},
      buildExtras: () => ({ trigger, magic: 42 }),
    });
    const handle = stack.add(factory);
    handle.trigger();
    expect(trigger).toHaveBeenCalledOnce();
    expect(handle.magic).toBe(42);
    // base methods still present
    expect(typeof handle.remove).toBe("function");
    expect(typeof handle.fadeIn).toBe("function");
  });

  it("preserves user-assigned filters through addEffect", () => {
    const userFilter = new mocks.MockFilter("user");
    target.filters = [userFilter];

    const a = makeEffect("a");
    stack.add(a.factory);

    // External filter should appear before stack-owned filter.
    expect(target.filters).toEqual([userFilter, a.effect.filter]);
  });

  it("preserves user-assigned filters through remove()", () => {
    const userFilter = new mocks.MockFilter("user");
    const a = makeEffect("a");
    const handleA = stack.add(a.factory);
    target.filters = [userFilter, ...(target.filters as never[])];

    handleA.remove();
    expect(target.filters).toEqual([userFilter]);
  });

  it("re-adopts stack-owned filters if user re-assigns .filters without them", () => {
    const a = makeEffect("a");
    stack.add(a.factory);
    const userFilter = new mocks.MockFilter("user");

    // User overwrites filters and drops our owned filter entirely.
    target.filters = [userFilter];

    // Triggering another sync (e.g. adding another effect) brings ours back.
    const b = makeEffect("b");
    stack.add(b.factory);
    expect(target.filters).toEqual([userFilter, a.effect.filter, b.effect.filter]);
  });

  it("destroy preserves external filters and strips owned ones", () => {
    const userFilter = new mocks.MockFilter("user");
    const a = makeEffect("a");
    stack.add(a.factory);
    target.filters = [userFilter, ...(target.filters as never[])];

    stack.destroy();
    expect(target.filters).toEqual([userFilter]);
  });

  it("destroy sets filters to null when no external filters remain", () => {
    stack.add(makeEffect().factory);
    stack.destroy();
    expect(target.filters).toBeNull();
  });

  it("handle.remove cancels in-flight fades for that effect", () => {
    const a = makeEffect("a");
    const handle = stack.add(a.factory);
    const fade = handle.fadeOut(200);
    expect(fade.completed).toBe(false);

    handle.remove();
    expect(fade.completed).toBe(true); // cancelled

    // Driving the (cancelled) process should not call setIntensity again.
    a.setIntensity.mockClear();
    fade._update(50);
    expect(a.setIntensity).not.toHaveBeenCalled();
  });

  it("handle.remove leaves fades on other effects untouched", () => {
    const a = makeEffect("a");
    const b = makeEffect("b");
    const handleA = stack.add(a.factory);
    const handleB = stack.add(b.factory);
    const fadeA = handleA.fadeOut(200);
    const fadeB = handleB.fadeOut(200);

    handleA.remove();
    expect(fadeA.completed).toBe(true);
    expect(fadeB.completed).toBe(false);
  });

  it("buildExtras can compose against base methods", () => {
    const factory: EffectFactory<EffectHandle & { teardown(): void }> = () => ({
      filter: new mocks.MockFilter() as never,
      getIntensity: () => 0,
      setIntensity: () => {},
      buildExtras: (base) => ({
        teardown: () => base.remove(),
      }),
    });
    const handle = stack.add(factory);
    expect(stack.size).toBe(1);
    handle.teardown();
    expect(stack.size).toBe(0);
  });
});

describe("EffectStack serialize/restoreFrom", () => {
  let target: InstanceType<typeof mocks.MockContainer>;
  let host: ReturnType<typeof makeMockHost>;
  let stack: EffectStack;

  beforeEach(() => {
    target = new mocks.MockContainer();
    host = makeMockHost();
    stack = new EffectStack(target as never, host, "component");
  });

  it("captures intensity + enabled for defineEffect-built entries", async () => {
    const { defineEffect } = await import("./defineEffect.js");
    interface DemoOptions {
      strength: number;
    }
    const filter = new mocks.MockFilter("demo");
    let intensity = 0;
    const demo = defineEffect<EffectHandle, DemoOptions>({
      name: "test:demo",
      factory: (opts) => ({
        filter: filter as never,
        getIntensity: () => intensity,
        setIntensity: (v) => {
          intensity = v;
        },
        buildExtras: () => ({ _strength: opts.strength }) as never,
      }),
    });
    const handle = stack.add(demo({ strength: 1.5 }));
    handle.setEnabled(false);
    intensity = 0.42;

    const snap = stack.serialize();
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]).toMatchObject({
      name: "test:demo",
      options: { strength: 1.5 },
      intensity: 0.42,
      enabled: false,
    });
  });

  it("skips effects without registry metadata with a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = makeEffect("untagged");
    stack.add(a.factory);
    const snap = stack.serialize();
    expect(snap.entries).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("restoreFrom rebuilds entries via the registered factory", async () => {
    const { defineEffect, _resetEffectRegistry } = await import(
      "./defineEffect.js"
    );
    _resetEffectRegistry();
    interface BarOptions {
      bar: number;
    }
    let lastBuilt: BarOptions | null = null;
    const bar = defineEffect<EffectHandle, BarOptions>({
      name: "test:bar",
      factory: (opts) => {
        lastBuilt = opts;
        let i = 0;
        return {
          filter: new mocks.MockFilter("bar") as never,
          getIntensity: () => i,
          setIntensity: (v) => {
            i = v;
          },
        };
      },
    });
    stack.add(bar({ bar: 7 }));
    const snap = stack.serialize();

    const target2 = new mocks.MockContainer();
    const host2 = makeMockHost();
    const fresh = new EffectStack(target2 as never, host2, "component");
    fresh.restoreFrom(snap);

    expect(lastBuilt).toEqual({ bar: 7 });
    expect(fresh.size).toBe(1);
    // Restored entry can serialize again — meta survives the round-trip.
    const reSnap = fresh.serialize();
    expect(reSnap.entries[0]?.name).toBe("test:bar");
  });

  it("restoreFrom warns and skips entries with unknown names", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stack.restoreFrom({
      entries: [{ name: "test:never-registered", options: {}, intensity: 1, enabled: true }],
    });
    expect(stack.size).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
