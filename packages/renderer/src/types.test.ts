import { describe, it, expect } from "vitest";
import { RendererKey } from "./types.js";
import {
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "./SceneRenderTree.js";

describe("Service Keys", () => {
  it("RendererKey has id 'renderer' and engine scope", () => {
    expect(RendererKey.id).toBe("renderer");
    expect(RendererKey.scope).toBe("engine");
  });

  it("SceneRenderTreeProviderKey is engine-scoped", () => {
    expect(SceneRenderTreeProviderKey.id).toBe("sceneRenderTreeProvider");
    expect(SceneRenderTreeProviderKey.scope).toBe("engine");
  });

  it("SceneRenderTreeKey is scene-scoped", () => {
    expect(SceneRenderTreeKey.id).toBe("sceneRenderTree");
    expect(SceneRenderTreeKey.scope).toBe("scene");
  });

  it("all keys have unique ids", () => {
    const ids = [
      RendererKey.id,
      SceneRenderTreeKey.id,
      SceneRenderTreeProviderKey.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
