import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  defineStore,
  defineSet,
  defineMap,
  defineCounter,
  StoreVersionTooNewError,
  StoreMigrationMissingError,
  _resetAllStoresForTesting,
  _clearStoreRegistryForTesting,
} from "./persistent.js";
import { dateCodec } from "./codecs.js";

beforeEach(() => {
  _clearStoreRegistryForTesting();
});

describe("defineStore", () => {
  interface Settings {
    music: number;
    sfx: number;
  }
  const make = (overrides?: Partial<Parameters<typeof defineStore<Settings>>[1]>) =>
    defineStore<Settings>("test.settings", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
      ...overrides,
    });

  it("starts with defaults", () => {
    const s = make();
    expect(s.get()).toEqual({ music: 0.8, sfx: 1.0 });
    expect(Object.isFrozen(s.get())).toBe(true);
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
    const a = defineStore<Settings>("t.r1", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    a.set({ music: 0.3, sfx: 0.6 });
    const payload = a.serialize();
    expect(payload).toEqual({
      version: 1,
      data: { music: 0.3, sfx: 0.6 },
    });

    _clearStoreRegistryForTesting();
    const b = defineStore<Settings>("t.r1", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    b.hydrate(payload);
    expect(b.get()).toEqual({ music: 0.3, sfx: 0.6 });
  });

  it("throws StoreVersionTooNewError when stored version > current", () => {
    const s = defineStore<Settings>("t.too-new", {
      version: 1,
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    expect(() => s.hydrate({ version: 2, data: { music: 0, sfx: 0 } })).toThrow(
      StoreVersionTooNewError,
    );
  });

  it("throws StoreMigrationMissingError when older version and no migrate", () => {
    const s = defineStore<Settings>("t.no-migrate", {
      version: 2,
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    expect(() => s.hydrate({ version: 1, data: { music: 0 } })).toThrow(
      StoreMigrationMissingError,
    );
  });

  it("runs migrate() when stored version < current", () => {
    const migrate = vi.fn((old: unknown) => {
      const o = old as { music: number };
      return { music: o.music, sfx: 0.5 };
    });
    const s = defineStore<Settings>("t.migrate", {
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
    const s = defineStore<DateBag>("t.codec", {
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
    const t = defineStore<DateBag>("t.codec", {
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

  it("throws when defining two stores with the same id", () => {
    defineStore<Settings>("t.dupe", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    expect(() =>
      defineStore<Settings>("t.dupe", {
        defaults: () => ({ music: 0.8, sfx: 1.0 }),
      }),
    ).toThrow();
  });
});

describe("defineSet", () => {
  it("add/has/remove/clear", () => {
    const s = defineSet<string>("t.set.crud");
    expect(s.has("a")).toBe(false);
    s.add("a");
    s.add("b");
    expect(s.has("a")).toBe(true);
    expect(s.size()).toBe(2);
    s.remove("a");
    expect(s.has("a")).toBe(false);
    s.clear();
    expect(s.size()).toBe(0);
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
    expect([...b.values()].sort()).toEqual(["a", "b"]);
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
    expect([...s.values()].sort()).toEqual(["v2:a", "v2:b"]);
  });

  it("respects defaults factory", () => {
    const s = defineSet<string>("t.set.defaults", {
      defaults: () => ["seed"],
    });
    expect(s.has("seed")).toBe(true);
  });
});

describe("defineMap", () => {
  it("set/get/has/remove/clear", () => {
    const m = defineMap<string, number>("t.map.crud");
    expect(m.get("a")).toBeUndefined();
    m.set("a", 1);
    expect(m.get("a")).toBe(1);
    expect(m.size()).toBe(1);
    m.remove("a");
    expect(m.has("a")).toBe(false);
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

describe("_resetAllStoresForTesting", () => {
  it("resets every registered store back to defaults", () => {
    const s = defineStore<{ a: number }>("t.reset.a", {
      defaults: () => ({ a: 1 }),
    });
    const set = defineSet<string>("t.reset.b");
    const map = defineMap<string, number>("t.reset.c");
    const ctr = defineCounter("t.reset.d");

    s.set({ a: 99 });
    set.add("x");
    map.set("k", 1);
    ctr.set(7);

    _resetAllStoresForTesting();

    expect(s.get().a).toBe(1);
    expect(set.size()).toBe(0);
    expect(map.size()).toBe(0);
    expect(ctr.value()).toBe(0);
  });
});
