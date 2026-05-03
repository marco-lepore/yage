import { describe, it, expect } from "vitest";
import { jsonCodec, setCodec, mapCodec, dateCodec } from "./codecs.js";

describe("jsonCodec", () => {
  it("is identity in both directions", () => {
    const c = jsonCodec<{ a: number; b: string }>();
    const value = { a: 1, b: "x" };
    const encoded = c.encode(value);
    expect(encoded).toBe(value);
    expect(c.decode(encoded)).toBe(value);
  });
});

describe("setCodec", () => {
  it("round-trips a set of strings", () => {
    const c = setCodec<string>();
    const value = new Set(["a", "b", "c"]);
    const encoded = c.encode(value);
    expect(Array.isArray(encoded)).toBe(true);
    const decoded = c.decode(encoded);
    expect(decoded).toBeInstanceOf(Set);
    expect([...decoded].sort()).toEqual(["a", "b", "c"]);
  });

  it("round-trips an empty set", () => {
    const c = setCodec<number>();
    const decoded = c.decode(c.encode(new Set()));
    expect(decoded.size).toBe(0);
  });

  it("throws when decoding a non-array", () => {
    const c = setCodec<string>();
    expect(() => c.decode({})).toThrow();
  });
});

describe("mapCodec", () => {
  it("round-trips a map of string→number", () => {
    const c = mapCodec<string, number>();
    const value = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const encoded = c.encode(value);
    expect(Array.isArray(encoded)).toBe(true);
    const decoded = c.decode(encoded);
    expect(decoded).toBeInstanceOf(Map);
    expect(decoded.get("a")).toBe(1);
    expect(decoded.get("b")).toBe(2);
  });

  it("throws when decoding a non-array", () => {
    const c = mapCodec<string, number>();
    expect(() => c.decode("nope")).toThrow();
  });
});

describe("dateCodec", () => {
  it("round-trips a date via ISO string", () => {
    const c = dateCodec();
    const d = new Date("2026-05-03T12:34:56.000Z");
    const encoded = c.encode(d);
    expect(typeof encoded).toBe("string");
    const decoded = c.decode(encoded);
    expect(decoded.getTime()).toBe(d.getTime());
  });

  it("throws on non-string input", () => {
    const c = dateCodec();
    expect(() => c.decode(123)).toThrow();
  });

  it("throws on invalid ISO string", () => {
    const c = dateCodec();
    expect(() => c.decode("not a date")).toThrow();
  });
});
