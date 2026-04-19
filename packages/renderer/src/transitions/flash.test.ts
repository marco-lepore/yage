import { describe, it, expect } from "vitest";
import type {
  Scene,
  SceneTransitionContext,
  SceneTransitionKind,
} from "@yagejs/core";
import { flash } from "./flash.js";
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

describe("flash", () => {
  it("defaults to 200ms duration and white", () => {
    const t = flash();
    expect(t.duration).toBe(200);
  });

  it("accepts custom duration and color", () => {
    const t = flash({ duration: 400, color: 0x0000ff });
    expect(t.duration).toBe(400);
  });

  it("leaves toScene alone on push — stage order already hides the old scene", () => {
    const t = flash({ duration: 100 });
    const toContainer = { visible: true };
    const toScene = { name: "to" } as Scene;

    // The overlay is fully opaque at begin, so we don't need to hide the
    // incoming scene at all — it's on top of the outgoing scene in the
    // stage order and occludes it as the overlay decays.
    t.begin!(makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);
    t.tick(50, makeCtx({ elapsed: 50, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);
    t.end!(makeCtx({ elapsed: 100, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);
  });

  it("hides fromScene from begin on pop so destination shows through the decay", () => {
    const t = flash({ duration: 100 });
    const fromContainer = { visible: true };
    const fromScene = { name: "from" } as Scene;

    t.begin!(
      makeCtx({ elapsed: 0, kind: "pop", fromScene, fromContainer }),
    );
    expect(fromContainer.visible).toBe(false);

    t.tick(
      50,
      makeCtx({ elapsed: 50, kind: "pop", fromScene, fromContainer }),
    );
    expect(fromContainer.visible).toBe(false);

    t.end!(
      makeCtx({ elapsed: 100, kind: "pop", fromScene, fromContainer }),
    );
    // end() deliberately leaves fromContainer hidden — a restore here
    // would paint it for one frame before _popScene tears it down.
    expect(fromContainer.visible).toBe(false);
  });

  it("tolerates an undefined fromScene container on pop", () => {
    const t = flash({ duration: 100 });
    expect(() =>
      t.begin!(makeCtx({ elapsed: 0, kind: "pop" })),
    ).not.toThrow();
    expect(() =>
      t.tick(50, makeCtx({ elapsed: 50, kind: "pop" })),
    ).not.toThrow();
    expect(() => t.end!(makeCtx({ elapsed: 100, kind: "pop" }))).not.toThrow();
  });

  it("tolerates an undefined toScene container on push", () => {
    const t = flash({ duration: 100 });
    expect(() =>
      t.begin!(makeCtx({ elapsed: 0, kind: "push" })),
    ).not.toThrow();
    expect(() =>
      t.tick(50, makeCtx({ elapsed: 50, kind: "push" })),
    ).not.toThrow();
    expect(() => t.end!(makeCtx({ elapsed: 100, kind: "push" }))).not.toThrow();
  });
});
