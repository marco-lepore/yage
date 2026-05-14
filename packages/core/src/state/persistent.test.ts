import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  defineStore,
  defineRecord,
  defineValue,
  defineSet,
  defineMap,
  defineCounter,
  defineList,
  StoreVersionTooNewError,
  StoreMigrationMissingError,
  _resetAllStoresForTesting,
  _clearStoreRegistryForTesting,
} from "./persistent.js";
import { dateCodec } from "./codecs.js";

beforeEach(() => {
  _clearStoreRegistryForTesting();
});

// ---------------------------------------------------------------------------
// defineRecord (renamed from old defineStore<T>)
// ---------------------------------------------------------------------------

describe("defineRecord", () => {
  interface Settings {
    music: number;
    sfx: number;
  }
  const make = (
    overrides?: Partial<Parameters<typeof defineRecord<Settings>>[1]>,
  ) =>
    defineRecord<Settings>("test.settings", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
      ...overrides,
    });

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
    const a = defineRecord<Settings>("t.r1", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    a.set({ music: 0.3, sfx: 0.6 });
    const payload = a.serialize();
    expect(payload).toEqual({
      version: 1,
      data: { music: 0.3, sfx: 0.6 },
    });

    _clearStoreRegistryForTesting();
    const b = defineRecord<Settings>("t.r1", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    b.hydrate(payload);
    expect(b.get()).toEqual({ music: 0.3, sfx: 0.6 });
  });

  it("throws StoreVersionTooNewError when stored version > current", () => {
    const s = defineRecord<Settings>("t.too-new", {
      version: 1,
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    expect(() =>
      s.hydrate({ version: 2, data: { music: 0, sfx: 0 } }),
    ).toThrow(StoreVersionTooNewError);
  });

  it("throws StoreMigrationMissingError when older version and no migrate", () => {
    const s = defineRecord<Settings>("t.no-migrate", {
      version: 2,
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    expect(() =>
      s.hydrate({ version: 1, data: { music: 0 } }),
    ).toThrow(StoreMigrationMissingError);
  });

  it("runs migrate() when stored version < current", () => {
    const migrate = vi.fn((old: unknown) => {
      const o = old as { music: number };
      return { music: o.music, sfx: 0.5 };
    });
    const s = defineRecord<Settings>("t.migrate", {
      version: 2,
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
      migrate,
    });
    s.hydrate({ version: 1, data: { music: 0.2 } });
    expect(migrate).toHaveBeenCalledWith({ music: 0.2 }, 1);
    expect(s.get()).toEqual({ music: 0.2, sfx: 0.5 });
  });

  it("uses a custom codec when provided", () => {
    interface DateBag {
      when: Date;
    }
    const dc = dateCodec();
    const s = defineRecord<DateBag>("t.codec", {
      defaults: () => ({ when: new Date("2026-01-01T00:00:00.000Z") }),
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
    expect(payload.data).toEqual({ when: "2026-05-03T00:00:00.000Z" });

    _clearStoreRegistryForTesting();
    const t = defineRecord<DateBag>("t.codec", {
      defaults: () => ({ when: new Date("2026-01-01T00:00:00.000Z") }),
      codec: {
        encode: (v) => ({ when: dc.encode(v.when) }),
        decode: (raw) => {
          const r = raw as { when: unknown };
          return { when: dc.decode(r.when) };
        },
      },
    });
    t.hydrate(payload);
    expect(t.get().when.toISOString()).toBe("2026-05-03T00:00:00.000Z");
  });

  it("re-defining the same id replaces the entry instead of throwing", () => {
    const a = defineRecord<Settings>("t.dupe", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    a.set({ music: 0.5 });
    expect(() =>
      defineRecord<Settings>("t.dupe", {
        defaults: () => ({ music: 0.8, sfx: 1.0 }),
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// defineValue
// ---------------------------------------------------------------------------

describe("defineValue", () => {
  it("get/set/subscribe", () => {
    const v = defineValue<string>("t.val.basic", { defaults: () => "hello" });
    expect(v.get()).toBe("hello");
    const listener = vi.fn();
    v.subscribe(listener);
    v.set("world");
    expect(v.get()).toBe("world");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reset() restores default", () => {
    const v = defineValue<number>("t.val.reset", { defaults: () => 42 });
    v.set(99);
    v.reset();
    expect(v.get()).toBe(42);
  });

  it("set with identical value does not notify", () => {
    const v = defineValue<number>("t.val.idem", { defaults: () => 0 });
    const listener = vi.fn();
    v.subscribe(listener);
    v.set(5);
    v.set(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("persists as { value: T } and round-trips", () => {
    const a = defineValue<string>("t.val.rt", { defaults: () => "x" });
    a.set("yo");
    const payload = a.serialize();
    expect(payload).toEqual({ version: 1, data: { value: "yo" } });

    _clearStoreRegistryForTesting();
    const b = defineValue<string>("t.val.rt", { defaults: () => "x" });
    b.hydrate(payload);
    expect(b.get()).toBe("yo");
  });

  it("runs migrate on older version", () => {
    const v = defineValue<string>("t.val.mig", {
      version: 2,
      defaults: () => "",
      migrate: (old) => `v2:${(old as { value: string }).value}`,
    });
    v.hydrate({ version: 1, data: { value: "a" } });
    expect(v.get()).toBe("v2:a");
  });
});

// ---------------------------------------------------------------------------
// defineSet — verb alignment to .delete
// ---------------------------------------------------------------------------

describe("defineSet", () => {
  it("add/has/delete/clear", () => {
    const s = defineSet<string>("t.set.crud");
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

  it("does not expose a 'remove' method", () => {
    const s = defineSet<string>("t.set.no-remove");
    expect((s as unknown as { remove?: unknown }).remove).toBeUndefined();
  });

  it("values() returns an array", () => {
    const s = defineSet<string>("t.set.values");
    s.add("a");
    s.add("b");
    expect(s.values().sort()).toEqual(["a", "b"]);
  });

  it("add() is idempotent and only notifies on change", () => {
    const s = defineSet<string>("t.set.idem");
    const listener = vi.fn();
    s.subscribe(listener);
    s.add("x");
    s.add("x");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("serialize → hydrate round-trips", () => {
    const a = defineSet<string>("t.set.rt");
    a.add("a");
    a.add("b");
    const payload = a.serialize();

    _clearStoreRegistryForTesting();
    const b = defineSet<string>("t.set.rt");
    b.hydrate(payload);
    expect(b.values().sort()).toEqual(["a", "b"]);
  });

  it("hydrate rejects future versions", () => {
    const s = defineSet<string>("t.set.future", { version: 1 });
    expect(() => s.hydrate({ version: 2, data: [] })).toThrow(
      StoreVersionTooNewError,
    );
  });

  it("hydrate throws StoreMigrationMissingError on older version without migrate", () => {
    const s = defineSet<string>("t.set.no-mig", { version: 2 });
    expect(() => s.hydrate({ version: 1, data: ["a"] })).toThrow(
      StoreMigrationMissingError,
    );
  });

  it("hydrate runs migrate when stored version < current", () => {
    const s = defineSet<string>("t.set.mig", {
      version: 2,
      migrate: (old) => new Set((old as string[]).map((x) => `v2:${x}`)),
    });
    s.hydrate({ version: 1, data: ["a", "b"] });
    expect(s.values().sort()).toEqual(["v2:a", "v2:b"]);
  });

  it("respects defaults factory", () => {
    const s = defineSet<string>("t.set.defaults", {
      defaults: () => ["seed"],
    });
    expect(s.has("seed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// defineMap — verb alignment to .delete
// ---------------------------------------------------------------------------

describe("defineMap", () => {
  it("set/get/has/delete/clear", () => {
    const m = defineMap<string, number>("t.map.crud");
    expect(m.get("a")).toBeUndefined();
    m.set("a", 1);
    expect(m.get("a")).toBe(1);
    expect(m.size()).toBe(1);
    m.delete("a");
    expect(m.has("a")).toBe(false);
  });

  it("does not expose a 'remove' method", () => {
    const m = defineMap<string, number>("t.map.no-remove");
    expect((m as unknown as { remove?: unknown }).remove).toBeUndefined();
  });

  it("entries() returns an array", () => {
    const m = defineMap<string, number>("t.map.entries");
    m.set("a", 1);
    m.set("b", 2);
    const entries = m.entries();
    expect(entries).toHaveLength(2);
    expect(new Map(entries).get("a")).toBe(1);
  });

  it("set() is a no-op when value is identical", () => {
    const m = defineMap<string, number>("t.map.idem");
    const listener = vi.fn();
    m.subscribe(listener);
    m.set("a", 1);
    m.set("a", 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("serialize → hydrate round-trips", () => {
    const a = defineMap<string, number>("t.map.rt");
    a.set("a", 1);
    a.set("b", 2);
    const payload = a.serialize();

    _clearStoreRegistryForTesting();
    const b = defineMap<string, number>("t.map.rt");
    b.hydrate(payload);
    expect(b.get("a")).toBe(1);
    expect(b.get("b")).toBe(2);
  });

  it("hydrate throws StoreMigrationMissingError on older version without migrate", () => {
    const m = defineMap<string, number>("t.map.no-mig", { version: 2 });
    expect(() => m.hydrate({ version: 1, data: [["a", 1]] })).toThrow(
      StoreMigrationMissingError,
    );
  });

  it("hydrate runs migrate when stored version < current", () => {
    const m = defineMap<string, number>("t.map.mig", {
      version: 2,
      migrate: (old) => {
        const entries = old as Array<[string, number]>;
        return new Map(entries.map(([k, v]) => [k, v * 10]));
      },
    });
    m.hydrate({ version: 1, data: [["a", 1], ["b", 2]] });
    expect(m.get("a")).toBe(10);
    expect(m.get("b")).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// defineCounter — with clamp
// ---------------------------------------------------------------------------

describe("defineCounter", () => {
  it("increments and decrements", () => {
    const c = defineCounter("t.ctr.crud");
    expect(c.value()).toBe(0);
    c.increment();
    c.increment(2);
    expect(c.value()).toBe(3);
    c.decrement();
    expect(c.value()).toBe(2);
  });

  it("clamp(value, min, max) sets to the clamped value", () => {
    const c = defineCounter("t.ctr.clamp");
    c.clamp(5, 0, 10);
    expect(c.value()).toBe(5);
    c.clamp(-3, 0, 10);
    expect(c.value()).toBe(0);
    c.clamp(99, 0, 10);
    expect(c.value()).toBe(10);
  });

  it("set() and reset()", () => {
    const c = defineCounter("t.ctr.set", { defaults: () => 5 });
    c.set(42);
    expect(c.value()).toBe(42);
    c.reset();
    expect(c.value()).toBe(5);
  });

  it("serialize → hydrate round-trips", () => {
    const a = defineCounter("t.ctr.rt");
    a.set(7);
    const payload = a.serialize();

    _clearStoreRegistryForTesting();
    const b = defineCounter("t.ctr.rt");
    b.hydrate(payload);
    expect(b.value()).toBe(7);
  });

  it("hydrate rejects non-number data", () => {
    const c = defineCounter("t.ctr.bad");
    expect(() => c.hydrate({ version: 1, data: "nope" })).toThrow();
  });

  it("hydrate throws StoreMigrationMissingError on older version without migrate", () => {
    const c = defineCounter("t.ctr.no-mig", { version: 2 });
    expect(() => c.hydrate({ version: 1, data: 7 })).toThrow(
      StoreMigrationMissingError,
    );
  });

  it("hydrate runs migrate when stored version < current", () => {
    const c = defineCounter("t.ctr.mig", {
      version: 2,
      migrate: (old) => (old as number) + 100,
    });
    c.hydrate({ version: 1, data: 5 });
    expect(c.value()).toBe(105);
  });
});

// ---------------------------------------------------------------------------
// defineList
// ---------------------------------------------------------------------------

describe("defineList", () => {
  interface Item {
    label: string;
    qty: number;
  }

  it("add returns monotonic ids; remove by id", () => {
    const l = defineList<Item>("t.list.basic");
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
    const l = defineList<string>("t.list.order");
    l.add("a");
    l.add("b");
    l.add("c");
    expect(l.list()).toEqual(["a", "b", "c"]);
    l.remove(2);
    expect(l.list()).toEqual(["a", "c"]);
  });

  it("update shallow-merges by id", () => {
    const l = defineList<Item>("t.list.update");
    const id = l.add({ label: "x", qty: 1 });
    expect(l.update(id, { qty: 5 })).toBe(true);
    expect(l.get(id)).toEqual({ label: "x", qty: 5 });
    expect(l.update(999, { qty: 1 })).toBe(false);
  });

  it("clear empties the list", () => {
    const l = defineList<number>("t.list.clear");
    l.add(1);
    l.add(2);
    l.clear();
    expect(l.size()).toBe(0);
  });

  it("subscribers fire on mutations", () => {
    const l = defineList<Item>("t.list.sub");
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
    const a = defineList<string>("t.list.rt");
    const id1 = a.add("a");
    const id2 = a.add("b");
    a.remove(id1);
    const id3 = a.add("c");
    expect(id3).toBe(3); // nextId is monotonic, doesn't reuse
    const payload = a.serialize();

    _clearStoreRegistryForTesting();
    const b = defineList<string>("t.list.rt");
    b.hydrate(payload);
    expect(b.get(id2)).toBe("b");
    expect(b.get(id3)).toBe("c");
    expect(b.list()).toEqual(["b", "c"]);
    // Next add continues the monotonic sequence.
    expect(b.add("d")).toBe(4);
  });

  it("respects defaults factory", () => {
    const l = defineList<string>("t.list.defaults", {
      defaults: () => ["seed-a", "seed-b"],
    });
    expect(l.list()).toEqual(["seed-a", "seed-b"]);
    expect(l.size()).toBe(2);
  });

  it("runs migrate on older versions", () => {
    const l = defineList<string>("t.list.mig", {
      version: 2,
      migrate: (old) => {
        const arr = old as { items: Array<{ id: number; value: string }> };
        return arr.items.map((entry) => `v2:${entry.value}`);
      },
    });
    l.hydrate({
      version: 1,
      data: { items: [{ id: 1, value: "a" }, { id: 2, value: "b" }], nextId: 3 },
    });
    expect(l.list()).toEqual(["v2:a", "v2:b"]);
  });
});

// ---------------------------------------------------------------------------
// Compound defineStore
// ---------------------------------------------------------------------------

describe("defineStore (compound)", () => {
  interface Potion {
    name: string;
    quality: number;
  }

  const makeGame = () =>
    defineStore("game", (s) => ({
      inventory: s.map<string, number>(),
      recipes: s.set<string>(),
      gold: s.counter({ default: 0 }),
      reputation: s.counter({ default: 50 }),
      shelf: s.list<Potion>(),
      day: s.value<number>({ default: 1 }),
      settings: s.record<{ volume: number; lang: string }>({
        defaults: () => ({ volume: 0.8, lang: "en" }),
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
    const c = defineStore("c.nooptions", (s) => ({ ctr: s.counter() }));
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
    expect(payload.version).toBe(1);

    _clearStoreRegistryForTesting();
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

  it("runs per-tree migrate when stored version < current", () => {
    interface V1 {
      gold: number;
    }
    interface V2 {
      gold: number;
      day: number;
    }
    const a = defineStore("g.mig", (s) => ({
      gold: s.counter({ default: 0 }),
    }));
    a.gold.set(50);
    const payloadV1 = a.serialize();

    _clearStoreRegistryForTesting();
    const b = defineStore(
      "g.mig",
      (s) => ({
        gold: s.counter({ default: 0 }),
        day: s.value<number>({ default: 1 }),
      }),
      {
        version: 2,
        migrate: (old) => {
          const v1 = old as V1;
          const v2: V2 = { gold: v1.gold, day: 7 };
          return { gold: v2.gold, day: { value: v2.day } };
        },
      },
    );
    b.hydrate(payloadV1);
    expect(b.gold.value()).toBe(50);
    expect(b.day.get()).toBe(7);
  });

  it("throws StoreVersionTooNewError on future payloads", () => {
    const s = defineStore("g.future", (s) => ({ ctr: s.counter() }));
    expect(() =>
      s.hydrate({ version: 99, data: { ctr: 0 } }),
    ).toThrow(StoreVersionTooNewError);
  });

  it("throws StoreMigrationMissingError on older payload with no migrate", () => {
    const s = defineStore("g.no-mig", (s) => ({ ctr: s.counter() }), {
      version: 2,
    });
    expect(() =>
      s.hydrate({ version: 1, data: { ctr: 0 } }),
    ).toThrow(StoreMigrationMissingError);
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
      defineStore("g.reserved", (s) => ({
        version: s.counter(),
      } as never)),
    ).toThrow(/reserved/);
  });

  it("rejects dict entries not produced by this builder", () => {
    const foreign = defineCounter("foreign.leak");
    expect(() =>
      defineStore("g.stray", (s) => ({
        gold: s.counter(),
        leak: foreign,
      })),
    ).toThrow(/was not created by this builder/);
  });

  it("rejects the same leaf assigned to two keys", () => {
    expect(() =>
      defineStore("g.dupe", (s) => {
        const ctr = s.counter();
        return { a: ctr, b: ctr };
      }),
    ).toThrow(/assigned to both/);
  });

  it("rolls every leaf back to its prior state when hydrate fails partway", () => {
    const a = defineStore("g.rollback", (s) => ({
      gold: s.counter({ default: 5 }),
      flags: s.set<string>(),
    }));
    a.gold.set(50);
    a.flags.add("opened");

    // Payload where the second leaf's data is malformed — set decoder throws.
    expect(() =>
      a.hydrate({
        version: 1,
        data: { gold: 99, flags: "not-an-array" },
      }),
    ).toThrow();

    // Both leaves are back at their pre-hydrate values.
    expect(a.gold.value()).toBe(50);
    expect(a.flags.values().sort()).toEqual(["opened"]);
  });
});

// ---------------------------------------------------------------------------
// _resetAllStoresForTesting
// ---------------------------------------------------------------------------

describe("_resetAllStoresForTesting", () => {
  it("resets every registered store back to defaults", () => {
    const s = defineRecord<{ a: number }>("t.reset.a", {
      defaults: () => ({ a: 1 }),
    });
    const set = defineSet<string>("t.reset.b");
    const map = defineMap<string, number>("t.reset.c");
    const ctr = defineCounter("t.reset.d");
    const game = defineStore("t.reset.e", (b) => ({
      ctr: b.counter({ default: 9 }),
    }));

    s.set({ a: 99 });
    set.add("x");
    map.set("k", 1);
    ctr.set(7);
    game.ctr.set(0);

    _resetAllStoresForTesting();

    expect(s.get().a).toBe(1);
    expect(set.size()).toBe(0);
    expect(map.size()).toBe(0);
    expect(ctr.value()).toBe(0);
    expect(game.ctr.value()).toBe(9);
  });
});
