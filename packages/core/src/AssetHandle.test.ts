import { describe, it, expect } from "vitest";
import { AssetHandle } from "./AssetHandle.js";

describe("AssetHandle", () => {
  it("stores type and path", () => {
    const handle = new AssetHandle("texture", "sprites/player.png");
    expect(handle.type).toBe("texture");
    expect(handle.path).toBe("sprites/player.png");
  });

  it("different types can share the same path", () => {
    const a = new AssetHandle("texture", "data/sheet.json");
    const b = new AssetHandle("spritesheet", "data/sheet.json");
    expect(a.type).not.toBe(b.type);
    expect(a.path).toBe(b.path);
  });
});
