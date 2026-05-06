import { describe, it, expect } from "vitest";
import type {
  Scene,
  SceneTransitionContext,
  SceneTransitionKind,
} from "@yagejs/core";
import { iris } from "./iris.js";
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

describe("iris", () => {
  it("defaults to 600ms duration", () => {
    expect(iris().duration).toBe(600);
  });

  it("accepts custom duration", () => {
    expect(iris({ duration: 1200 }).duration).toBe(1200);
  });

  it("hides toScene on push until the mid-point, then reveals it", () => {
    const t = iris({ duration: 100 });
    const toContainer = { visible: true };
    const toScene = { name: "to" } as Scene;

    t.begin!(makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(false);

    t.tick(25, makeCtx({ elapsed: 25, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(false);

    t.tick(25, makeCtx({ elapsed: 50, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);

    t.tick(25, makeCtx({ elapsed: 75, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);

    t.end!(makeCtx({ elapsed: 100, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);
  });

  it("hides fromScene at the mid-point on pop so the destination shows through", () => {
    const t = iris({ duration: 100 });
    const fromContainer = { visible: true };
    const fromScene = { name: "from" } as Scene;

    t.begin!(makeCtx({ elapsed: 0, kind: "pop", fromScene, fromContainer }));
    expect(fromContainer.visible).toBe(true);

    t.tick(25, makeCtx({ elapsed: 25, kind: "pop", fromScene, fromContainer }));
    expect(fromContainer.visible).toBe(true);

    t.tick(25, makeCtx({ elapsed: 50, kind: "pop", fromScene, fromContainer }));
    expect(fromContainer.visible).toBe(false);

    t.tick(25, makeCtx({ elapsed: 75, kind: "pop", fromScene, fromContainer }));
    expect(fromContainer.visible).toBe(false);

    // end() does NOT restore — fromContainer is destroyed on the same
    // frame after end() and a restore would flash it for one frame.
    t.end!(makeCtx({ elapsed: 100, kind: "pop", fromScene, fromContainer }));
    expect(fromContainer.visible).toBe(false);
  });

  it("end() restores incoming visibility as a mid-run safety net on push", () => {
    const t = iris({ duration: 100 });
    const toContainer = { visible: true };
    const toScene = { name: "to" } as Scene;

    t.begin!(makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(false);

    t.end!(makeCtx({ elapsed: 20, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);
  });

  it("tolerates undefined scenes on either side", () => {
    const t = iris({ duration: 100 });
    expect(() =>
      t.begin!(makeCtx({ elapsed: 0, kind: "push" })),
    ).not.toThrow();
    expect(() =>
      t.tick(50, makeCtx({ elapsed: 50, kind: "push" })),
    ).not.toThrow();
    expect(() => t.end!(makeCtx({ elapsed: 100, kind: "push" }))).not.toThrow();
  });

  it("accepts a custom center without throwing", () => {
    const t = iris({ duration: 100, center: { x: 0, y: 0 } });
    expect(() =>
      t.begin!(makeCtx({ elapsed: 0, kind: "push" })),
    ).not.toThrow();
    expect(() =>
      t.tick(50, makeCtx({ elapsed: 50, kind: "push" })),
    ).not.toThrow();
    expect(() => t.end!(makeCtx({ elapsed: 100, kind: "push" }))).not.toThrow();
  });
});
