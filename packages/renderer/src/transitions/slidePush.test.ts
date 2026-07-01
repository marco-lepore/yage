import { describe, it, expect } from "vitest";
import type {
  Scene,
  SceneTransitionContext,
  SceneTransitionKind,
} from "@yagejs/core";
import { slidePush } from "./slidePush.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { RendererKey } from "../types.js";

interface MovableContainer {
  x: number;
  y: number;
}

function makeCtx(opts: {
  elapsed: number;
  kind: SceneTransitionKind;
  toScene?: Scene;
  fromScene?: Scene;
  toContainer?: MovableContainer;
  fromContainer?: MovableContainer;
  width?: number;
  height?: number;
}): SceneTransitionContext {
  // Use distinct virtual vs canvas sizes so tests catch any regression that
  // mistakenly reads `app.screen` (canvas pixels) instead of `renderer.virtualSize`
  // (the scene root's coord space — what mask sizing and translations live in).
  const vw = opts.width ?? 800;
  const vh = opts.height ?? 600;
  return {
    elapsed: opts.elapsed,
    kind: opts.kind,
    fromScene: opts.fromScene,
    toScene: opts.toScene,
    engineContext: {
      resolve: (key: unknown) => {
        if (key === RendererKey) {
          return {
            virtualSize: { width: vw, height: vh },
            application: {
              screen: { width: vw * 2, height: vh * 2 },
              stage: { addChild: () => {} },
            },
          };
        }
        if (key === SceneRenderTreeProviderKey) {
          return {
            getTree: (s: Scene) => {
              if (s === opts.toScene && opts.toContainer) {
                return { root: opts.toContainer };
              }
              if (s === opts.fromScene && opts.fromContainer) {
                return { root: opts.fromContainer };
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

describe("slidePush", () => {
  it("defaults to 0.5s duration", () => {
    expect(slidePush().duration).toBe(0.5);
  });

  it("accepts custom duration", () => {
    expect(slidePush({ duration: 250 }).duration).toBe(250);
  });

  it('parks toContainer off-screen right and slides both left when direction="left"', () => {
    // Linear easing makes the math at midpoint exact.
    const t = slidePush({ duration: 100, easing: (x) => x });
    const toContainer: MovableContainer = { x: 99, y: 99 };
    const fromContainer: MovableContainer = { x: 99, y: 99 };
    const toScene = { name: "to" } as Scene;
    const fromScene = { name: "from" } as Scene;
    const ctx = (elapsed: number) =>
      makeCtx({
        elapsed,
        kind: "push",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      });

    t.begin!(ctx(0));
    // Direction "left" means outgoing exits LEFT; incoming starts RIGHT.
    expect(toContainer.x).toBe(800);
    expect(toContainer.y).toBeCloseTo(0, 5);
    expect(fromContainer.x).toBe(0);
    expect(fromContainer.y).toBeCloseTo(0, 5);

    t.tick(50, ctx(50));
    expect(toContainer.x).toBe(400);
    expect(fromContainer.x).toBe(-400);

    t.tick(50, ctx(100));
    expect(toContainer.x).toBeCloseTo(0, 5);
    expect(fromContainer.x).toBe(-800);
  });

  it("translates vertically for up/down directions", () => {
    const t = slidePush({
      duration: 100,
      direction: "up",
      easing: (x) => x,
    });
    const toContainer: MovableContainer = { x: 0, y: 0 };
    const fromContainer: MovableContainer = { x: 0, y: 0 };
    const toScene = { name: "to" } as Scene;
    const fromScene = { name: "from" } as Scene;

    t.begin!(
      makeCtx({
        elapsed: 0,
        kind: "push",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      }),
    );
    expect(toContainer.y).toBe(600);
    expect(fromContainer.y).toBe(0);

    t.tick(
      50,
      makeCtx({
        elapsed: 50,
        kind: "push",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      }),
    );
    expect(toContainer.y).toBe(300);
    expect(fromContainer.y).toBe(-300);
  });

  it("reverses direction on pop by default so back mirrors forward", () => {
    const t = slidePush({ duration: 100, easing: (x) => x }); // default direction "left"
    const toContainer: MovableContainer = { x: 0, y: 0 };
    const fromContainer: MovableContainer = { x: 0, y: 0 };
    const toScene = { name: "to" } as Scene;
    const fromScene = { name: "from" } as Scene;
    const ctx = (elapsed: number) =>
      makeCtx({
        elapsed,
        kind: "pop",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      });

    t.begin!(ctx(0));
    // Pop reverses to "right": incoming enters from LEFT (x=-800), outgoing
    // exits RIGHT (x=+800).
    expect(toContainer.x).toBe(-800);
    expect(fromContainer.x).toBe(0);

    t.tick(100, ctx(100));
    expect(toContainer.x).toBeCloseTo(0, 5);
    expect(fromContainer.x).toBe(800);
  });

  it("does not reverse on pop when reverseOnPop=false", () => {
    const t = slidePush({
      duration: 100,
      reverseOnPop: false,
      easing: (x) => x,
    });
    const toContainer: MovableContainer = { x: 0, y: 0 };
    const fromContainer: MovableContainer = { x: 0, y: 0 };
    const toScene = { name: "to" } as Scene;
    const fromScene = { name: "from" } as Scene;

    t.begin!(
      makeCtx({
        elapsed: 0,
        kind: "pop",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      }),
    );
    expect(toContainer.x).toBe(800);
    expect(fromContainer.x).toBe(0);
  });

  it("end() resets toContainer to origin and resets fromContainer only on push", () => {
    const t = slidePush({ duration: 100, easing: (x) => x });
    const toContainer: MovableContainer = { x: 100, y: 0 };
    const fromContainer: MovableContainer = { x: -100, y: 0 };
    const toScene = { name: "to" } as Scene;
    const fromScene = { name: "from" } as Scene;

    t.begin!(
      makeCtx({
        elapsed: 0,
        kind: "push",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      }),
    );
    t.end!(
      makeCtx({
        elapsed: 100,
        kind: "push",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      }),
    );
    expect(toContainer.x).toBe(0);
    expect(fromContainer.x).toBe(0);

    // On pop, fromContainer is about to be destroyed. Don't snap it back —
    // a one-frame restore would flash before teardown.
    toContainer.x = 5;
    fromContainer.x = -700;
    t.begin!(
      makeCtx({
        elapsed: 0,
        kind: "pop",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      }),
    );
    t.tick(
      100,
      makeCtx({
        elapsed: 100,
        kind: "pop",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      }),
    );
    t.end!(
      makeCtx({
        elapsed: 100,
        kind: "pop",
        toScene,
        fromScene,
        toContainer,
        fromContainer,
      }),
    );
    expect(toContainer.x).toBe(0);
    expect(fromContainer.x).not.toBe(0);
  });

  it("clamps elapsed/duration to [0, 1]", () => {
    const t = slidePush({ duration: 100, easing: (x) => x });
    const toContainer: MovableContainer = { x: 0, y: 0 };
    const toScene = { name: "to" } as Scene;

    t.begin!(makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }));
    t.tick(
      500,
      makeCtx({ elapsed: 500, kind: "push", toScene, toContainer }),
    );
    expect(toContainer.x).toBe(0);
  });

  it("tolerates an undefined toScene container on first push", () => {
    const t = slidePush({ duration: 100 });
    expect(() =>
      t.begin!(makeCtx({ elapsed: 0, kind: "push" })),
    ).not.toThrow();
    expect(() =>
      t.tick(50, makeCtx({ elapsed: 50, kind: "push" })),
    ).not.toThrow();
    expect(() => t.end!(makeCtx({ elapsed: 100, kind: "push" }))).not.toThrow();
  });
});
