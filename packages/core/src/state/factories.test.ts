import { describe, it, expect, vi } from "vitest";
import {
  createStore,
  createRecord,
  createValue,
  createSet,
  createMap,
  createCounter,
  createList,
} from "./factories.js";
import { STATE_KIND, type ReactiveRecord } from "./reactive.js";
import { dateCodec } from "./codecs.js";

// ---------------------------------------------------------------------------
// createRecord
// ---------------------------------------------------------------------------

describe("createRecord", () => {
  interface Settings {
    music: number;
    sfx: number;
  }
  const make = () =>
    createRecord<Settings>({ default: () => ({ music: 0.8, sfx: 1.0 }) });

  it("starts with defaults", () => {
    const s = make();
    expect(s.get()).toEqual({ music: 0.8, sfx: 1.0 });
  });

  it("set() shallow-merges and notifies", () => {
    const s = make();
    const listener = vi.fn();
    s.subscribe(listener);
    s.set({ music: 0.5 });
    expect(s.get().music).toBe(0.5);
    expect(s.get().sfx).toBe(1.0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reset() restores defaults", () => {
    const s = make();
    s.set({ music: 0.1 });
    s.reset();
    expect(s.get()).toEqual({ music: 0.8, sfx: 1.0 });
  });

  it("serialize → hydrate round-trips", () => {
    const a = make();
    a.set({ music: 0.3, sfx: 0.6 });
    const payload = a.serialize();
    expect(payload).toEqual({ music: 0.3, sfx: 0.6 });

    const b = make();
    b.hydrate(payload);
    expect(b.get()).toEqual({ music: 0.3, sfx: 0.6 });
  });

  it("uses a custom codec when provided", () => {
    interface DateBag {
      when: Date;
    }
    interface DateBagEncoded {
      when: string;
    }
    const dc = dateCodec();
    const s = createRecord<DateBag, DateBagEncoded>({
      default: () => ({ when: new Date("2026-01-01T00:00:00.000Z") }),
      codec: {
        encode: (v) => ({ when: dc.encode(v.when) }),
        decode: (raw) => {
          const r = raw as { when: unknown };
          return { when: dc.decode(r.when) };
        },
      },
    });
    s.set({ when: new Date("2026-05-03T00:00:00.000Z") });
    const payload = s.serialize();
    expect(payload).toEqual({ when: "2026-05-03T00:00:00.000Z" });
  });

  it("accepts a direct value for `default` (no factory function)", () => {
    const s = createRecord<Settings>({
      default: { music: 0.4, sfx: 0.5 },
    });
    expect(s.get()).toEqual({ music: 0.4, sfx: 0.5 });
    // Mutating the live snapshot must not bleed back into the user's seed
    // on reset — `set()` always allocates a fresh object internally.
    s.set({ music: 0.9 });
    s.reset();
    expect(s.get()).toEqual({ music: 0.4, sfx: 0.5 });
  });

  it("carries the 'record' STATE_KIND brand", () => {
    expect(make()[STATE_KIND]).toBe("record");
  });

  it("delete() removes a key from an open-ended record and notifies", () => {
    const flags = createRecord<Record<string, string | number | boolean>>({
      default: () => ({ greeted: true, gold: 5 }),
    });
    const listener = vi.fn();
    flags.subscribe(listener);

    flags.delete("greeted");
    expect("greeted" in flags.get()).toBe(false);
    expect(flags.get()).toEqual({ gold: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("delete() of an absent key is a no-op and does not notify", () => {
    const flags = createRecord<Record<string, number>>({
      default: () => ({ gold: 5 }),
    });
    const listener = vi.fn();
    flags.subscribe(listener);
    const before = flags.get();

    flags.delete("nope");
    expect(flags.get()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("delete() removes an optional key on a fixed-shape record", () => {
    interface Loadout {
      weapon: string;
      charm?: string;
    }
    const s = createRecord<Loadout>({
      default: () => ({ weapon: "sword", charm: "luck" }),
    });
    s.delete("charm");
    expect(s.get()).toEqual({ weapon: "sword" });
    // A required key is a compile error — removing it would leave `get().weapon`
    // typed `string` but missing at runtime.
    // @ts-expect-error required keys are not deletable
    expect(() => s.delete("weapon")).not.toThrow();
  });

  it("a fixed-shape record is not assignable to an open-ended one", () => {
    const stats = createRecord<{ hp: number; name: string }>({
      default: () => ({ hp: 10, name: "Mira" }),
    });
    // `delete` is declared as a property, not a method, so it is checked
    // contravariantly. Without that, this assignment would compile and a
    // `delete` through the alias would drop a key `T` declares as required.
    // @ts-expect-error a fixed-shape record leaf is not an open-ended bag
    const bag: ReactiveRecord<Record<string, string | number>> = stats;
    expect(bag.get()).toEqual({ hp: 10, name: "Mira" });
  });

  it("delete() drops the key from serialize() and survives reset", () => {
    const flags = createRecord<Record<string, string | number | boolean>>({
      default: () => ({ greeted: true }),
    });
    flags.delete("greeted");
    expect(flags.serialize()).toEqual({});
    flags.reset();
    expect(flags.get()).toEqual({ greeted: true });
  });
});

// ---------------------------------------------------------------------------
// createValue
// ---------------------------------------------------------------------------

describe("createValue", () => {
  it("get/set/subscribe", () => {
    const v = createValue<string>({ default: "hello" });
    expect(v.get()).toBe("hello");
    const listener = vi.fn();
    v.subscribe(listener);
    v.set("world");
    expect(v.get()).toBe("world");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reset() restores default", () => {
    const v = createValue<number>({ default: 42 });
    v.set(99);
    v.reset();
    expect(v.get()).toBe(42);
  });

  it("accepts a factory for `default`", () => {
    let calls = 0;
    const v = createValue<number>({
      default: () => {
        calls += 1;
        return 7;
      },
    });
    expect(v.get()).toBe(7);
    expect(calls).toBe(1);
    v.set(99);
    v.reset();
    expect(v.get()).toBe(7);
    expect(calls).toBe(2);
  });

  it("set with identical value does not notify", () => {
    const v = createValue<number>({ default: 0 });
    const listener = vi.fn();
    v.subscribe(listener);
    v.set(5);
    v.set(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("persists as { value: T } and round-trips", () => {
    const a = createValue<string>({ default: "x" });
    a.set("yo");
    const payload = a.serialize();
    expect(payload).toEqual({ value: "yo" });

    const b = createValue<string>({ default: "x" });
    b.hydrate(payload);
    expect(b.get()).toBe("yo");
  });

  it("propagates codec-encoded type through serialize", () => {
    const dc = dateCodec();
    const v = createValue<Date, string>({
      default: () => new Date("2026-01-01T00:00:00.000Z"),
      codec: dc,
    });
    v.set(new Date("2026-05-03T00:00:00.000Z"));
    const payload = v.serialize();
    // payload is statically `{ value: string }`; round-trip preserves the Date.
    expect(payload).toEqual({ value: "2026-05-03T00:00:00.000Z" });
    const v2 = createValue<Date, string>({
      default: () => new Date("2026-01-01T00:00:00.000Z"),
      codec: dc,
    });
    v2.hydrate(payload);
    expect(v2.get().toISOString()).toBe("2026-05-03T00:00:00.000Z");
  });

  it("carries the 'value' STATE_KIND brand", () => {
    expect(createValue<number>({ default: 0 })[STATE_KIND]).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// createSet
// ---------------------------------------------------------------------------

describe("createSet", () => {
  it("add/has/delete/clear", () => {
    const s = createSet<string>();
    expect(s.has("a")).toBe(false);
    s.add("a");
    s.add("b");
    expect(s.has("a")).toBe(true);
    expect(s.size()).toBe(2);
    s.delete("a");
    expect(s.has("a")).toBe(false);
    s.clear();
    expect(s.size()).toBe(0);
  });

  it("values() returns an array", () => {
    const s = createSet<string>();
    s.add("a");
    s.add("b");
    expect(s.values().sort()).toEqual(["a", "b"]);
  });

  it("add() is idempotent and only notifies on change", () => {
    const s = createSet<string>();
    const listener = vi.fn();
    s.subscribe(listener);
    s.add("x");
    s.add("x");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("serialize → hydrate round-trips", () => {
    const a = createSet<string>();
    a.add("a");
    a.add("b");
    const payload = a.serialize();
    expect(payload.sort()).toEqual(["a", "b"]);

    const b = createSet<string>();
    b.hydrate(payload);
    expect(b.values().sort()).toEqual(["a", "b"]);
  });

  it("respects default factory", () => {
    const s = createSet<string>({ default: () => ["seed"] });
    expect(s.has("seed")).toBe(true);
  });

  it("carries the 'set' STATE_KIND brand", () => {
    expect(createSet<string>()[STATE_KIND]).toBe("set");
  });
});

// ---------------------------------------------------------------------------
// createMap
// ---------------------------------------------------------------------------

describe("createMap", () => {
  it("set/get/has/delete/clear", () => {
    const m = createMap<string, number>();
    expect(m.get("a")).toBeUndefined();
    m.set("a", 1);
    expect(m.get("a")).toBe(1);
    expect(m.size()).toBe(1);
    m.delete("a");
    expect(m.has("a")).toBe(false);
  });

  it("entries() returns an array", () => {
    const m = createMap<string, number>();
    m.set("a", 1);
    m.set("b", 2);
    const entries = m.entries();
    expect(entries).toHaveLength(2);
    expect(new Map(entries).get("a")).toBe(1);
  });

  it("set() is a no-op when value is identical", () => {
    const m = createMap<string, number>();
    const listener = vi.fn();
    m.subscribe(listener);
    m.set("a", 1);
    m.set("a", 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("serialize → hydrate round-trips", () => {
    const a = createMap<string, number>();
    a.set("a", 1);
    a.set("b", 2);
    const payload = a.serialize();

    const b = createMap<string, number>();
    b.hydrate(payload);
    expect(b.get("a")).toBe(1);
    expect(b.get("b")).toBe(2);
  });

  it("carries the 'map' STATE_KIND brand", () => {
    expect(createMap<string, number>()[STATE_KIND]).toBe("map");
  });
});

// ---------------------------------------------------------------------------
// createCounter
// ---------------------------------------------------------------------------

describe("createCounter", () => {
  it("increments and decrements", () => {
    const c = createCounter();
    expect(c.value()).toBe(0);
    c.increment();
    c.increment(2);
    expect(c.value()).toBe(3);
    c.decrement();
    expect(c.value()).toBe(2);
  });

  it("clamp(value, min, max) sets to the clamped value", () => {
    const c = createCounter();
    c.clamp(5, 0, 10);
    expect(c.value()).toBe(5);
    c.clamp(-3, 0, 10);
    expect(c.value()).toBe(0);
    c.clamp(99, 0, 10);
    expect(c.value()).toBe(10);
  });

  it("set() and reset()", () => {
    const c = createCounter({ default: 5 });
    c.set(42);
    expect(c.value()).toBe(42);
    c.reset();
    expect(c.value()).toBe(5);
  });

  it("serialize → hydrate round-trips", () => {
    const a = createCounter();
    a.set(7);
    const payload = a.serialize();
    expect(payload).toBe(7);

    const b = createCounter();
    b.hydrate(payload);
    expect(b.value()).toBe(7);
  });

  it("hydrate rejects non-number data", () => {
    const c = createCounter();
    expect(() => c.hydrate("nope" as unknown as number)).toThrow();
  });

  it("carries the 'counter' STATE_KIND brand", () => {
    expect(createCounter()[STATE_KIND]).toBe("counter");
  });
});

// ---------------------------------------------------------------------------
// createList
// ---------------------------------------------------------------------------

describe("createList", () => {
  interface Item {
    label: string;
    qty: number;
  }

  it("add returns monotonic ids; remove by id", () => {
    const l = createList<Item>();
    const id1 = l.add({ label: "apple", qty: 1 });
    const id2 = l.add({ label: "pear", qty: 2 });
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(l.size()).toBe(2);
    expect(l.remove(id1)).toBe(true);
    expect(l.size()).toBe(1);
    expect(l.remove(999)).toBe(false);
    expect(l.get(id2)).toEqual({ label: "pear", qty: 2 });
  });

  it("list() returns items in insertion order", () => {
    const l = createList<string>();
    l.add("a");
    l.add("b");
    l.add("c");
    expect(l.list()).toEqual(["a", "b", "c"]);
    l.remove(2);
    expect(l.list()).toEqual(["a", "c"]);
  });

  it("update shallow-merges by id", () => {
    const l = createList<Item>();
    const id = l.add({ label: "x", qty: 1 });
    expect(l.update(id, { qty: 5 })).toBe(true);
    expect(l.get(id)).toEqual({ label: "x", qty: 5 });
    expect(l.update(999, { qty: 1 })).toBe(false);
  });

  it("clear empties the list", () => {
    const l = createList<number>();
    l.add(1);
    l.add(2);
    l.clear();
    expect(l.size()).toBe(0);
  });

  it("subscribers fire on mutations", () => {
    const l = createList<Item>();
    const listener = vi.fn();
    l.subscribe(listener);
    const id1 = l.add({ label: "a", qty: 1 });
    l.add({ label: "b", qty: 2 });
    l.update(id1, { qty: 5 });
    l.remove(id1);
    l.clear();
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it("ids are stable across save/restore", () => {
    const a = createList<string>();
    const id1 = a.add("a");
    const id2 = a.add("b");
    a.remove(id1);
    const id3 = a.add("c");
    expect(id3).toBe(3);
    const payload = a.serialize();

    const b = createList<string>();
    b.hydrate(payload);
    expect(b.get(id2)).toBe("b");
    expect(b.get(id3)).toBe("c");
    expect(b.list()).toEqual(["b", "c"]);
    expect(b.add("d")).toBe(4);
  });

  it("respects default factory", () => {
    const l = createList<string>({ default: () => ["seed-a", "seed-b"] });
    expect(l.list()).toEqual(["seed-a", "seed-b"]);
    expect(l.size()).toBe(2);
  });

  describe("hydrate validation", () => {
    it("rejects NaN nextId", () => {
      const l = createList<string>();
      expect(() =>
        l.hydrate({ items: [], nextId: Number.NaN }),
      ).toThrow(/nextId/);
    });

    it("rejects fractional nextId", () => {
      const l = createList<string>();
      expect(() => l.hydrate({ items: [], nextId: 1.5 })).toThrow(/nextId/);
    });

    it("rejects nextId ≤ 0", () => {
      const l = createList<string>();
      expect(() => l.hydrate({ items: [], nextId: 0 })).toThrow(/nextId/);
    });

    it("rejects NaN / fractional / non-positive item ids", () => {
      const l = createList<string>();
      expect(() =>
        l.hydrate({
          items: [{ id: Number.NaN, value: "a" }],
          nextId: 2,
        }),
      ).toThrow(/item id/);
      expect(() =>
        l.hydrate({ items: [{ id: 1.5, value: "a" }], nextId: 2 }),
      ).toThrow(/item id/);
      expect(() =>
        l.hydrate({ items: [{ id: 0, value: "a" }], nextId: 2 }),
      ).toThrow(/item id/);
    });

    it("rejects duplicate item ids", () => {
      const l = createList<string>();
      expect(() =>
        l.hydrate({
          items: [
            { id: 1, value: "a" },
            { id: 1, value: "b" },
          ],
          nextId: 2,
        }),
      ).toThrow(/duplicate/);
    });

    it("rejects nextId ≤ the largest item id", () => {
      const l = createList<string>();
      expect(() =>
        l.hydrate({
          items: [{ id: 5, value: "a" }],
          nextId: 5,
        }),
      ).toThrow(/nextId/);
    });
  });

  it("carries the 'list' STATE_KIND brand", () => {
    expect(createList<string>()[STATE_KIND]).toBe("list");
  });

  describe("keyBy", () => {
    interface Slot {
      itemId: string;
      quantity: number;
    }

    const makeInventory = () =>
      createList<Slot>({ keyBy: (s) => s.itemId });

    it("findId / getByKey resolve by domain key; miss returns undefined", () => {
      const inv = makeInventory();
      const swordId = inv.add({ itemId: "sword", quantity: 1 });
      inv.add({ itemId: "shield", quantity: 2 });
      expect(inv.findId("sword")).toBe(swordId);
      expect(inv.getByKey("shield")).toEqual({ itemId: "shield", quantity: 2 });
      expect(inv.findId("potion")).toBeUndefined();
      expect(inv.getByKey("potion")).toBeUndefined();
    });

    it("upsert inserts then updates in place under the same id", () => {
      const inv = makeInventory();
      const id = inv.upsert("sword", { itemId: "sword", quantity: 1 });
      expect(inv.size()).toBe(1);
      const again = inv.upsert("sword", { itemId: "sword", quantity: 5 });
      expect(again).toBe(id);
      expect(inv.size()).toBe(1);
      expect(inv.getByKey("sword")).toEqual({ itemId: "sword", quantity: 5 });
    });

    it("upsert replaces the existing item wholesale", () => {
      const inv = makeInventory();
      inv.upsert("sword", { itemId: "sword", quantity: 1 });
      inv.upsert("sword", { itemId: "sword", quantity: 9 });
      expect(inv.getByKey("sword")).toEqual({ itemId: "sword", quantity: 9 });
    });

    it("upsert replaces rather than merges: an omitted optional field is gone", () => {
      interface Weapon {
        itemId: string;
        quantity: number;
        enchant?: string;
      }
      const inv = createList<Weapon>({ keyBy: (w) => w.itemId });
      inv.upsert("sword", { itemId: "sword", quantity: 1, enchant: "fire" });
      // Second item omits `enchant`; a merge would keep the old "fire".
      const id = inv.upsert("sword", { itemId: "sword", quantity: 2 });
      expect(inv.getByKey("sword")).toEqual({ itemId: "sword", quantity: 2 });
      expect(inv.getByKey("sword")).not.toHaveProperty("enchant");
      // The slot stays resolvable by its key immediately after the replace.
      expect(inv.findId("sword")).toBe(id);
    });

    it("upsert replacing an item that omits a key-contributing field stays resolvable", () => {
      interface Row {
        group: string;
        itemId: string;
        quantity: number;
      }
      // Composite key drawn from two fields. If upsert merged, replacing with an
      // item that omits `group` would keep the old one and reindex the slot
      // under a different composite key than the caller looked up.
      const rows = createList<Row>({
        keyBy: (r) => `${r.group}:${r.itemId}`,
      });
      rows.upsert("g:x", { group: "g", itemId: "x", quantity: 1 });
      const id = rows.upsert("g:x", { group: "g", itemId: "x", quantity: 5 });
      expect(rows.findId("g:x")).toBe(id);
      expect(rows.getByKey("g:x")).toEqual({
        group: "g",
        itemId: "x",
        quantity: 5,
      });
    });

    it("reindexes when update changes the key field", () => {
      const inv = makeInventory();
      const id = inv.add({ itemId: "old", quantity: 1 });
      inv.update(id, { itemId: "new" });
      expect(inv.findId("old")).toBeUndefined();
      expect(inv.findId("new")).toBe(id);
    });

    it("remove / clear / reset drop entries from the index", () => {
      const inv = createList<Slot>({
        keyBy: (s) => s.itemId,
        default: () => [{ itemId: "seed", quantity: 1 }],
      });
      const id = inv.add({ itemId: "sword", quantity: 1 });
      inv.remove(id);
      expect(inv.findId("sword")).toBeUndefined();
      inv.clear();
      expect(inv.findId("seed")).toBeUndefined();
      inv.reset();
      expect(inv.findId("seed")).toBe(1);
      expect(inv.findId("sword")).toBeUndefined();
    });

    it("supports numeric keys", () => {
      const reg = createList<{ uid: number; name: string }>({
        keyBy: (r) => r.uid,
      });
      const id = reg.add({ uid: 42, name: "ann" });
      expect(reg.findId(42)).toBe(id);
      expect(reg.getByKey(42)).toEqual({ uid: 42, name: "ann" });
    });

    it("index survives serialize -> hydrate", () => {
      const a = makeInventory();
      a.add({ itemId: "sword", quantity: 1 });
      a.add({ itemId: "shield", quantity: 2 });
      const payload = a.serialize();

      const b = makeInventory();
      b.hydrate(payload);
      expect(b.getByKey("sword")).toEqual({ itemId: "sword", quantity: 1 });
      expect(b.findId("shield")).toBe(2);
    });

    it("keyed methods throw without keyBy", () => {
      const l = createList<Slot>();
      expect(() => l.findId("sword")).toThrow(/keyBy/);
      expect(() => l.getByKey("sword")).toThrow(/keyBy/);
      expect(() => l.upsert("sword", { itemId: "sword", quantity: 1 })).toThrow(
        /keyBy/,
      );
    });

    it("add throws when a live item already holds the derived key", () => {
      const inv = makeInventory();
      const swordId = inv.add({ itemId: "sword", quantity: 1 });
      expect(() => inv.add({ itemId: "sword", quantity: 9 })).toThrow(
        /at most one item per key/,
      );
      // The rejected add left the list and index untouched.
      expect(inv.size()).toBe(1);
      expect(inv.findId("sword")).toBe(swordId);
      expect(inv.getByKey("sword")).toEqual({ itemId: "sword", quantity: 1 });
    });

    it("update throws when the new key collides with another item", () => {
      const inv = makeInventory();
      const swordId = inv.add({ itemId: "sword", quantity: 1 });
      const shieldId = inv.add({ itemId: "shield", quantity: 2 });
      expect(() => inv.update(swordId, { itemId: "shield" })).toThrow(
        /at most one item per key/,
      );
      // Both items keep their original keys.
      expect(inv.findId("sword")).toBe(swordId);
      expect(inv.findId("shield")).toBe(shieldId);
      expect(inv.getByKey("sword")).toEqual({ itemId: "sword", quantity: 1 });
    });

    it("update to a fresh key still reindexes", () => {
      const inv = makeInventory();
      const id = inv.add({ itemId: "old", quantity: 1 });
      inv.add({ itemId: "shield", quantity: 2 });
      inv.update(id, { itemId: "new" });
      expect(inv.findId("old")).toBeUndefined();
      expect(inv.findId("new")).toBe(id);
      expect(inv.getByKey("new")).toEqual({ itemId: "new", quantity: 1 });
    });

    it("update keeping its own key is allowed", () => {
      const inv = makeInventory();
      const id = inv.add({ itemId: "sword", quantity: 1 });
      expect(inv.update(id, { quantity: 5 })).toBe(true);
      expect(inv.getByKey("sword")).toEqual({ itemId: "sword", quantity: 5 });
      expect(inv.findId("sword")).toBe(id);
    });

    it("upsert throws when the item's key does not match the lookup key", () => {
      const inv = makeInventory();
      expect(() =>
        inv.upsert("sword", { itemId: "axe", quantity: 1 }),
      ).toThrow(/keyBy\(item\) === key/);
      // Nothing was inserted under either key.
      expect(inv.size()).toBe(0);
      expect(inv.findId("sword")).toBeUndefined();
      expect(inv.findId("axe")).toBeUndefined();
    });

    it("upsert inserts a new key then replaces an existing one", () => {
      const inv = makeInventory();
      const swordId = inv.upsert("sword", { itemId: "sword", quantity: 1 });
      const axeId = inv.upsert("axe", { itemId: "axe", quantity: 1 });
      expect(inv.size()).toBe(2);
      expect(swordId).not.toBe(axeId);
      expect(inv.findId("sword")).toBe(swordId);
      expect(inv.findId("axe")).toBe(axeId);

      const again = inv.upsert("sword", { itemId: "sword", quantity: 7 });
      expect(again).toBe(swordId);
      expect(inv.size()).toBe(2);
      expect(inv.getByKey("sword")).toEqual({ itemId: "sword", quantity: 7 });
      expect(inv.getByKey("axe")).toEqual({ itemId: "axe", quantity: 1 });
    });

    it("hydrate rejects a payload with duplicate derived keys", () => {
      const inv = makeInventory();
      expect(() =>
        inv.hydrate({
          items: [
            { id: 1, value: { itemId: "sword", quantity: 1 } },
            { id: 2, value: { itemId: "sword", quantity: 2 } },
          ],
          nextId: 3,
        }),
      ).toThrow(/at most one item per key/);
    });

    it("createList throws when the default has duplicate keys", () => {
      expect(() =>
        createList<Slot>({
          keyBy: (s) => s.itemId,
          default: () => [
            { itemId: "sword", quantity: 1 },
            { itemId: "sword", quantity: 2 },
          ],
        }),
      ).toThrow(/at most one item per key/);
    });
  });
});

// ---------------------------------------------------------------------------
// Compound createStore
// ---------------------------------------------------------------------------

describe("createStore (compound)", () => {
  interface Potion {
    name: string;
    quality: number;
  }

  const makeGame = () =>
    createStore((s) => ({
      inventory: s.map<string, number>(),
      recipes: s.set<string>(),
      gold: s.counter({ default: 0 }),
      reputation: s.counter({ default: 50 }),
      shelf: s.list<Potion>(),
      day: s.value<number>({ default: 1 }),
      settings: s.record<{ volume: number; lang: string }>({
        default: () => ({ volume: 0.8, lang: "en" }),
      }),
    }));

  it("exposes per-shape ops on each leaf", () => {
    const game = makeGame();
    game.gold.increment(10);
    expect(game.gold.value()).toBe(10);
    game.inventory.set("moonleaf", 3);
    expect(game.inventory.get("moonleaf")).toBe(3);
    game.recipes.add("brew-1");
    expect(game.recipes.has("brew-1")).toBe(true);
    const potionId = game.shelf.add({ name: "Cure", quality: 7 });
    expect(game.shelf.get(potionId)?.name).toBe("Cure");
    game.day.set(5);
    expect(game.day.get()).toBe(5);
    game.settings.set({ volume: 0.5 });
    expect(game.settings.get().volume).toBe(0.5);
    expect(game.settings.get().lang).toBe("en");
  });

  it("counter default is honoured", () => {
    const game = makeGame();
    expect(game.gold.value()).toBe(0);
    expect(game.reputation.value()).toBe(50);
  });

  it("counter without options defaults to 0", () => {
    const c = createStore((s) => ({ ctr: s.counter() }));
    expect(c.ctr.value()).toBe(0);
  });

  it("aggregates subscribe across leaves", () => {
    const game = makeGame();
    const listener = vi.fn();
    game.subscribe(listener);
    game.gold.increment(1);
    game.inventory.set("a", 1);
    game.recipes.add("r");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("per-leaf reactivity — sibling mutations don't fire other leaves' subscribers", () => {
    const game = makeGame();
    const goldListener = vi.fn();
    const invListener = vi.fn();
    game.gold.subscribe(goldListener);
    game.inventory.subscribe(invListener);

    game.gold.increment(1);
    expect(goldListener).toHaveBeenCalledTimes(1);
    expect(invListener).toHaveBeenCalledTimes(0);

    game.inventory.set("k", 1);
    expect(goldListener).toHaveBeenCalledTimes(1);
    expect(invListener).toHaveBeenCalledTimes(1);
  });

  it("serialize → hydrate round-trips with mixed leaves", () => {
    const a = makeGame();
    a.gold.set(125);
    a.inventory.set("moonleaf", 3);
    a.inventory.set("mandrake", 1);
    a.recipes.add("healing");
    a.recipes.add("luck");
    const potionId = a.shelf.add({ name: "Cure", quality: 7 });
    a.day.set(12);
    a.settings.set({ volume: 0.5, lang: "fr" });

    const payload = a.serialize();

    const b = makeGame();
    b.hydrate(payload);
    expect(b.gold.value()).toBe(125);
    expect(b.inventory.entries().sort()).toEqual([
      ["mandrake", 1],
      ["moonleaf", 3],
    ]);
    expect(b.recipes.values().sort()).toEqual(["healing", "luck"]);
    expect(b.shelf.get(potionId)).toEqual({ name: "Cure", quality: 7 });
    expect(b.day.get()).toBe(12);
    expect(b.settings.get()).toEqual({ volume: 0.5, lang: "fr" });
  });

  it("reset() restores every leaf", () => {
    const game = makeGame();
    game.gold.set(99);
    game.inventory.set("a", 1);
    game.day.set(5);
    game.reset();
    expect(game.gold.value()).toBe(0);
    expect(game.inventory.size()).toBe(0);
    expect(game.day.get()).toBe(1);
  });

  it("rejects leaf keys that collide with reserved members", () => {
    expect(() =>
      createStore((s) => ({ reset: s.counter() } as never)),
    ).toThrow(/reserved/);
  });

  it("rejects dict entries not produced by this builder", () => {
    const foreign = createCounter();
    expect(() =>
      createStore((s) => ({
        gold: s.counter(),
        leak: foreign,
      })),
    ).toThrow(/was not created by this builder/);
  });

  it("rejects the same leaf assigned to two keys", () => {
    expect(() =>
      createStore((s) => {
        const ctr = s.counter();
        return { a: ctr, b: ctr };
      }),
    ).toThrow(/assigned to both/);
  });

  it("rolls every leaf back to its prior state when hydrate fails partway", () => {
    const a = createStore((s) => ({
      gold: s.counter({ default: 5 }),
      flags: s.set<string>(),
    }));
    a.gold.set(50);
    a.flags.add("opened");

    expect(() =>
      a.hydrate({
        gold: 99,
        // @ts-expect-error — intentionally malformed shape to trigger rollback
        flags: "not-an-array",
      }),
    ).toThrow();

    expect(a.gold.value()).toBe(50);
    expect(a.flags.values().sort()).toEqual(["opened"]);
  });

  it("carries the 'store' STATE_KIND brand", () => {
    expect(makeGame()[STATE_KIND]).toBe("store");
  });

  it("encoded shape is type-checked per leaf (compile-time)", () => {
    const game = createStore((s) => ({
      flag: s.value<boolean>({ default: false }),
      flags: s.set<string>(),
    }));
    const encoded = game.serialize();
    expect(encoded.flag).toEqual({ value: false });
    expect(encoded.flags).toEqual([]);
  });

  it("a keyed list leaf exposes findId/getByKey/upsert and round-trips", () => {
    const make = () =>
      createStore((s) => ({
        bag: s.list<{ itemId: string; quantity: number }>({
          keyBy: (i) => i.itemId,
        }),
      }));
    const game = make();
    game.bag.upsert("sword", { itemId: "sword", quantity: 1 });
    game.bag.upsert("sword", { itemId: "sword", quantity: 3 });
    expect(game.bag.findId("sword")).toBe(1);
    expect(game.bag.getByKey("sword")).toEqual({ itemId: "sword", quantity: 3 });

    const restored = make();
    restored.hydrate(game.serialize());
    expect(restored.bag.getByKey("sword")).toEqual({
      itemId: "sword",
      quantity: 3,
    });
  });
});
