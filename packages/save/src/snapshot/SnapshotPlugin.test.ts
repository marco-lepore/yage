import { describe, it, expect } from "vitest";
import { EngineContext } from "@yagejs/core";
import { SnapshotPlugin } from "./SnapshotPlugin.js";
import { SnapshotServiceKey } from "./keys.js";
import { MemoryStorage } from "./test-helpers.js";

describe("SnapshotPlugin", () => {
  it("registers SnapshotService on install", () => {
    const ctx = new EngineContext();
    const plugin = new SnapshotPlugin();
    plugin.install(ctx);

    expect(ctx.has(SnapshotServiceKey)).toBe(true);
  });

  it("uses custom storage when provided", () => {
    const ctx = new EngineContext();
    const storage = new MemoryStorage();
    const plugin = new SnapshotPlugin({ storage });
    plugin.install(ctx);

    const service = ctx.resolve(SnapshotServiceKey);
    service.saveData("test", "value");
    expect(service.loadData("test")).toBe("value");
  });

  it("uses custom namespace when provided", () => {
    const ctx = new EngineContext();
    const storage = new MemoryStorage();
    const plugin = new SnapshotPlugin({ storage, namespace: "mygame" });
    plugin.install(ctx);

    const service = ctx.resolve(SnapshotServiceKey);
    service.saveData("profile", { score: 42 });
    // Verify namespace is in the key
    expect(storage.load("mygame:data:profile")).not.toBeNull();
  });

  it("has correct plugin metadata", () => {
    const plugin = new SnapshotPlugin();
    expect(plugin.name).toBe("snapshot");
    expect(plugin.version).toBe("1.0.0");
  });
});
