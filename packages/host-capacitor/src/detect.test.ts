import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isCapacitorHost } from "./detect.js";

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe("isCapacitorHost", () => {
  it("is false on a page no app injected a bridge into", () => {
    expect(isCapacitorHost()).toBe(false);
    (globalThis as { Capacitor?: unknown }).Capacitor = {};
    expect(isCapacitorHost()).toBe(false);
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => false,
    };
    expect(isCapacitorHost()).toBe(false);
  });

  it("is true inside a Capacitor app", () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
    };
    expect(isCapacitorHost()).toBe(true);
  });

  it("loads nothing, so a browser build can ask before it imports", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./detect.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/\bimport\b/);
  });
});
