import { describe, it, expect, vi } from "vitest";
import {
  createRecord,
  createSet,
  createMap,
  createCounter,
  createStore,
} from "@yagejs/core";
import {
  createSave,
  SlotNotFoundError,
  StoreMigrationMissingError,
  StoreVersionTooNewError,
} from "./Save.js";
import { memoryAdapter } from "./adapters/memory.js";

describe("Save — unslotted persist/restore", () => {
  it("persists and restores an object store", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });

    interface Settings {
      music: number;
      sfx: number;
    }

    const a = createRecord<Settings>({
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    a.set({ music: 0.3 });
    await save.persist("settings", a);

    const b = createRecord<Settings>({
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    expect(b.get()).toEqual({ music: 0.8, sfx: 1.0 });
    await save.restore("settings", b);
    expect(b.get()).toEqual({ music: 0.3, sfx: 1.0 });
  });

  it("restore is a no-op when no document exists", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = createRecord<{ a: number }>({ defaults: () => ({ a: 1 }) });
    await save.restore("none", s);
    expect(s.get()).toEqual({ a: 1 });
  });

  it("Promise.all restores every store", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });

    const a = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    const b = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    a.set({ v: 7 });
    b.set({ v: 9 });
    await Promise.all([save.persist("a", a), save.persist("b", b)]);

    const a2 = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    const b2 = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    await Promise.all([save.restore("a", a2), save.restore("b", b2)]);
    expect(a2.get().v).toBe(7);
    expect(b2.get().v).toBe(9);
  });

  it("works with createSet", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const opened = createSet<string>();
    opened.add("chest-1");
    opened.add("chest-2");
    await save.persist("world.opened", opened);

    const opened2 = createSet<string>();
    await save.restore("world.opened", opened2);
    expect(opened2.has("chest-1")).toBe(true);
    expect(opened2.has("chest-2")).toBe(true);
  });

  it("works with createMap", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const enemies = createMap<string, number>();
    enemies.set("a", 1);
    enemies.set("b", 2);
    await save.persist("world.enemies", enemies);

    const enemies2 = createMap<string, number>();
    await save.restore("world.enemies", enemies2);
    expect(enemies2.get("a")).toBe(1);
    expect(enemies2.get("b")).toBe(2);
  });

  it("works with createCounter", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const c = createCounter();
    c.set(7);
    await save.persist("rest", c);

    const c2 = createCounter();
    await save.restore("rest", c2);
    expect(c2.value()).toBe(7);
  });
});

describe("Save — slots", () => {
  interface Run {
    chapter: number;
    coins: number;
  }
  const make = () =>
    createRecord<Run>({ defaults: () => ({ chapter: 1, coins: 0 }) });

  it("saves and loads a slot round-trip", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = make();
    a.set({ chapter: 3, coins: 42 });
    await save.saveSlot("run", "manual-1", a);

    const b = make();
    expect(b.get()).toEqual({ chapter: 1, coins: 0 });
    await save.loadSlot("run", "manual-1", b);
    expect(b.get()).toEqual({ chapter: 3, coins: 42 });
  });

  it("loadSlot throws SlotNotFoundError for missing slot", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = make();
    await expect(save.loadSlot("run", "nope", s)).rejects.toBeInstanceOf(
      SlotNotFoundError,
    );
  });

  it("listSlots returns slot info with savedAt and metadata", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = make();
    interface Meta {
      label: string;
      playtime: number;
    }
    const before = Date.now();
    await save.saveSlot<Run, Meta>("run", "manual-1", s, {
      metadata: { label: "Forest", playtime: 60 },
    });
    await save.saveSlot("run", "auto", s);
    const after = Date.now();

    const slots = await save.listSlots<Meta>("run");
    expect(slots).toHaveLength(2);

    const named = slots.find((x) => x.name === "manual-1");
    expect(named?.metadata).toEqual({ label: "Forest", playtime: 60 });
    expect(named?.savedAt).toBeGreaterThanOrEqual(before);
    expect(named?.savedAt).toBeLessThanOrEqual(after);

    const auto = slots.find((x) => x.name === "auto");
    expect(auto?.metadata).toBeUndefined();
  });

  it("listSlots filters by prefix", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = make();
    await save.saveSlot("run", "alice/manual-1", s);
    await save.saveSlot("run", "alice/auto", s);
    await save.saveSlot("run", "bob/manual-1", s);

    const aliceSlots = await save.listSlots("run", { prefix: "alice/" });
    expect(aliceSlots.map((x) => x.name).sort()).toEqual([
      "alice/auto",
      "alice/manual-1",
    ]);
  });

  it("deleteSlot removes the slot data and manifest entry", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = make();
    await save.saveSlot("run", "manual-1", s);
    await save.saveSlot("run", "manual-2", s);

    await save.deleteSlot("run", "manual-1");

    const slots = await save.listSlots("run");
    expect(slots.map((x) => x.name)).toEqual(["manual-2"]);

    await expect(save.loadSlot("run", "manual-1", s)).rejects.toBeInstanceOf(
      SlotNotFoundError,
    );
  });

  it("saveSlot updates manifest savedAt on subsequent saves", async () => {
    vi.useFakeTimers();
    try {
      const save = createSave({ adapter: memoryAdapter() });
      const s = make();
      vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));
      await save.saveSlot("run", "manual-1", s);
      const first = (await save.listSlots("run"))[0]?.savedAt;

      vi.setSystemTime(new Date("2026-05-03T00:01:00Z"));
      await save.saveSlot("run", "manual-1", s);
      const second = (await save.listSlots("run"))[0]?.savedAt;

      expect(second).toBeGreaterThan(first as number);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Save — autoPersist", () => {
  // Yield to the microtask queue: queueMicrotask -> Promise resolution.
  const flushMicrotasks = () => Promise.resolve();

  it("persists after a microtask boundary", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const writeSpy = vi.spyOn(save.adapter, "write");

    const s = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    const stop = save.autoPersist("ap1", s);

    s.set({ v: 1 });
    expect(writeSpy).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);

    stop();
  });

  it("collapses multiple synchronous sets into one write", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const writeSpy = vi.spyOn(save.adapter, "write");

    const s = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    const stop = save.autoPersist("ap2", s);

    s.set({ v: 1 });
    s.set({ v: 2 });
    s.set({ v: 3 });
    await flushMicrotasks();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    stop();
  });

  it("writes the latest value after coalescing", async () => {
    const save = createSave({ adapter: memoryAdapter() });

    const s = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    const stop = save.autoPersist("ap3", s);

    s.set({ v: 1 });
    s.set({ v: 7 });
    await flushMicrotasks();

    const t = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    await save.restore("ap3", t);
    expect(t.get().v).toBe(7);
    stop();
  });

  it("stop() cancels a pending write", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const writeSpy = vi.spyOn(save.adapter, "write");

    const s = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    const stop = save.autoPersist("ap4", s);
    s.set({ v: 1 });
    stop();
    await flushMicrotasks();

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("coalesces N rapid leaf mutations on a compound into one write", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const writeSpy = vi.spyOn(save.adapter, "write");

    const game = createStore((s) => ({
      gold: s.counter({ default: 0 }),
      inv: s.map<string, number>(),
      flags: s.set<string>(),
    }));
    const stop = save.autoPersist("ap.compound", game);

    game.gold.increment(1);
    game.gold.increment(1);
    game.inv.set("a", 1);
    game.inv.set("b", 2);
    game.flags.add("x");
    game.flags.add("y");

    expect(writeSpy).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    stop();
  });

  it("compound round-trip restores every leaf", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = createStore((s) => ({
      gold: s.counter({ default: 0 }),
      flags: s.set<string>(),
    }));
    a.gold.set(42);
    a.flags.add("opened-chest");
    await save.persist("rt.compound", a);

    const b = createStore((s) => ({
      gold: s.counter({ default: 0 }),
      flags: s.set<string>(),
    }));
    await save.restore("rt.compound", b);
    expect(b.gold.value()).toBe(42);
    expect(b.flags.has("opened-chest")).toBe(true);
  });
});

describe("Save — migration on load", () => {
  it("runs migrate when stored version < current", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });

    interface V1 {
      score: number;
    }
    interface V2 {
      score: number;
      level: number;
    }

    const a = createRecord<V1>({ defaults: () => ({ score: 0 }) });
    a.set({ score: 5 });
    await save.persist("g", a, { version: 1 });

    const b = createRecord<V2>({ defaults: () => ({ score: 0, level: 1 }) });
    await save.restore("g", b, {
      version: 2,
      migrate: (old) => {
        const o = old as V1;
        return { score: o.score, level: 1 };
      },
    });
    expect(b.get()).toEqual({ score: 5, level: 1 });
  });

  it("runs migrate on loadSlot when stored version < current", async () => {
    const save = createSave({ adapter: memoryAdapter() });

    interface V1 {
      score: number;
    }
    interface V2 {
      score: number;
      multiplier: number;
    }

    const a = createRecord<V1>({ defaults: () => ({ score: 0 }) });
    a.set({ score: 11 });
    await save.saveSlot("slot-mig", "manual-1", a, { version: 1 });

    const b = createRecord<V2>({
      defaults: () => ({ score: 0, multiplier: 1 }),
    });
    await save.loadSlot("slot-mig", "manual-1", b, {
      version: 2,
      migrate: (old) => {
        const o = old as V1;
        return { score: o.score, multiplier: 2 };
      },
    });
    expect(b.get()).toEqual({ score: 11, multiplier: 2 });
  });

  it("throws StoreVersionTooNewError when stored version > current", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    a.set({ v: 1 });
    await save.persist("too-new", a, { version: 2 });

    const b = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    await expect(
      save.restore("too-new", b, { version: 1 }),
    ).rejects.toBeInstanceOf(StoreVersionTooNewError);
  });

  it("throws StoreMigrationMissingError on older payload without migrate", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = createSet<string>();
    a.add("x");
    await save.persist("set-no-mig", a, { version: 1 });

    const b = createSet<string>();
    await expect(
      save.restore("set-no-mig", b, { version: 2 }),
    ).rejects.toBeInstanceOf(StoreMigrationMissingError);
  });

  it("createCounter hydrate runs migrate on older version", async () => {
    const save = createSave({ adapter: memoryAdapter() });

    const a = createCounter();
    a.set(7);
    await save.persist("ctr-mig", a, { version: 1 });

    const b = createCounter();
    await save.restore("ctr-mig", b, {
      version: 2,
      migrate: (old) => (old as number) * 10,
    });
    expect(b.value()).toBe(70);
  });

  it("compound migrate return type is enforced per leaf shape (compile-time)", () => {
    const save = createSave({ adapter: memoryAdapter() });
    // Sanity check: well-typed migrate compiles and runs.
    const game = createStore((s) => ({
      flag: s.value<boolean>({ default: false }),
    }));
    return save.restore("compile-check", game, {
      version: 2,
      migrate: () => ({ flag: { value: true } }),
    });
  });
});

describe("Save — listSlots / deleteSlot edge cases", () => {
  it("listSlots returns empty array when no manifest exists", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    expect(await save.listSlots("ls-empty")).toEqual([]);
  });

  it("deleteSlot is a no-op when slot doesn't exist", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    await expect(save.deleteSlot("ds-missing", "nope")).resolves.toBeUndefined();
  });
});

describe("Save — key disambiguation", () => {
  it("a doc and a same-named slot don't collide", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    a.set({ v: 1 });
    await save.persist("collide.a", a);
    await save.saveSlot("collide.a", "v", a);

    const b = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    a.set({ v: 99 });
    await save.persist("collide.a", a);
    await save.loadSlot("collide.a", "v", b);
    expect(b.get().v).toBe(1);
  });

  it("store ids and slot names with reserved characters round-trip", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    a.set({ v: 7 });
    await save.saveSlot("alice/profile:v2", "alice/manual:1", a);

    const b = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    await save.loadSlot("alice/profile:v2", "alice/manual:1", b);
    expect(b.get().v).toBe(7);
  });

  it("slot named the same as the manifest tag works", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    a.set({ v: 5 });
    await save.saveSlot("sn", "m", a);
    const slots = await save.listSlots("sn");
    expect(slots.map((s) => s.name)).toContain("m");

    const b = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    await save.loadSlot("sn", "m", b);
    expect(b.get().v).toBe(5);
  });

  it("rejects empty store id and empty slot name", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const empty = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    await expect(save.persist("", empty)).rejects.toThrow(/non-empty/i);

    const ok = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    await expect(save.saveSlot("ok", "", ok)).rejects.toThrow(/non-empty/i);
  });
});

describe("Save — manifest serialization across concurrent updates", () => {
  it("concurrent saveSlots both land in the manifest", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    await Promise.all([
      save.saveSlot("concur", "a", s, { metadata: { tag: "a" } }),
      save.saveSlot("concur", "b", s, { metadata: { tag: "b" } }),
      save.saveSlot("concur", "c", s, { metadata: { tag: "c" } }),
    ]);
    const slots = await save.listSlots<{ tag: string }>("concur");
    expect(slots.map((x) => x.name).sort()).toEqual(["a", "b", "c"]);
    expect(slots.map((x) => x.metadata?.tag).sort()).toEqual(["a", "b", "c"]);
  });

  it("concurrent saveSlot + deleteSlot serialize correctly", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    await save.saveSlot("concur-del", "old", s);
    await Promise.all([
      save.deleteSlot("concur-del", "old"),
      save.saveSlot("concur-del", "new", s),
    ]);
    const slots = await save.listSlots("concur-del");
    expect(slots.map((x) => x.name)).toEqual(["new"]);
  });
});

describe("Save — autoPersist serialization", () => {
  it("commits the latest state even when the adapter is slow", async () => {
    // Slow async adapter — every write blocks on a deferred we can release
    // from the test, so we can interleave changes around an in-flight write.
    const pending: Array<() => void> = [];
    const seenWrites: string[] = [];
    const slowAdapter = {
      ...memoryAdapter(),
      async write(_key: string, value: string) {
        seenWrites.push(value);
        await new Promise<void>((resolve) => {
          pending.push(resolve);
        });
      },
    };
    const save = createSave({ adapter: slowAdapter });

    const s = createRecord<{ v: number }>({ defaults: () => ({ v: 0 }) });
    const stop = save.autoPersist("ap-slow", s);

    const flushMicrotasks = async (): Promise<void> => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    };

    s.set({ v: 1 });
    await flushMicrotasks();

    s.set({ v: 2 });
    s.set({ v: 3 });

    pending.shift()?.();
    await flushMicrotasks();

    pending.shift()?.();
    await flushMicrotasks();

    stop();

    const last = seenWrites[seenWrites.length - 1];
    expect(last).toBeDefined();
    expect(JSON.parse(last as string).data).toEqual({ v: 3 });
  });
});
