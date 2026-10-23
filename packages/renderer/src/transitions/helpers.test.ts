import { describe, it, expect, vi } from "vitest";
import type { Scene, SceneTransitionContext } from "@yagejs/core";
import { getSceneRenderTree, getVirtualBounds } from "./helpers.js";
import { SceneRenderTreeProviderKey } from "../SceneRenderTree.js";
import { RendererKey } from "../types.js";

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

function makeRendererCtx(virtualSize: {
  width: number;
  height: number;
}): SceneTransitionContext {
  return {
    elapsed: 0,
    kind: "push",
    engineContext: {
      resolve: (key: unknown) =>
        key === RendererKey ? { virtualSize } : undefined,
    },
    fromScene: undefined,
    toScene: undefined,
  } as unknown as SceneTransitionContext;
}

describe("getSceneRenderTree", () => {
  it("returns undefined when scene is undefined", () => {
    const provider = { getTree: vi.fn() };
    const ctx = makeCtx(provider);
    expect(getSceneRenderTree(ctx, undefined)).toBeUndefined();
    expect(provider.getTree).not.toHaveBeenCalled();
  });

  it("returns the scene's render tree when the scene has one", () => {
    const tree = { alpha: 1 };
    const provider = {
      getTree: vi.fn(() => tree),
    };
    const ctx = makeCtx(provider);
    const scene = { name: "s" } as Scene;
    expect(getSceneRenderTree(ctx, scene)).toBe(tree);
    expect(provider.getTree).toHaveBeenCalledWith(scene);
  });

  it("returns undefined when the provider has no tree for the scene", () => {
    const provider = { getTree: vi.fn(() => undefined) };
    const ctx = makeCtx(provider);
    const scene = { name: "s" } as Scene;
    expect(getSceneRenderTree(ctx, scene)).toBeUndefined();
  });
});

describe("getVirtualBounds", () => {
  it("returns the renderer's virtualSize verbatim", () => {
    const ctx = makeRendererCtx({ width: 1024, height: 768 });
    expect(getVirtualBounds(ctx)).toEqual({ width: 1024, height: 768 });
  });
});
