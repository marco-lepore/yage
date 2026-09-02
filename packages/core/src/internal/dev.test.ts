import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { devWarn, isDev } from "./dev.js";

describe("isDev", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("returns true when NODE_ENV is not set", () => {
    delete process.env.NODE_ENV;
    expect(isDev()).toBe(true);
  });

  it("returns true when NODE_ENV is development", () => {
    process.env.NODE_ENV = "development";
    expect(isDev()).toBe(true);
  });

  it("returns false when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    expect(isDev()).toBe(false);
  });
});

describe("devWarn", () => {
  const original = process.env.NODE_ENV;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    process.env.NODE_ENV = original;
  });

  it("logs in dev", () => {
    process.env.NODE_ENV = "development";
    devWarn("hello");
    expect(warn).toHaveBeenCalledWith("[yage] hello");
  });

  it("does not log in production", () => {
    process.env.NODE_ENV = "production";
    devWarn("hello");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("isDev under a bundler's define step", () => {
  // Runs the real `dev.ts` text in a sandbox with no `process` global, with
  // the exact `process.env.NODE_ENV` token replaced the way a bundler's
  // define step does. `replacement: null` leaves the token in place, which
  // models a browser that loads the module without a bundler.
  function evalDevModule(replacement: string | null): {
    isDev: () => boolean;
    devWarn: (message: string) => void;
    warn: ReturnType<typeof vi.fn>;
  } {
    const source = readFileSync(new URL("./dev.ts", import.meta.url), "utf8");
    let script = source
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/^export /gm, "")
      .replace(/: boolean/g, "")
      .replace(/: string/g, "")
      .replace(/: void/g, "");
    if (!script.includes("function isDev")) {
      throw new Error("dev.ts strip failed: `function isDev` not found");
    }
    if (replacement !== null) {
      script = script.replaceAll("process.env.NODE_ENV", replacement);
    }
    const warn = vi.fn();
    const sandbox: Record<string, unknown> = { console: { warn } };
    runInNewContext(`${script}\n__exports = { isDev, devWarn };`, sandbox);
    const exports = sandbox.__exports as {
      isDev: () => boolean;
      devWarn: (message: string) => void;
    };
    return { ...exports, warn };
  }

  it("folds to false in a production build and devWarn stays silent", () => {
    const { isDev, devWarn, warn } = evalDevModule('"production"');
    expect(isDev()).toBe(false);
    devWarn("x");
    expect(warn).not.toHaveBeenCalled();
  });

  it("is true in a development build and devWarn warns once", () => {
    const { isDev, devWarn, warn } = evalDevModule('"development"');
    expect(isDev()).toBe(true);
    devWarn("x");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[yage] x");
  });

  it("throws a ReferenceError without a bundler and without process", () => {
    const { isDev } = evalDevModule(null);
    // The sandbox has its own `ReferenceError` class, so match on name.
    expect(() => isDev()).toThrow(
      expect.objectContaining({ name: "ReferenceError" }),
    );
  });
});
