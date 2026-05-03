import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  defineStore,
  defineSet,
  defineMap,
  defineCounter,
  _clearStoreRegistryForTesting,
} from "@yagejs/core";
import { createSave, SlotNotFoundError } from "./Save.js";
import { memoryAdapter } from "./adapters/memory.js";

beforeEach(() => {
  _clearStoreRegistryForTesting();
});

describe("Save — unslotted persist/restore", () => {
  it("persists and restores an object store", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });

    interface Settings {
      music: number;
      sfx: number;
    }

    const a = defineStore<Settings>("settings", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    a.set({ music: 0.3 });
    await save.persist(a);

    _clearStoreRegistryForTesting();
    const b = defineStore<Settings>("settings", {
      defaults: () => ({ music: 0.8, sfx: 1.0 }),
    });
    expect(b.get()).toEqual({ music: 0.8, sfx: 1.0 });
    await save.restore(b);
    expect(b.get()).toEqual({ music: 0.3, sfx: 1.0 });
  });

  it("restore is a no-op when no document exists", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = defineStore<{ a: number }>("none", { defaults: () => ({ a: 1 }) });
    await save.restore(s);
    expect(s.get()).toEqual({ a: 1 });
  });

  it("restoreAll restores every store", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });

    const a = defineStore<{ v: number }>("a", { defaults: () => ({ v: 0 }) });
    const b = defineStore<{ v: number }>("b", { defaults: () => ({ v: 0 }) });
    a.set({ v: 7 });
    b.set({ v: 9 });
    await Promise.all([save.persist(a), save.persist(b)]);

    _clearStoreRegistryForTesting();
    const a2 = defineStore<{ v: number }>("a", { defaults: () => ({ v: 0 }) });
    const b2 = defineStore<{ v: number }>("b", { defaults: () => ({ v: 0 }) });
    await save.restoreAll([a2, b2]);
    expect(a2.get().v).toBe(7);
    expect(b2.get().v).toBe(9);
  });

  it("works with defineSet", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const opened = defineSet<string>("world.opened");
    opened.add("chest-1");
    opened.add("chest-2");
    await save.persist(opened);

    _clearStoreRegistryForTesting();
    const opened2 = defineSet<string>("world.opened");
    await save.restore(opened2);
    expect(opened2.has("chest-1")).toBe(true);
    expect(opened2.has("chest-2")).toBe(true);
  });

  it("works with defineMap", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const enemies = defineMap<string, number>("world.enemies");
    enemies.set("a", 1);
    enemies.set("b", 2);
    await save.persist(enemies);

    _clearStoreRegistryForTesting();
    const enemies2 = defineMap<string, number>("world.enemies");
    await save.restore(enemies2);
    expect(enemies2.get("a")).toBe(1);
    expect(enemies2.get("b")).toBe(2);
  });

  it("works with defineCounter", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const c = defineCounter("rest");
    c.set(7);
    await save.persist(c);

    _clearStoreRegistryForTesting();
    const c2 = defineCounter("rest");
    await save.restore(c2);
    expect(c2.value()).toBe(7);
  });
});

describe("Save — slots", () => {
  interface Run {
    chapter: number;
    coins: number;
  }
  const make = () =>
    defineStore<Run>("run", {
      defaults: () => ({ chapter: 1, coins: 0 }),
    });

  it("saves and loads a slot round-trip", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = make();
    a.set({ chapter: 3, coins: 42 });
    await save.saveSlot(a, "manual-1");

    _clearStoreRegistryForTesting();
    const b = make();
    expect(b.get()).toEqual({ chapter: 1, coins: 0 });
    await save.loadSlot(b, "manual-1");
    expect(b.get()).toEqual({ chapter: 3, coins: 42 });
  });

  it("loadSlot throws SlotNotFoundError for missing slot", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = make();
    await expect(save.loadSlot(s, "nope")).rejects.toBeInstanceOf(
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
    await save.saveSlot<Meta>(s, "manual-1", {
      metadata: { label: "Forest", playtime: 60 },
    });
    await save.saveSlot(s, "auto");
    const after = Date.now();

    const slots = await save.listSlots<Meta>(s);
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
    await save.saveSlot(s, "alice/manual-1");
    await save.saveSlot(s, "alice/auto");
    await save.saveSlot(s, "bob/manual-1");

    const aliceSlots = await save.listSlots(s, { prefix: "alice/" });
    expect(aliceSlots.map((x) => x.name).sort()).toEqual([
      "alice/auto",
      "alice/manual-1",
    ]);
  });

  it("deleteSlot removes the slot data and manifest entry", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = make();
    await save.saveSlot(s, "manual-1");
    await save.saveSlot(s, "manual-2");

    await save.deleteSlot(s, "manual-1");

    const slots = await save.listSlots(s);
    expect(slots.map((x) => x.name)).toEqual(["manual-2"]);

    await expect(save.loadSlot(s, "manual-1")).rejects.toBeInstanceOf(
      SlotNotFoundError,
    );
  });

  it("saveSlot updates manifest savedAt on subsequent saves", async () => {
    vi.useFakeTimers();
    try {
      const save = createSave({ adapter: memoryAdapter() });
      const s = make();
      vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));
      await save.saveSlot(s, "manual-1");
      const first = (await save.listSlots(s))[0]?.savedAt;

      vi.setSystemTime(new Date("2026-05-03T00:01:00Z"));
      await save.saveSlot(s, "manual-1");
      const second = (await save.listSlots(s))[0]?.savedAt;

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

    const s = defineStore<{ v: number }>("ap1", { defaults: () => ({ v: 0 }) });
    const stop = save.autoPersist(s);

    s.set({ v: 1 });
    expect(writeSpy).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(writeSpy).toHaveBeenCalledTimes(1);

    stop();
  });

  it("collapses multiple synchronous sets into one write", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const writeSpy = vi.spyOn(save.adapter, "write");

    const s = defineStore<{ v: number }>("ap2", { defaults: () => ({ v: 0 }) });
    const stop = save.autoPersist(s);

    s.set({ v: 1 });
    s.set({ v: 2 });
    s.set({ v: 3 });
    await flushMicrotasks();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    stop();
  });

  it("writes the latest value after coalescing", async () => {
    const save = createSave({ adapter: memoryAdapter() });

    const s = defineStore<{ v: number }>("ap3", { defaults: () => ({ v: 0 }) });
    const stop = save.autoPersist(s);

    s.set({ v: 1 });
    s.set({ v: 7 });
    await flushMicrotasks();

    _clearStoreRegistryForTesting();
    const t = defineStore<{ v: number }>("ap3", { defaults: () => ({ v: 0 }) });
    await save.restore(t);
    expect(t.get().v).toBe(7);
    stop();
  });

  it("stop() cancels a pending write", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const writeSpy = vi.spyOn(save.adapter, "write");

    const s = defineStore<{ v: number }>("ap4", { defaults: () => ({ v: 0 }) });
    const stop = save.autoPersist(s);
    s.set({ v: 1 });
    stop();
    await flushMicrotasks();

    expect(writeSpy).not.toHaveBeenCalled();
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

    const a = defineStore<V1>("g", {
      version: 1,
      defaults: () => ({ score: 0 }),
    });
    a.set({ score: 5 });
    await save.persist(a);

    _clearStoreRegistryForTesting();

    const b = defineStore<V2>("g", {
      version: 2,
      defaults: () => ({ score: 0, level: 1 }),
      migrate: (old) => {
        const o = old as V1;
        return { score: o.score, level: 1 };
      },
    });
    await save.restore(b);
    expect(b.get()).toEqual({ score: 5, level: 1 });
  });

  it("runs migrate on loadSlot when stored version < current", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });

    interface V1 {
      score: number;
    }
    interface V2 {
      score: number;
      multiplier: number;
    }

    const a = defineStore<V1>("slot-mig", {
      version: 1,
      defaults: () => ({ score: 0 }),
    });
    a.set({ score: 11 });
    await save.saveSlot(a, "manual-1");

    _clearStoreRegistryForTesting();

    const b = defineStore<V2>("slot-mig", {
      version: 2,
      defaults: () => ({ score: 0, multiplier: 1 }),
      migrate: (old) => {
        const o = old as V1;
        return { score: o.score, multiplier: 2 };
      },
    });
    await save.loadSlot(b, "manual-1");
    expect(b.get()).toEqual({ score: 11, multiplier: 2 });
  });

  it("defineSet hydrate runs migrate on older version", async () => {
    const save = createSave({ adapter: memoryAdapter() });

    const a = defineSet<string>("set-mig", { version: 1 });
    a.add("a");
    a.add("b");
    await save.persist(a);

    _clearStoreRegistryForTesting();

    const b = defineSet<string>("set-mig", {
      version: 2,
      migrate: (old) => {
        const arr = old as string[];
        return new Set(arr.map((s) => s.toUpperCase()));
      },
    });
    await save.restore(b);
    expect([...b.values()].sort()).toEqual(["A", "B"]);
  });

  it("defineSet hydrate throws StoreMigrationMissingError on older version without migrate", async () => {
    const save = createSave({ adapter: memoryAdapter() });

    const a = defineSet<string>("set-no-mig", { version: 1 });
    await save.persist(a);

    _clearStoreRegistryForTesting();
    const b = defineSet<string>("set-no-mig", { version: 2 });
    await expect(save.restore(b)).rejects.toThrow(/migration/i);
  });

  it("defineCounter hydrate runs migrate on older version", async () => {
    const save = createSave({ adapter: memoryAdapter() });

    const a = defineCounter("ctr-mig", { version: 1 });
    a.set(7);
    await save.persist(a);

    _clearStoreRegistryForTesting();
    const b = defineCounter("ctr-mig", {
      version: 2,
      migrate: (old) => (old as number) * 10,
    });
    await save.restore(b);
    expect(b.value()).toBe(70);
  });
});

describe("Save — listSlots / deleteSlot edge cases", () => {
  it("listSlots returns empty array when no manifest exists", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = defineStore<{ v: number }>("ls-empty", {
      defaults: () => ({ v: 0 }),
    });
    expect(await save.listSlots(s)).toEqual([]);
  });

  it("deleteSlot is a no-op when slot doesn't exist", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = defineStore<{ v: number }>("ds-missing", {
      defaults: () => ({ v: 0 }),
    });
    await expect(save.deleteSlot(s, "nope")).resolves.toBeUndefined();
  });
});

describe("Save — key disambiguation", () => {
  // Regression coverage for the collision class: pathological store ids and
  // slot names that previously could overwrite each other now end up in
  // distinct namespaces because every user segment is encoded.
  it("a doc and a same-named slot don't collide", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = defineStore<{ v: number }>("collide.a", {
      defaults: () => ({ v: 0 }),
    });
    a.set({ v: 1 });
    await save.persist(a);
    await save.saveSlot(a, "v");

    _clearStoreRegistryForTesting();
    const b = defineStore<{ v: number }>("collide.a", {
      defaults: () => ({ v: 0 }),
    });
    a.set({ v: 99 });
    await save.persist(a);
    await save.loadSlot(b, "v");
    expect(b.get().v).toBe(1);
  });

  it("store ids and slot names with reserved characters round-trip", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    // `:` and `/` previously had structural meaning in adapter keys; encoded
    // segments make them transparent to the storage layer.
    const a = defineStore<{ v: number }>("alice/profile:v2", {
      defaults: () => ({ v: 0 }),
    });
    a.set({ v: 7 });
    await save.saveSlot(a, "alice/manual:1");

    _clearStoreRegistryForTesting();
    const b = defineStore<{ v: number }>("alice/profile:v2", {
      defaults: () => ({ v: 0 }),
    });
    await save.loadSlot(b, "alice/manual:1");
    expect(b.get().v).toBe(7);
  });

  it("slot named the same as the manifest tag works", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = defineStore<{ v: number }>("sn", { defaults: () => ({ v: 0 }) });
    a.set({ v: 5 });
    // Pathological slot name that equals our manifest tag — now just a
    // regular encoded segment.
    await save.saveSlot(a, "m");
    const slots = await save.listSlots(a);
    expect(slots.map((s) => s.name)).toContain("m");

    _clearStoreRegistryForTesting();
    const b = defineStore<{ v: number }>("sn", { defaults: () => ({ v: 0 }) });
    await save.loadSlot(b, "m");
    expect(b.get().v).toBe(5);
  });

  it("rejects empty store id and empty slot name", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const empty = defineStore<{ v: number }>("", {
      defaults: () => ({ v: 0 }),
    });
    await expect(save.persist(empty)).rejects.toThrow(/non-empty/i);

    const ok = defineStore<{ v: number }>("ok", { defaults: () => ({ v: 0 }) });
    await expect(save.saveSlot(ok, "")).rejects.toThrow(/non-empty/i);
  });
});

describe("Save — manifest serialization across concurrent updates", () => {
  // Two concurrent saveSlot calls would previously read-modify-write the
  // manifest with a last-writer-wins race. The per-store queue serializes
  // them.
  it("concurrent saveSlots both land in the manifest", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = defineStore<{ v: number }>("concur", {
      defaults: () => ({ v: 0 }),
    });
    await Promise.all([
      save.saveSlot(s, "a", { metadata: { tag: "a" } }),
      save.saveSlot(s, "b", { metadata: { tag: "b" } }),
      save.saveSlot(s, "c", { metadata: { tag: "c" } }),
    ]);
    const slots = await save.listSlots<{ tag: string }>(s);
    expect(slots.map((x) => x.name).sort()).toEqual(["a", "b", "c"]);
    expect(slots.map((x) => x.metadata?.tag).sort()).toEqual(["a", "b", "c"]);
  });

  it("concurrent saveSlot + deleteSlot serialize correctly", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = defineStore<{ v: number }>("concur-del", {
      defaults: () => ({ v: 0 }),
    });
    await save.saveSlot(s, "old");
    // Race: delete the existing "old" slot while creating a new "new" slot.
    await Promise.all([save.deleteSlot(s, "old"), save.saveSlot(s, "new")]);
    const slots = await save.listSlots(s);
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

    const s = defineStore<{ v: number }>("ap-slow", {
      defaults: () => ({ v: 0 }),
    });
    const stop = save.autoPersist(s);

    const flushMicrotasks = async (): Promise<void> => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    };

    s.set({ v: 1 });
    await flushMicrotasks(); // schedule + start first write

    s.set({ v: 2 });
    s.set({ v: 3 });

    // Release the first (in-flight) write — should re-flush with the latest
    // dirty state (v: 3) rather than the captured v: 1.
    pending.shift()?.();
    await flushMicrotasks();

    // Release the second write so the chain can settle.
    pending.shift()?.();
    await flushMicrotasks();

    stop();

    const last = seenWrites[seenWrites.length - 1];
    expect(last).toBeDefined();
    expect(JSON.parse(last as string).data).toEqual({ v: 3 });
  });
});
