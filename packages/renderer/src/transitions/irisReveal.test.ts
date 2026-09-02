import { describe, it, expect, vi } from "vitest";
import type {
  Scene,
  SceneTransitionContext,
  SceneTransitionKind,
} from "@yagejs/core";
import { irisReveal } from "./irisReveal.js";
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
      tryResolve: () => undefined,
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

describe("irisReveal", () => {
  it("defaults to 0.6s duration", () => {
    expect(irisReveal().duration).toBe(0.6);
  });

  it("accepts custom duration", () => {
    expect(irisReveal({ duration: 1200 }).duration).toBe(1200);
  });

  it("brings the destination scene to the front so its mask drives the reveal on pop", () => {
    const t = irisReveal({ duration: 100 });
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

  it("attaches a non-inverse mask to the destination at begin and detaches it at end", () => {
    const t = irisReveal({ duration: 100 });
    const toScene = { name: "to" } as Scene;
    const toContainer = makeMaskableContainer();
    const setMask = vi.spyOn(toContainer, "setMask");

    t.begin!(makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }));
    expect(setMask).toHaveBeenCalledTimes(1);
    expect(setMask.mock.calls[0]?.[0]?.inverse).toBe(false);

    toContainer.mask = "still-here";
    t.end!(makeCtx({ elapsed: 100, kind: "push", toScene, toContainer }));
    expect(toContainer.mask).toBeNull();
  });

  it("tolerates an undefined toScene container", () => {
    const t = irisReveal({ duration: 100 });
    expect(() =>
      t.begin!(makeCtx({ elapsed: 0, kind: "push" })),
    ).not.toThrow();
    expect(() =>
      t.tick(50, makeCtx({ elapsed: 50, kind: "push" })),
    ).not.toThrow();
    expect(() => t.end!(makeCtx({ elapsed: 100, kind: "push" }))).not.toThrow();
  });

  it("accepts a custom center without throwing", () => {
    const t = irisReveal({ duration: 100, center: { x: 0, y: 0 } });
    const toScene = { name: "to" } as Scene;
    const toContainer = makeMaskableContainer();
    expect(() =>
      t.begin!(makeCtx({ elapsed: 0, kind: "push", toScene, toContainer })),
    ).not.toThrow();
    expect(() =>
      t.tick(50, makeCtx({ elapsed: 50, kind: "push", toScene, toContainer })),
    ).not.toThrow();
    expect(() =>
      t.end!(makeCtx({ elapsed: 100, kind: "push", toScene, toContainer })),
    ).not.toThrow();
  });

  it("respects a custom easing", () => {
    const easing = vi.fn((t: number) => t * t);
    const transition = irisReveal({ duration: 100, easing });
    const toScene = { name: "to" } as Scene;
    const toContainer = makeMaskableContainer();
    transition.begin!(
      makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }),
    );
    transition.tick(
      50,
      makeCtx({ elapsed: 50, kind: "push", toScene, toContainer }),
    );
    expect(easing).toHaveBeenCalled();
  });
});
