import { describe, it, expect, vi } from "vitest";
import type { Scene, SceneTransitionContext } from "@yagejs/core";
import { getSceneContainer } from "./helpers.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";

function makeCtx(provider: unknown): SceneTransitionContext {
  return {
    elapsed: 0,
    kind: "push",
    engineContext: {
      resolve: (key: unknown) =>
        key === SceneRenderTreeProviderKey ? provider : undefined,
    },
    fromScene: undefined,
    toScene: undefined,
  } as unknown as SceneTransitionContext;
}

describe("getSceneContainer", () => {
  it("returns undefined when scene is undefined", () => {
    const provider = { getTree: vi.fn() };
    const ctx = makeCtx(provider);
    expect(getSceneContainer(ctx, undefined)).toBeUndefined();
    expect(provider.getTree).not.toHaveBeenCalled();
  });

  it("returns the tree's root container when the scene has a tree", () => {
    const root = { label: "scene-root" };
    const provider = {
      getTree: vi.fn(() => ({ root })),
    };
    const ctx = makeCtx(provider);
    const scene = { name: "s" } as Scene;
    expect(getSceneContainer(ctx, scene)).toBe(root);
    expect(provider.getTree).toHaveBeenCalledWith(scene);
  });

  it("returns undefined when the provider has no tree for the scene", () => {
    const provider = { getTree: vi.fn(() => undefined) };
    const ctx = makeCtx(provider);
    const scene = { name: "s" } as Scene;
    expect(getSceneContainer(ctx, scene)).toBeUndefined();
  });
});
