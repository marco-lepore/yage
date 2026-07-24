import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RENDERER_INSTANCE_KEY = Symbol.for("@yagejs/renderer/module-instance");

function clearRegistration(): void {
  Reflect.deleteProperty(globalThis, RENDERER_INSTANCE_KEY);
}

describe("duplicate renderer module guard", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    clearRegistration();
    vi.resetModules();
  });

  afterEach(() => {
    clearRegistration();
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("stays silent when the same module instance is imported again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./duplicateModuleGuard.js");
    await import("./duplicateModuleGuard.js");

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once when an isolated module instance registers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./duplicateModuleGuard.js");
    vi.resetModules();
    await import("./duplicateModuleGuard.js");
    vi.resetModules();
    await import("./duplicateModuleGuard.js");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Multiple copies of @yagejs/renderer"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("peer dependencies"),
    );
  });

  it("does not register or warn in production", async () => {
    process.env.NODE_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("./duplicateModuleGuard.js");
    vi.resetModules();
    await import("./duplicateModuleGuard.js");

    expect(warn).not.toHaveBeenCalled();
    expect(Reflect.get(globalThis, RENDERER_INSTANCE_KEY)).toBeUndefined();
  });
});
