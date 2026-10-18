import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isElectronHost } from "./detect.js";

afterEach(() => {
  delete (globalThis as { __yageHost__?: unknown }).__yageHost__;
});

describe("isElectronHost", () => {
  it("is false without a bridge", () => {
    expect(isElectronHost()).toBe(false);
    (globalThis as { __yageHost__?: unknown }).__yageHost__ = null;
    expect(isElectronHost()).toBe(false);
  });

  it("is true with a bridge", () => {
    (globalThis as { __yageHost__?: unknown }).__yageHost__ = { protocol: 1 };
    expect(isElectronHost()).toBe(true);
  });

  it("loads nothing, so a browser build can ask before it imports", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./detect.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/\bimport\b/);
  });
});
