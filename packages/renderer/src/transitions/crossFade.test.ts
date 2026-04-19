import { describe, it, expect } from "vitest";
import type {
  Scene,
  SceneTransitionContext,
  SceneTransitionKind,
} from "@yagejs/core";
import { crossFade } from "./crossFade.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";

function makeCtx(opts: {
  elapsed: number;
  kind: SceneTransitionKind;
  fromScene?: Scene;
  toScene?: Scene;
  fromContainer?: { alpha: number };
  toContainer?: { alpha: number };
}): SceneTransitionContext {
  return {
    elapsed: opts.elapsed,
    kind: opts.kind,
    fromScene: opts.fromScene,
    toScene: opts.toScene,
    engineContext: {
      resolve: (key: unknown) => {
        if (key === SceneRenderTreeProviderKey) {
          return {
            getTree: (s: Scene) => {
              if (s === opts.fromScene && opts.fromContainer) {
                return { root: opts.fromContainer };
              }
              if (s === opts.toScene && opts.toContainer) {
                return { root: opts.toContainer };
              }
              return undefined;
            },
          };
        }
        return undefined;
      },
    },
  } as unknown as SceneTransitionContext;
}

describe("crossFade", () => {
  it("defaults to 400ms duration", () => {
    expect(crossFade().duration).toBe(400);
  });

  it("accepts custom duration", () => {
    expect(crossFade({ duration: 250 }).duration).toBe(250);
  });

  it("ramps fromScene alpha 1→0 and toScene alpha 0→1", () => {
    const t = crossFade({ duration: 100 });
    const fromContainer = { alpha: 1 };
    const toContainer = { alpha: 1 };
    const fromScene = { name: "from" } as Scene;
    const toScene = { name: "to" } as Scene;
    const ctx = (elapsed: number) =>
      makeCtx({
        elapsed,
        kind: "push",
        fromScene,
        toScene,
        fromContainer,
        toContainer,
      });

    t.begin!(ctx(0));
    expect(fromContainer.alpha).toBe(1);
    expect(toContainer.alpha).toBe(0);

    t.tick(50, ctx(50));
    expect(fromContainer.alpha).toBeCloseTo(0.5, 5);
    expect(toContainer.alpha).toBeCloseTo(0.5, 5);

    t.tick(50, ctx(100));
    expect(fromContainer.alpha).toBeCloseTo(0, 5);
    expect(toContainer.alpha).toBeCloseTo(1, 5);
  });

  it("clamps elapsed/duration to [0,1]", () => {
    const t = crossFade({ duration: 100 });
    const fromContainer = { alpha: 1 };
    const toContainer = { alpha: 1 };
    const fromScene = { name: "from" } as Scene;
    const toScene = { name: "to" } as Scene;

    t.begin!(
      makeCtx({
        elapsed: 0,
        kind: "push",
        fromScene,
        toScene,
        fromContainer,
        toContainer,
      }),
    );

    t.tick(
      500,
      makeCtx({
        elapsed: 500,
        kind: "push",
        fromScene,
        toScene,
        fromContainer,
        toContainer,
      }),
    );
    expect(fromContainer.alpha).toBe(0);
    expect(toContainer.alpha).toBe(1);
  });

  it("end() restores both containers to alpha=1", () => {
    const t = crossFade({ duration: 100 });
    const fromContainer = { alpha: 0.3 };
    const toContainer = { alpha: 0.7 };
    const fromScene = { name: "from" } as Scene;
    const toScene = { name: "to" } as Scene;

    t.begin!(
      makeCtx({
        elapsed: 0,
        kind: "push",
        fromScene,
        toScene,
        fromContainer,
        toContainer,
      }),
    );
    t.end!(
      makeCtx({
        elapsed: 20,
        kind: "push",
        fromScene,
        toScene,
        fromContainer,
        toContainer,
      }),
    );

    expect(fromContainer.alpha).toBe(1);
    expect(toContainer.alpha).toBe(1);
  });

  it("tolerates an undefined fromScene (first push)", () => {
    const t = crossFade({ duration: 100 });
    const toContainer = { alpha: 1 };
    const toScene = { name: "to" } as Scene;

    expect(() =>
      t.begin!(
        makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }),
      ),
    ).not.toThrow();
    expect(toContainer.alpha).toBe(0);

    t.tick(50, makeCtx({ elapsed: 50, kind: "push", toScene, toContainer }));
    expect(toContainer.alpha).toBeCloseTo(0.5, 5);

    t.end!(makeCtx({ elapsed: 100, kind: "push", toScene, toContainer }));
    expect(toContainer.alpha).toBe(1);
  });
});
