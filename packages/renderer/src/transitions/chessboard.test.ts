import { describe, it, expect } from "vitest";
import type {
  Scene,
  SceneTransitionContext,
  SceneTransitionKind,
} from "@yagejs/core";
import { chessboard, cellAlpha } from "./chessboard.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { RendererKey } from "../types.js";

function makeCtx(opts: {
  elapsed: number;
  kind: SceneTransitionKind;
  toScene?: Scene;
  fromScene?: Scene;
  toContainer?: { visible: boolean };
  fromContainer?: { visible: boolean };
}): SceneTransitionContext {
  return {
    elapsed: opts.elapsed,
    kind: opts.kind,
    fromScene: opts.fromScene,
    toScene: opts.toScene,
    engineContext: {
      resolve: (key: unknown) => {
        if (key === RendererKey) {
          return {
            application: {
              screen: { width: 800, height: 600 },
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

describe("chessboard", () => {
  it("defaults to 700ms duration", () => {
    expect(chessboard().duration).toBe(700);
  });

  it("accepts custom duration", () => {
    expect(chessboard({ duration: 1500 }).duration).toBe(1500);
  });

  it("hides toScene on push until the mid-point, then reveals it", () => {
    const t = chessboard({ duration: 100 });
    const toContainer = { visible: true };
    const toScene = { name: "to" } as Scene;

    t.begin!(makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(false);

    t.tick(25, makeCtx({ elapsed: 25, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(false);

    t.tick(25, makeCtx({ elapsed: 50, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);

    t.end!(makeCtx({ elapsed: 100, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);
  });

  it("hides fromScene at the mid-point on pop", () => {
    const t = chessboard({ duration: 100 });
    const fromContainer = { visible: true };
    const fromScene = { name: "from" } as Scene;

    t.begin!(makeCtx({ elapsed: 0, kind: "pop", fromScene, fromContainer }));
    expect(fromContainer.visible).toBe(true);

    t.tick(25, makeCtx({ elapsed: 25, kind: "pop", fromScene, fromContainer }));
    expect(fromContainer.visible).toBe(true);

    t.tick(25, makeCtx({ elapsed: 50, kind: "pop", fromScene, fromContainer }));
    expect(fromContainer.visible).toBe(false);

    t.end!(makeCtx({ elapsed: 100, kind: "pop", fromScene, fromContainer }));
    expect(fromContainer.visible).toBe(false);
  });

  it("tolerates undefined scenes on either side", () => {
    const t = chessboard({ duration: 100 });
    expect(() =>
      t.begin!(makeCtx({ elapsed: 0, kind: "push" })),
    ).not.toThrow();
    expect(() =>
      t.tick(50, makeCtx({ elapsed: 50, kind: "push" })),
    ).not.toThrow();
    expect(() => t.end!(makeCtx({ elapsed: 100, kind: "push" }))).not.toThrow();
  });

  it("clamps row/col counts to at least 1", () => {
    expect(() =>
      chessboard({ rows: 0, cols: -3, duration: 50 }).begin!(
        makeCtx({ elapsed: 0, kind: "push" }),
      ),
    ).not.toThrow();
  });
});

describe("cellAlpha", () => {
  it("ramps phase-0 cells up across [0, 0.25]", () => {
    expect(cellAlpha(0, 0)).toBe(0);
    expect(cellAlpha(0.125, 0)).toBeCloseTo(0.5, 5);
    expect(cellAlpha(0.25, 0)).toBeCloseTo(1, 5);
  });

  it("ramps phase-1 cells up across [0.25, 0.5]", () => {
    expect(cellAlpha(0.2, 1)).toBe(0);
    expect(cellAlpha(0.375, 1)).toBeCloseTo(0.5, 5);
    expect(cellAlpha(0.5, 1)).toBeCloseTo(1, 5);
  });

  it("holds both parities at full opacity at the mid-point", () => {
    expect(cellAlpha(0.5, 0)).toBeCloseTo(1, 5);
    expect(cellAlpha(0.5, 1)).toBeCloseTo(1, 5);
  });

  it("ramps phase-0 cells down across [0.5, 0.75]", () => {
    expect(cellAlpha(0.625, 0)).toBeCloseTo(0.5, 5);
    expect(cellAlpha(0.75, 0)).toBe(0);
  });

  it("ramps phase-1 cells down across [0.75, 1]", () => {
    expect(cellAlpha(0.75, 1)).toBeCloseTo(1, 5);
    expect(cellAlpha(0.875, 1)).toBeCloseTo(0.5, 5);
    expect(cellAlpha(1, 1)).toBe(0);
  });
});
