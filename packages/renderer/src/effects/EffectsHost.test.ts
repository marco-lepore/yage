import { describe, it, expect, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    filters: unknown = null;
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

import type { Process, ScopedProcessQueue } from "@yagejs/core";
import { EffectsHost } from "./EffectsHost.js";
import type { Effect, EffectFactory } from "./Effect.js";

function makeMockQueue(): ScopedProcessQueue {
  const runs: Process[] = [];
  return {
    run(p) {
      runs.push(p);
      return p;
    },
    cancelAll() {
      for (const p of runs) {
        if (!p.completed) p.cancel();
      }
      runs.length = 0;
    },
  };
}

function makeEffect(label = "f"): EffectFactory {
  const filter = new mocks.MockFilter(label);
  let intensity = 1;
  const effect: Effect = {
    filter: filter as never,
    getIntensity: () => intensity,
    setIntensity: (v) => {
      intensity = v;
    },
  };
  return () => effect;
}

describe("EffectsHost", () => {
  it("does NOT allocate the underlying EffectStack until first use", () => {
    const target = new mocks.MockContainer();
    const host = new EffectsHost(
      () => target as never,
      "component",
      () => makeMockQueue(),
    );
    expect(host.size).toBe(0);
    // No effect attached yet ⇒ no filters on the container.
    expect(target.filters).toBeNull();
  });

  it("addEffect lazily creates the stack and pushes the filter", () => {
    const target = new mocks.MockContainer();
    const host = new EffectsHost(
      () => target as never,
      "component",
      () => makeMockQueue(),
    );
    host.addEffect(makeEffect("a"));
    expect(host.size).toBe(1);
    expect((target.filters as unknown[]).length).toBe(1);
  });

  it("throws a clear error when addEffect is called without a queue factory", () => {
    const target = new mocks.MockContainer();
    const host = new EffectsHost(() => target as never, "scene", undefined);
    expect(() => host.addEffect(makeEffect())).toThrow(
      /no queue factory wired/,
    );
  });

  it("destroy tears down the stack and resets size to 0", () => {
    const target = new mocks.MockContainer();
    const host = new EffectsHost(
      () => target as never,
      "component",
      () => makeMockQueue(),
    );
    host.addEffect(makeEffect("a"));
    expect(host.size).toBe(1);
    host.destroy();
    expect(host.size).toBe(0);
    expect(target.filters).toBeNull();
  });

  it("serialize returns undefined when no effects are attached", () => {
    const host = new EffectsHost(
      () => new mocks.MockContainer() as never,
      "component",
      () => makeMockQueue(),
    );
    expect(host.serialize()).toBeUndefined();
  });
});
