import { createMap, createRecord, createStore } from "@yagejs/core";
import { describe, expect, it, vi } from "vitest";

import type { VarValue } from "./types.js";
import {
  MemoryVariableStorage,
  cells,
  compose,
  createRecordStorage,
  createStoreStorage,
  materialize,
} from "./vars.js";

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

  it("does not leak Object.prototype names (own-property checks only)", () => {
    const s = cells({ gold: () => 1 });
    for (const proto of ["toString", "constructor", "hasOwnProperty"]) {
      expect(s.has(proto)).toBe(false);
      expect(s.get(proto)).toBeUndefined();
      expect(() => s.set(proto, 1)).toThrow(/no accessor/);
    }
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

describe("createRecordStorage", () => {
  it("get / set / has / entries round-trip, seeded from the record", () => {
    const rec: Record<string, string | number | boolean> = { gold: 5 };
    const s = createRecordStorage(rec);
    expect(s.has("gold")).toBe(true);
    expect(s.get("gold")).toBe(5);
    expect(s.get("missing")).toBeUndefined();
    s.set("greeted", true);
    expect(materialize(s)).toEqual({ gold: 5, greeted: true });
  });

  it("writes through, mutating the backing record in place", () => {
    const rec: Record<string, string | number | boolean> = { gold: 5 };
    const s = createRecordStorage(rec);
    s.set("gold", 40);
    s.set("name", "Mira");
    expect(rec).toEqual({ gold: 40, name: "Mira" });
  });

  it("treats set(name, null) as unset: deletes the key", () => {
    const rec: Record<string, string | number | boolean> = { gold: 5 };
    const s = createRecordStorage(rec);
    s.set("gold", null);
    expect(s.has("gold")).toBe(false);
    expect(s.get("gold")).toBeUndefined();
    expect(Object.hasOwn(rec, "gold")).toBe(false);
  });

  it("reads an absent name as undefined (not null)", () => {
    const s = createRecordStorage({});
    expect(s.get("nope")).toBeUndefined();
  });

  it("does not leak Object.prototype names (own-property checks only)", () => {
    const s = createRecordStorage({ gold: 1 });
    for (const proto of ["toString", "constructor", "hasOwnProperty"]) {
      expect(s.has(proto)).toBe(false);
      expect(s.get(proto)).toBeUndefined();
    }
  });

  it("materializes to the backing non-null record", () => {
    const rec: Record<string, string | number | boolean> = { gold: 5, greeted: true };
    expect(materialize(createRecordStorage(rec))).toEqual(rec);
  });
});

describe("createStoreStorage (record leaf)", () => {
  const makeLeaf = (initial: Record<string, VarValue> = {}) =>
    createRecord<Record<string, VarValue>>({ default: () => ({ ...initial }) });

  it("get / set / has / entries round-trip through the leaf", () => {
    const leaf = makeLeaf({ gold: 5 });
    const s = createStoreStorage(leaf);
    expect(s.has("gold")).toBe(true);
    expect(s.get("gold")).toBe(5);
    expect(s.get("missing")).toBeUndefined();
    s.set("greeted", true);
    expect(leaf.get()).toEqual({ gold: 5, greeted: true });
    expect(materialize(s)).toEqual({ gold: 5, greeted: true });
  });

  it("notifies the leaf's subscribers on every dialogue write", () => {
    const leaf = makeLeaf();
    const s = createStoreStorage(leaf);
    const listener = vi.fn();
    leaf.subscribe(listener);

    s.set("greeted", true);
    expect(listener).toHaveBeenCalledTimes(1);
    s.set("gold", 5);
    expect(listener).toHaveBeenCalledTimes(2);
    s.set("gold", null); // unset also notifies
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps writing to the live leaf after reset() swaps its object (#170)", () => {
    const leaf = makeLeaf();
    const s = createStoreStorage(leaf);

    s.set("greeted", true);
    expect(leaf.get()).toEqual({ greeted: true });

    leaf.reset(); // the leaf replaces its internal object here

    s.set("greeted", true);
    expect(leaf.get()).toEqual({ greeted: true });
    expect(s.get("greeted")).toBe(true);
  });

  it("keeps writing to the live leaf after hydrate() swaps its object (#170)", () => {
    const leaf = makeLeaf();
    const s = createStoreStorage(leaf);

    s.set("gold", 5);
    const saved = leaf.serialize();
    s.set("gold", 99);

    leaf.hydrate(saved); // the leaf replaces its internal object here
    expect(s.get("gold")).toBe(5); // reads are live, not from a stale snapshot

    s.set("gold", 7);
    expect(leaf.get()).toEqual({ gold: 7 });
  });

  it("sees a host-side leaf write without going stale", () => {
    const leaf = makeLeaf();
    const s = createStoreStorage(leaf);
    s.set("gold", 1);

    leaf.set({ gold: 50 }); // host writes directly — the leaf swaps objects again

    expect(s.get("gold")).toBe(50);
    s.set("gold", 60);
    expect(leaf.get()).toEqual({ gold: 60 });
  });

  it("treats set(name, null) as unset: drops the key", () => {
    const leaf = makeLeaf({ gold: 5 });
    const s = createStoreStorage(leaf);
    s.set("gold", null);
    expect(s.has("gold")).toBe(false);
    expect(s.get("gold")).toBeUndefined();
    expect(Object.hasOwn(leaf.get(), "gold")).toBe(false);
  });

  it("rejects a fixed-shape record leaf at compile time", () => {
    const stats = createRecord<{ hp: number; name: string }>({
      default: () => ({ hp: 10, name: "Mira" }),
    });
    // A `set hp = null` in a script unsets the name, which on this leaf would
    // drop a key its own type declares as always present — so it must not
    // typecheck. Dialogue variables need an open-ended leaf.
    // @ts-expect-error a fixed-shape record leaf is not a dialogue variable bag
    const storage = createStoreStorage(stats);
    expect(storage.get("hp")).toBe(10);
  });

  it("does not leak Object.prototype names (own-property checks only)", () => {
    const s = createStoreStorage(makeLeaf({ gold: 1 }));
    for (const proto of ["toString", "constructor", "hasOwnProperty"]) {
      expect(s.has(proto)).toBe(false);
      expect(s.get(proto)).toBeUndefined();
    }
  });

  it("rides a compound store's serialize / hydrate", () => {
    const game = createStore((s) => ({
      flags: s.record<Record<string, VarValue>>({ default: () => ({}) }),
    }));
    const storage = createStoreStorage(game.flags);
    storage.set("metMira", true);

    const saved = JSON.parse(JSON.stringify(game.serialize())) as ReturnType<
      typeof game.serialize
    >;
    game.reset();
    expect(storage.has("metMira")).toBe(false);

    game.hydrate(saved);
    expect(storage.get("metMira")).toBe(true);

    // And the compound's serialization cache saw the dialogue write, so a save
    // taken after it carries the flag rather than the pre-write snapshot.
    storage.set("gold", 12);
    expect(game.serialize().flags).toEqual({ metMira: true, gold: 12 });
  });
});

describe("createStoreStorage (map leaf)", () => {
  it("get / set / has / entries round-trip through the leaf", () => {
    const leaf = createMap<string, VarValue>({ default: () => [["gold", 5]] });
    const s = createStoreStorage(leaf);
    expect(s.has("gold")).toBe(true);
    expect(s.get("gold")).toBe(5);
    expect(s.get("missing")).toBeUndefined();
    s.set("greeted", true);
    expect(materialize(s)).toEqual({ gold: 5, greeted: true });
  });

  it("notifies subscribers and survives a reset (#170)", () => {
    const leaf = createMap<string, VarValue>();
    const s = createStoreStorage(leaf);
    const listener = vi.fn();
    leaf.subscribe(listener);

    s.set("greeted", true);
    expect(listener).toHaveBeenCalledTimes(1);

    leaf.reset();
    s.set("greeted", true);
    expect(leaf.get("greeted")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3); // write, reset, write
  });

  it("treats set(name, null) as unset so a default can seed", () => {
    const leaf = createMap<string, VarValue>({ default: () => [["gold", 5]] });
    const s = createStoreStorage(leaf);
    s.set("gold", null);
    expect(s.has("gold")).toBe(false);
    expect(s.get("gold")).toBeUndefined();
    expect(leaf.size()).toBe(0);
  });
});
