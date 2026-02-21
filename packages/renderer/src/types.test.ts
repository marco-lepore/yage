import { describe, it, expect } from "vitest";
import { RendererKey, StageKey, CameraKey, RenderLayerManagerKey } from "./types.js";

describe("Service Keys", () => {
  it("RendererKey has id 'renderer'", () => {
    expect(RendererKey.id).toBe("renderer");
  });

  it("StageKey has id 'stage'", () => {
    expect(StageKey.id).toBe("stage");
  });

  it("CameraKey has id 'camera'", () => {
    expect(CameraKey.id).toBe("camera");
  });

  it("RenderLayerManagerKey has id 'renderLayerManager'", () => {
    expect(RenderLayerManagerKey.id).toBe("renderLayerManager");
  });

  it("all keys have unique ids", () => {
    const ids = [RendererKey.id, StageKey.id, CameraKey.id, RenderLayerManagerKey.id];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
