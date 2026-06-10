import { describe, it, expect, vi } from "vitest";
import { SceneManagerKey } from "@yagejs/core";
import type { EngineContext, Scene } from "@yagejs/core";
import { RendererKey, SceneRenderTreeKey } from "@yagejs/renderer";
import type { SceneRenderTree } from "@yagejs/renderer";
import { FloatingOverlay, FloatingOverlayKey } from "./floating.js";
import { FloatingOverlaySystem } from "./FloatingOverlaySystem.js";

// A scene whose only relevant capability is scoped resolution of the overlay
// + render tree. No UIRoot, no React — exactly the imperative case.
function makeScene(
  overlay: FloatingOverlay | undefined,
  tree: SceneRenderTree | undefined,
): Scene {
  return {
    _resolveScoped: <T>(key: { id: string }): T | undefined => {
      if (key === (FloatingOverlayKey as unknown as { id: string }))
        return overlay as unknown as T;
      if (key === (SceneRenderTreeKey as unknown as { id: string }))
        return tree as unknown as T;
      return undefined;
    },
  } as unknown as Scene;
}

function makeContext(scenes: Scene[]): EngineContext {
  return {
    resolve: (key: { id: string }) => {
      if (key === (SceneManagerKey as unknown as { id: string }))
        return { activeScenes: scenes };
      if (key === (RendererKey as unknown as { id: string }))
        return { virtualSize: { width: 800, height: 600 } };
      throw new Error(`unexpected key ${key.id}`);
    },
  } as unknown as EngineContext;
}

describe("FloatingOverlaySystem", () => {
  it("attaches + ticks each active scene's overlay with no UIRoot present", () => {
    const overlay = new FloatingOverlay();
    const attach = vi.spyOn(overlay, "attach");
    const update = vi.spyOn(overlay, "update");
    const tree = {
      ensureLayer: () => ({ container: { sortableChildren: false } }),
    } as unknown as SceneRenderTree;
    const scene = makeScene(overlay, tree);

    const sys = new FloatingOverlaySystem();
    const ctx = makeContext([scene]);
    sys.onRegister(ctx);
    // The base System stashes the context on registration in real engines;
    // mirror that so `update()` can read `this.context`.
    (sys as unknown as { context: EngineContext }).context = ctx;

    sys.update();

    expect(attach).toHaveBeenCalledWith(tree);
    expect(update).toHaveBeenCalledWith({ width: 800, height: 600 });
  });

  it("runs in LateUpdate after UILayoutSystem (priority 201)", () => {
    const sys = new FloatingOverlaySystem();
    expect(sys.phase).toBe("lateUpdate");
    expect(sys.priority).toBe(201);
  });

  it("skips scenes without an overlay", () => {
    const sys = new FloatingOverlaySystem();
    const ctx = makeContext([makeScene(undefined, undefined)]);
    sys.onRegister(ctx);
    (sys as unknown as { context: EngineContext }).context = ctx;
    expect(() => sys.update()).not.toThrow();
  });
});
