import { describe, it, expect } from "vitest";
import { EngineContext } from "@yagejs/core";
import { createSave } from "./Save.js";
import { SavePlugin } from "./SavePlugin.js";
import { SaveServiceKey } from "./keys.js";
import { memoryAdapter } from "./adapters/memory.js";

describe("SavePlugin", () => {
  it("registers the Save instance under SaveServiceKey", () => {
    const save = createSave({ adapter: memoryAdapter() });
    const plugin = new SavePlugin({ save });
    const ctx = new EngineContext();
    plugin.install(ctx);
    expect(ctx.has(SaveServiceKey)).toBe(true);
    expect(ctx.resolve(SaveServiceKey)).toBe(save);
  });
});
