import { describe, it, expect } from "vitest";
import { EngineContext } from "@yage/core";
import { SavePlugin } from "./SavePlugin.js";
import { SaveServiceKey } from "./keys.js";
import { MemoryStorage } from "./test-helpers.js";

describe("SavePlugin", () => {
  it("registers SaveService on install", () => {
    const ctx = new EngineContext();
    const plugin = new SavePlugin();
    plugin.install(ctx);

    expect(ctx.has(SaveServiceKey)).toBe(true);
  });

  it("uses custom storage when provided", () => {
    const ctx = new EngineContext();
    const storage = new MemoryStorage();
    const plugin = new SavePlugin({ storage });
    plugin.install(ctx);

    const service = ctx.resolve(SaveServiceKey);
    service.saveData("test", "value");
    expect(service.loadData("test")).toBe("value");
  });

  it("uses custom namespace when provided", () => {
    const ctx = new EngineContext();
    const storage = new MemoryStorage();
    const plugin = new SavePlugin({ storage, namespace: "mygame" });
    plugin.install(ctx);

    const service = ctx.resolve(SaveServiceKey);
    service.saveData("profile", { score: 42 });
    // Verify namespace is in the key
    expect(storage.load("mygame:data:profile")).not.toBeNull();
  });

  it("has correct plugin metadata", () => {
    const plugin = new SavePlugin();
    expect(plugin.name).toBe("save");
    expect(plugin.version).toBe("1.0.0");
  });
});
