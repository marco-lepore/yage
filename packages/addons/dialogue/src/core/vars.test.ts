import { describe, expect, it } from "vitest";

import { MemoryVariableStorage, cells, compose, materialize } from "./vars.js";

describe("MemoryVariableStorage", () => {
  it("get / set / has / entries round-trip, seeded from the ctor", () => {
    const s = new MemoryVariableStorage({ gold: 5 });
    expect(s.has("gold")).toBe(true);
    expect(s.get("gold")).toBe(5);
    expect(s.get("missing")).toBeUndefined();
    s.set("greeted", true);
    expect(materialize(s)).toEqual({ gold: 5, greeted: true });
    s.clear();
    expect(materialize(s)).toEqual({});
  });
});

describe("cells", () => {
  it("reads through the getter live and writes through the setter", () => {
    let gold = 100;
    const s = cells({ gold: { get: () => gold, set: (v) => (gold = Number(v)) } });
    expect(s.has("gold")).toBe(true);
    expect(s.get("gold")).toBe(100);
    gold = 75;
    expect(s.get("gold")).toBe(75); // live
    s.set("gold", 40);
    expect(gold).toBe(40); // wrote through
  });

  it("a read-only cell (bare getter, or no setter) throws on set", () => {
    const bare = cells({ hp: () => 10 });
    expect(bare.get("hp")).toBe(10);
    expect(() => bare.set("hp", 5)).toThrow(/read-only/);

    const noSetter = cells({ hp: { get: () => 10 } });
    expect(() => noSetter.set("hp", 5)).toThrow(/read-only/);
  });

  it("does not claim names it has no accessor for", () => {
    const s = cells({ a: () => 1 });
    expect(s.has("b")).toBe(false);
    expect(s.get("b")).toBeUndefined();
    expect(() => s.set("b", 1)).toThrow(/no accessor/);
  });
});

describe("compose", () => {
  it("reads/has from the first storage that has the name", () => {
    const game = cells({ gold: () => 10 });
    const mem = new MemoryVariableStorage({ greeted: false });
    const s = compose(game, mem);
    expect(s.get("gold")).toBe(10);
    expect(s.get("greeted")).toBe(false);
    expect(s.has("gold")).toBe(true);
    expect(s.has("nope")).toBe(false);
  });

  it("routes a write to the first storage that has the name, else the last", () => {
    let gold = 10;
    const game = cells({ gold: { get: () => gold, set: (v) => (gold = Number(v)) } });
    const mem = new MemoryVariableStorage();
    const s = compose(game, mem);

    s.set("gold", 3); // routes to the cell (it has the name)
    expect(gold).toBe(3);

    s.set("local", true); // brand-new name → last (the writable memory store)
    expect(gold).toBe(3);
    expect(mem.get("local")).toBe(true);
  });

  it("materializes a first-wins union of all storages", () => {
    const a = new MemoryVariableStorage({ x: 1, shared: "a" });
    const b = new MemoryVariableStorage({ y: 2, shared: "b" });
    expect(materialize(compose(a, b))).toEqual({ x: 1, shared: "a", y: 2 });
  });

  it("throws when composed with zero storages", () => {
    expect(() => compose()).toThrow(/at least one/);
  });
});
