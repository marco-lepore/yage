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
