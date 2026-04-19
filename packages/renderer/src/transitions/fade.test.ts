import { describe, it, expect } from "vitest";
import type {
  Scene,
  SceneTransitionContext,
  SceneTransitionKind,
} from "@yagejs/core";
import { fade } from "./fade.js";
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

describe("fade", () => {
  it("defaults to 300ms duration and black", () => {
    const t = fade();
    expect(t.duration).toBe(300);
  });

  it("accepts custom duration and color", () => {
    const t = fade({ duration: 500, color: 0xff0000 });
    expect(t.duration).toBe(500);
  });

  it("hides toScene on push until the mid-point, then reveals it", () => {
    const t = fade({ duration: 100 });
    const toContainer = { visible: true };
    const toScene = { name: "to" } as Scene;

    t.begin!(
      makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }),
    );
    expect(toContainer.visible).toBe(false);

    // Before half-way: still hidden.
    t.tick(25, makeCtx({ elapsed: 25, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(false);

    // Exactly half-way: reveal.
    t.tick(25, makeCtx({ elapsed: 50, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);

    // Stays revealed past the mid-point.
    t.tick(25, makeCtx({ elapsed: 75, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);

    t.end!(makeCtx({ elapsed: 100, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);
  });

  it("keeps fromScene visible through the fade-out, then hides it at the mid-point on pop", () => {
    const t = fade({ duration: 100 });
    const fromContainer = { visible: true };
    const fromScene = { name: "from" } as Scene;

    t.begin!(
      makeCtx({ elapsed: 0, kind: "pop", fromScene, fromContainer }),
    );
    // Fade-out phase: outgoing scene should stay visible so we see it fade.
    expect(fromContainer.visible).toBe(true);

    t.tick(
      25,
      makeCtx({ elapsed: 25, kind: "pop", fromScene, fromContainer }),
    );
    expect(fromContainer.visible).toBe(true);

    // Half-way: overlay is fully opaque, hide the outgoing scene so the
    // fade-in half reveals the destination instead.
    t.tick(
      25,
      makeCtx({ elapsed: 50, kind: "pop", fromScene, fromContainer }),
    );
    expect(fromContainer.visible).toBe(false);

    t.tick(
      25,
      makeCtx({ elapsed: 75, kind: "pop", fromScene, fromContainer }),
    );
    expect(fromContainer.visible).toBe(false);

    // end() does NOT restore visibility — the outgoing scene is about to
    // be destroyed synchronously after teardown, but PIXI renders between
    // end() and that teardown, so restoring here would produce a visible
    // last-frame pop.
    t.end!(
      makeCtx({ elapsed: 100, kind: "pop", fromScene, fromContainer }),
    );
    expect(fromContainer.visible).toBe(false);
  });

  it("end() restores visibility as a safety net if called mid-run", () => {
    const t = fade({ duration: 100 });
    const toContainer = { visible: true };
    const toScene = { name: "to" } as Scene;

    t.begin!(makeCtx({ elapsed: 0, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(false);

    // Simulate clear() mid-run before reveal threshold.
    t.end!(makeCtx({ elapsed: 20, kind: "push", toScene, toContainer }));
    expect(toContainer.visible).toBe(true);
  });

  it("tolerates an undefined toScene container", () => {
    const t = fade({ duration: 100 });
    expect(() =>
      t.begin!(makeCtx({ elapsed: 0, kind: "push" })),
    ).not.toThrow();
    expect(() =>
      t.tick(50, makeCtx({ elapsed: 50, kind: "push" })),
    ).not.toThrow();
    expect(() => t.end!(makeCtx({ elapsed: 100, kind: "push" }))).not.toThrow();
  });
});
