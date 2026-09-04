import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCoreModule } from "./duplicateModuleGuard.js";

const CORE_INSTANCE_KEY = Symbol.for("@yagejs/core/module-instance");

function clearRegistration(): void {
  Reflect.deleteProperty(globalThis, CORE_INSTANCE_KEY);
}

describe("duplicate core module guard", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    clearRegistration();
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("records the first module instance without warning", () => {
    const host = {};
    const warn = vi.fn();

    registerCoreModule(host, {}, warn);

    expect(warn).not.toHaveBeenCalled();
    expect(Reflect.get(host, CORE_INSTANCE_KEY)).toBeDefined();
  });

  it("stays silent for the same module instance", () => {
    const host = {};
    const instance = {};
    const warn = vi.fn();

    registerCoreModule(host, instance, warn);
    registerCoreModule(host, instance, warn);

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once for different module instances", () => {
    const host = {};
    const warn = vi.fn();

    registerCoreModule(host, {}, warn);
    registerCoreModule(host, {}, warn);
    registerCoreModule(host, {}, warn);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Multiple copies of @yagejs/core"),
    );
  });

  it("does not register or warn in production", async () => {
    process.env.NODE_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();

    await import("./duplicateModuleGuard.js");

    expect(warn).not.toHaveBeenCalled();
    expect(Reflect.get(globalThis, CORE_INSTANCE_KEY)).toBeUndefined();
  });
});
