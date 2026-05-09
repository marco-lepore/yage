import { describe, it, expect, vi } from "vitest";
import type {
  Scene,
  SceneTransitionContext,
  SceneTransitionKind,
} from "@yagejs/core";
import { chessboard } from "./chessboard.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { RendererKey } from "../types.js";

interface MaskableContainer {
  mask: unknown;
  addChild: (child: unknown) => void;
  setMask: (opts: { mask: unknown; inverse: boolean }) => void;
}

function makeMaskableContainer(): MaskableContainer {
  return {
    mask: null,
    addChild: () => {},
    setMask: () => {},
  };
}

function makeCtx(opts: {
  elapsed: number;
  kind: SceneTransitionKind;
  toScene?: Scene;
  fromScene?: Scene;
  toContainer?: MaskableContainer;
  fromContainer?: MaskableContainer;
  bringSceneToFront?: (scene: Scene) => void;
}): SceneTransitionContext {
  // Distinct virtual vs canvas sizes — the mask is parented to the scene
  // root, which lives in virtual-space, so its sizing must come from
  // `renderer.virtualSize`, not `app.screen`.
  return {
    elapsed: opts.elapsed,
    kind: opts.kind,
    fromScene: opts.fromScene,
    toScene: opts.toScene,
    engineContext: {
      resolve: (key: unknown) => {
        if (key === RendererKey) {
          return {
            virtualSize: { width: 400, height: 300 },
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
            bringSceneToFront: opts.bringSceneToFront,
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

  it("brings the destination scene to the front so its mask drives the reveal on pop", () => {
    const t = chessboard({ duration: 100 });
    const toScene = { name: "to" } as Scene;
    const toContainer = makeMaskableContainer();
    const bringSceneToFront = vi.fn();

    t.begin!(
      makeCtx({
        elapsed: 0,
        kind: "pop",
        toScene,
        toContainer,
        bringSceneToFront,
      }),
    );
    expect(bringSceneToFront).toHaveBeenCalledWith(toScene);
  });

  it("attaches a mask to the destination container at begin and detaches it at end", () => {
    const t = chessboard({ duration: 100 });
    const toScene = { name: "to" } as Scene;
    const toContainer = makeMaskableContainer();
    const setMask = vi.spyOn(toContainer, "setMask");

    t.begin!(makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }));
    expect(setMask).toHaveBeenCalledTimes(1);
    expect(setMask.mock.calls[0]?.[0]?.inverse).toBe(false);

    // Direct assignment to `mask = null` is the documented teardown path.
    toContainer.mask = "still-here";
    t.end!(makeCtx({ elapsed: 100, kind: "push", toScene, toContainer }));
    expect(toContainer.mask).toBeNull();
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
