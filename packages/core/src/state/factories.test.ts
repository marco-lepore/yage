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
import { STATE_KIND } from "./reactive.js";
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
});
