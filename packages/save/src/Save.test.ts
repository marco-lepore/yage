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
  CorruptPayloadError,
  InvalidKeyError,
} from "./Save.js";
import type { SaveAdapter } from "./Save.js";
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
      default: () => ({ music: 0.8, sfx: 1.0 }),
    });
    a.set({ music: 0.3 });
    await save.persist("settings", a);

    const b = createRecord<Settings>({
      default: () => ({ music: 0.8, sfx: 1.0 }),
    });
    expect(b.get()).toEqual({ music: 0.8, sfx: 1.0 });
    await save.restore("settings", b);
    expect(b.get()).toEqual({ music: 0.3, sfx: 1.0 });
  });

  it("restore is a no-op when no document exists", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = createRecord<{ a: number }>({ default: () => ({ a: 1 }) });
    await save.restore("none", s);
    expect(s.get()).toEqual({ a: 1 });
  });

  it("Promise.all restores every store", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });

    const a = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    const b = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    a.set({ v: 7 });
    b.set({ v: 9 });
    await Promise.all([save.persist("a", a), save.persist("b", b)]);

    const a2 = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    const b2 = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
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
    createRecord<Run>({ default: () => ({ chapter: 1, coins: 0 }) });

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

  it("saveSlot stores the value as it was at the call", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = make();
    a.set({ chapter: 2, coins: 5 });
    const saving = save.saveSlot("run", "auto", a);
    a.set({ chapter: 9, coins: 0 });
    await saving;

    const b = make();
    await save.loadSlot("run", "auto", b);
    expect(b.get()).toEqual({ chapter: 2, coins: 5 });
  });

  it("a slot named like an Object.prototype member round-trips and lists", async () => {
    // A slot name is one segment of its storage key and never a property name
    // on an object, so `__proto__` and the other inherited member names are
    // stored, listed, loaded and deleted like any other name.
    const save = createSave({ adapter: memoryAdapter() });
    for (const name of ["__proto__", "constructor", "toString"]) {
      const a = make();
      a.set({ chapter: 7, coins: 1 });
      await save.saveSlot("run", name, a);
    }

    const listed = (await save.listSlots("run")).map((s) => s.name).sort();
    expect(listed).toEqual(["__proto__", "constructor", "toString"]);

    const b = make();
    await save.loadSlot("run", "__proto__", b);
    expect(b.get()).toEqual({ chapter: 7, coins: 1 });

    await save.deleteSlot("run", "__proto__");
    expect((await save.listSlots("run")).map((s) => s.name).sort()).toEqual([
      "constructor",
      "toString",
    ]);
    await expect(
      save.loadSlot("run", "__proto__", make()),
    ).rejects.toBeInstanceOf(SlotNotFoundError);
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

  it("deleteSlot removes the slot", async () => {
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

  it("saveSlot updates savedAt on subsequent saves", async () => {
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

    const s = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
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

    const s = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
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

    const s = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    const stop = save.autoPersist("ap3", s);

    s.set({ v: 1 });
    s.set({ v: 7 });
    await flushMicrotasks();

    const t = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    await save.restore("ap3", t);
    expect(t.get().v).toBe(7);
    stop();
  });

  it("stop() cancels a pending write", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const writeSpy = vi.spyOn(save.adapter, "write");

    const s = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
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

    const a = createRecord<V1>({ default: () => ({ score: 0 }) });
    a.set({ score: 5 });
    await save.persist("g", a, { version: 1 });

    const b = createRecord<V2>({ default: () => ({ score: 0, level: 1 }) });
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

    const a = createRecord<V1>({ default: () => ({ score: 0 }) });
    a.set({ score: 11 });
    await save.saveSlot("slot-mig", "manual-1", a, { version: 1 });

    const b = createRecord<V2>({
      default: () => ({ score: 0, multiplier: 1 }),
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
    const a = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    a.set({ v: 1 });
    await save.persist("too-new", a, { version: 2 });

    const b = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
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

  it("compound migrate return type is enforced per leaf shape", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    // Seed a v1 payload so restore actually invokes migrate (otherwise the
    // missing-document branch returns early and the assertion below is a lie).
    const seed = createStore((s) => ({
      flag: s.value<boolean>({ default: false }),
    }));
    await save.persist("compile-check", seed, { version: 1 });

    const game = createStore((s) => ({
      flag: s.value<boolean>({ default: false }),
    }));
    await save.restore("compile-check", game, {
      version: 2,
      // Return type matches each leaf's encoded form — `{ value: boolean }`
      // for a value leaf, not bare boolean. TS catches mis-shaped returns at
      // this call site.
      migrate: () => ({ flag: { value: true } }),
    });
    expect(game.flag.get()).toBe(true);
  });
});

describe("Save — corrupt payloads", () => {
  it("restore throws CorruptPayloadError on a payload missing version/data", async () => {
    const adapter = memoryAdapter();
    // Write a raw value that isn't a version envelope — simulates a legacy
    // payload or a key written by something other than `Save`.
    await adapter.write("corrupt/d", JSON.stringify({ unrelated: 1 }));
    const save = createSave({ adapter });
    const r = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    await expect(save.restore("corrupt", r)).rejects.toBeInstanceOf(
      CorruptPayloadError,
    );
  });

  it("restore throws CorruptPayloadError on a non-object payload", async () => {
    const adapter = memoryAdapter();
    await adapter.write("nullpay/d", "null");
    const save = createSave({ adapter });
    const r = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    await expect(save.restore("nullpay", r)).rejects.toBeInstanceOf(
      CorruptPayloadError,
    );
  });
});

describe("Save — listSlots / deleteSlot edge cases", () => {
  it("listSlots returns an empty array for a store with no slots", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    expect(await save.listSlots("ls-empty")).toEqual([]);
  });

  it("deleteSlot is a no-op when slot doesn't exist", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    await expect(
      save.deleteSlot("ds-missing", "nope"),
    ).resolves.toBeUndefined();
  });
});

describe("Save — key disambiguation", () => {
  it("a doc and a same-named slot don't collide", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    a.set({ v: 1 });
    await save.persist("collide.a", a);
    await save.saveSlot("collide.a", "v", a);

    const b = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    a.set({ v: 99 });
    await save.persist("collide.a", a);
    await save.loadSlot("collide.a", "v", b);
    expect(b.get().v).toBe(1);
  });

  it("store ids and slot names with reserved characters round-trip", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    a.set({ v: 7 });
    await save.saveSlot("alice/profile:v2", "alice/manual:1", a);

    const b = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    await save.loadSlot("alice/profile:v2", "alice/manual:1", b);
    expect(b.get().v).toBe(7);
  });

  it("slot named the same as the manifest tag works", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const a = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    a.set({ v: 5 });
    await save.saveSlot("sn", "m", a);
    const slots = await save.listSlots("sn");
    expect(slots.map((s) => s.name)).toContain("m");

    const b = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    await save.loadSlot("sn", "m", b);
    expect(b.get().v).toBe(5);
  });

  it("rejects empty store id and empty slot name", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const empty = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    await expect(save.persist("", empty)).rejects.toThrow(/non-empty/i);

    const ok = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    await expect(save.saveSlot("ok", "", ok)).rejects.toThrow(/non-empty/i);
    expect(() => save.autoPersist("", ok)).toThrow(InvalidKeyError);
  });
});

describe("Save — concurrent slot operations", () => {
  it("concurrent saveSlots all appear in the listing", async () => {
    const save = createSave({ adapter: memoryAdapter() });
    const s = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
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
    const s = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
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

    const s = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
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

describe("Save — slot documents", () => {
  const make = () =>
    createRecord<{ chapter: number }>({ default: () => ({ chapter: 1 }) });

  it("saveSlot writes one key and deleteSlot deletes one", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });
    const writeSpy = vi.spyOn(adapter, "write");
    const deleteSpy = vi.spyOn(adapter, "delete");

    await save.saveSlot("run", "manual-1", make());
    expect(writeSpy.mock.calls.map((c) => c[0])).toEqual(["run/s/manual-1"]);
    expect(await adapter.list("")).toEqual(["run/s/manual-1"]);

    await save.deleteSlot("run", "manual-1");
    expect(deleteSpy.mock.calls.map((c) => c[0])).toEqual(["run/s/manual-1"]);
    expect(await adapter.list("")).toEqual([]);
  });

  it("a slot document holds the payload, the time and the metadata", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });
    const s = make();
    s.set({ chapter: 4 });

    await save.saveSlot("run", "with", s, { metadata: { label: "Forest" } });
    await save.saveSlot("run", "without", s);

    const withMeta = JSON.parse((await adapter.read("run/s/with")) as string);
    expect(Object.keys(withMeta).sort()).toEqual([
      "data",
      "metadata",
      "savedAt",
      "version",
    ]);
    expect(withMeta.data).toEqual({ chapter: 4 });
    expect(withMeta.version).toBe(1);
    expect(withMeta.metadata).toEqual({ label: "Forest" });

    const plain = JSON.parse((await adapter.read("run/s/without")) as string);
    expect(Object.hasOwn(plain, "metadata")).toBe(false);
  });

  it("listSlots returns the newest first and equal times in name order", async () => {
    vi.useFakeTimers();
    try {
      const save = createSave({ adapter: memoryAdapter() });
      const s = make();
      vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));
      await save.saveSlot("run", "b", s);
      await save.saveSlot("run", "a", s);
      vi.setSystemTime(new Date("2026-05-03T00:01:00Z"));
      await save.saveSlot("run", "c", s);

      expect((await save.listSlots("run")).map((x) => x.name)).toEqual([
        "c",
        "a",
        "b",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a rejected slot write leaves the previous document", async () => {
    const base = memoryAdapter();
    let failing = false;
    const adapter: SaveAdapter = {
      ...base,
      async write(key, value) {
        if (failing) throw new Error("storage full");
        return base.write(key, value);
      },
    };
    const save = createSave({ adapter });
    const s = make();
    s.set({ chapter: 2 });
    await save.saveSlot("run", "a", s, { metadata: { take: 1 } });
    const first = (await save.listSlots("run"))[0]?.savedAt;

    failing = true;
    s.set({ chapter: 9 });
    await expect(
      save.saveSlot("run", "a", s, { metadata: { take: 2 } }),
    ).rejects.toThrow("storage full");

    const slots = await save.listSlots("run");
    expect(slots).toEqual([
      { name: "a", savedAt: first, metadata: { take: 1 } },
    ]);
    const loaded = make();
    await save.loadSlot("run", "a", loaded);
    expect(loaded.get()).toEqual({ chapter: 2 });
  });

  it("listSlots leaves out a damaged document and lists the others", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });
    await save.saveSlot("run", "good", make());
    await adapter.write("run/s/not-json", "{");
    await adapter.write("run/s/not-object", "7");
    await adapter.write(
      "run/s/no-version",
      JSON.stringify({ data: 1, savedAt: 1 }),
    );
    await adapter.write(
      "run/s/no-data",
      JSON.stringify({ version: 1, savedAt: 1 }),
    );
    await adapter.write(
      "run/s/text-time",
      JSON.stringify({ version: 1, data: 1, savedAt: "yesterday" }),
    );
    await adapter.write(
      "run/s/endless",
      '{"version":1,"data":1,"savedAt":1e999}',
    );

    expect((await save.listSlots("run")).map((x) => x.name)).toEqual(["good"]);
  });

  it("listSlots rejects with the adapter's error when a read fails", async () => {
    const base = memoryAdapter();
    const adapter: SaveAdapter = {
      ...base,
      async read(key) {
        if (key === "run/s/b") throw new Error("disk unreadable");
        return base.read(key);
      },
    };
    const save = createSave({ adapter });
    await base.write(
      "run/s/a",
      JSON.stringify({ version: 1, data: 1, savedAt: 1 }),
    );
    await base.write(
      "run/s/b",
      JSON.stringify({ version: 1, data: 1, savedAt: 2 }),
    );

    await expect(save.listSlots("run")).rejects.toThrow("disk unreadable");
  });

  it("bytes that are not JSON are a CorruptPayloadError", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });
    await adapter.write("doc/d", '{"version":1,"data":{"v":');
    await adapter.write("doc/s/a", "\u0000\u0000\u0000");

    const target = createRecord<{ v: number }>({ default: () => ({ v: 0 }) });
    const docError = await save.restore("doc", target).catch((e: unknown) => e);
    expect(docError).toBeInstanceOf(CorruptPayloadError);
    expect((docError as CorruptPayloadError).storeId).toBe("doc");
    expect((docError as Error).message).toContain("bytes are not JSON");

    const slotError = await save
      .loadSlot("doc", "a", target)
      .catch((e: unknown) => e);
    expect(slotError).toBeInstanceOf(CorruptPayloadError);
    expect((slotError as Error).message).toContain("bytes are not JSON");
  });
});

describe("Save — slots saved by an earlier layout", () => {
  const make = () =>
    createRecord<{ chapter: number }>({ default: () => ({ chapter: 1 }) });

  /** A store holding two slot documents and the earlier details record. */
  async function seedEarlierLayout(adapter: SaveAdapter): Promise<void> {
    await adapter.write(
      "run/s/a",
      JSON.stringify({ version: 1, data: { chapter: 1 } }),
    );
    await adapter.write(
      "run/s/b",
      JSON.stringify({ version: 1, data: { chapter: 2 } }),
    );
    await adapter.write(
      "run/m",
      JSON.stringify({
        version: 1,
        slots: {
          a: { name: "a", savedAt: 100 },
          b: { name: "b", savedAt: 200, metadata: { label: "B" } },
          "": { name: "", savedAt: 300 },
          c: { name: "c", savedAt: 400 },
          d: "not an entry",
          e: { name: "e" },
        },
      }),
    );
  }

  it("merges the earlier details into the slot documents once", async () => {
    const adapter = memoryAdapter();
    await seedEarlierLayout(adapter);
    const save = createSave({ adapter });

    const slots = await save.listSlots("run");
    expect(slots).toEqual([
      { name: "b", savedAt: 200, metadata: { label: "B" } },
      { name: "a", savedAt: 100 },
    ]);
    expect(JSON.parse((await adapter.read("run/s/a")) as string)).toEqual({
      version: 1,
      savedAt: 100,
      data: { chapter: 1 },
    });
    expect(
      JSON.parse((await adapter.read("run/s/b")) as string).metadata,
    ).toEqual({ label: "B" });
    expect(await adapter.read("run/m")).toBeNull();

    const writeSpy = vi.spyOn(adapter, "write");
    const deleteSpy = vi.spyOn(adapter, "delete");
    await save.listSlots("run");
    expect(writeSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("an interrupted merge leaves the details record and runs again", async () => {
    const base = memoryAdapter();
    await seedEarlierLayout(base);
    let failingKey: string | null = "run/s/b";
    const adapter: SaveAdapter = {
      ...base,
      async write(key, value) {
        if (key === failingKey) throw new Error("disk full");
        return base.write(key, value);
      },
    };
    const save = createSave({ adapter });

    await expect(save.listSlots("run")).rejects.toThrow("disk full");
    expect(await base.read("run/m")).not.toBeNull();

    failingKey = null;
    const writeSpy = vi.spyOn(adapter, "write");
    const slots = await save.listSlots("run");
    expect(writeSpy.mock.calls.map((c) => c[0])).toEqual(["run/s/b"]);
    expect(await base.read("run/m")).toBeNull();
    expect(slots.map((x) => x.name)).toEqual(["b", "a"]);
  });

  it("the merge keeps details a slot document already carries", async () => {
    const adapter = memoryAdapter();
    await adapter.write(
      "run/s/a",
      JSON.stringify({
        version: 1,
        savedAt: 900,
        metadata: { label: "kept" },
        data: { chapter: 3 },
      }),
    );
    await adapter.write(
      "run/m",
      JSON.stringify({
        version: 1,
        slots: { a: { name: "a", savedAt: 100, metadata: { label: "old" } } },
      }),
    );
    const save = createSave({ adapter });

    expect(await save.listSlots("run")).toEqual([
      { name: "a", savedAt: 900, metadata: { label: "kept" } },
    ]);
  });

  it("saveSlot and deleteSlot wait for the merge", async () => {
    const base = memoryAdapter();
    await seedEarlierLayout(base);
    const calls: string[] = [];
    const adapter: SaveAdapter = {
      async read(key) {
        calls.push(`read ${key}`);
        return base.read(key);
      },
      async write(key, value) {
        calls.push(`write ${key}`);
        return base.write(key, value);
      },
      async delete(key) {
        calls.push(`delete ${key}`);
        return base.delete(key);
      },
      async list(prefix) {
        return base.list(prefix);
      },
    };
    const save = createSave({ adapter });

    await Promise.all([
      save.listSlots("run"),
      save.saveSlot("run", "fresh", make()),
      save.deleteSlot("run", "a"),
    ]);

    expect(calls.indexOf("write run/s/fresh")).toBeGreaterThan(
      calls.indexOf("write run/s/b"),
    );
    expect(calls.indexOf("delete run/s/a")).toBeGreaterThan(
      calls.indexOf("delete run/m"),
    );
  });

  it("an unreadable details record stays and the store keeps working", async () => {
    const adapter = memoryAdapter();
    await adapter.write("run/m", "{broken");
    await adapter.write(
      "run/s/old",
      JSON.stringify({ version: 1, data: { chapter: 1 } }),
    );
    const save = createSave({ adapter });

    await save.saveSlot("run", "fresh", make());
    expect((await save.listSlots("run")).map((x) => x.name)).toEqual(["fresh"]);
    expect(await adapter.read("run/m")).toBe("{broken");
  });

  it("a details record of an unexpected shape stays and contributes nothing", async () => {
    const adapter = memoryAdapter();
    await adapter.write("one/m", "null");
    await adapter.write("two/m", JSON.stringify({ version: 1 }));
    const save = createSave({ adapter });

    expect(await save.listSlots("one")).toEqual([]);
    expect(await save.listSlots("two")).toEqual([]);
    expect(await adapter.read("one/m")).toBe("null");
    expect(await adapter.read("two/m")).not.toBeNull();
  });

  it("a slot the details record does not name stays loadable", async () => {
    const adapter = memoryAdapter();
    await seedEarlierLayout(adapter);
    await adapter.write(
      "run/s/hidden",
      JSON.stringify({ version: 1, data: { chapter: 7 } }),
    );
    const save = createSave({ adapter });

    expect((await save.listSlots("run")).map((x) => x.name)).toEqual([
      "b",
      "a",
    ]);
    const loaded = make();
    await save.loadSlot("run", "hidden", loaded);
    expect(loaded.get()).toEqual({ chapter: 7 });
  });

  it("the merge skips a slot document it cannot read as a payload", async () => {
    const adapter = memoryAdapter();
    await adapter.write("run/s/not-json", "{truncated");
    await adapter.write("run/s/not-object", "7");
    await adapter.write("run/s/no-version", JSON.stringify({ data: 1 }));
    await adapter.write("run/s/no-data", JSON.stringify({ version: 1 }));
    await adapter.write(
      "run/m",
      JSON.stringify({
        version: 1,
        slots: {
          "not-json": { name: "not-json", savedAt: 100 },
          "not-object": { name: "not-object", savedAt: 101 },
          "no-version": { name: "no-version", savedAt: 102 },
          "no-data": { name: "no-data", savedAt: 103 },
        },
      }),
    );
    const save = createSave({ adapter });

    expect(await save.listSlots("run")).toEqual([]);
    expect(await adapter.read("run/s/not-json")).toBe("{truncated");
    expect(await adapter.read("run/m")).toBeNull();
  });

  it("listSlots skips a key whose name does not decode", async () => {
    const adapter = memoryAdapter();
    await adapter.write(
      "run/s/%zz",
      JSON.stringify({ version: 1, data: 1, savedAt: 1 }),
    );
    const save = createSave({ adapter });
    await save.saveSlot("run", "good", createRecord({ default: () => ({}) }));

    expect((await save.listSlots("run")).map((x) => x.name)).toEqual(["good"]);
  });

  it("loadSlot reads a slot of the earlier layout without merging", async () => {
    const adapter = memoryAdapter();
    await seedEarlierLayout(adapter);
    const save = createSave({ adapter });
    const readSpy = vi.spyOn(adapter, "read");

    const loaded = make();
    await save.loadSlot("run", "a", loaded);
    expect(loaded.get()).toEqual({ chapter: 1 });
    expect(readSpy.mock.calls.map((c) => c[0])).toEqual(["run/s/a"]);
    expect(await adapter.read("run/m")).not.toBeNull();
  });
});

describe("Save — reported automatic writes", () => {
  /** Let the microtask queue and one macrotask turn drain. */
  const settle = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));

  const counter = () =>
    createRecord<{ v: number }>({ default: () => ({ v: 0 }) });

  /** Collect the rejections nothing in the process awaited. */
  function watchUnhandled(): {
    readonly seen: unknown[];
    restore: () => void;
  } {
    const seen: unknown[] = [];
    const others = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const listener = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", listener);
    return {
      seen,
      restore() {
        process.off("unhandledRejection", listener);
        for (const other of others) process.on("unhandledRejection", other);
      },
    };
  }

  it("a failed write nothing awaits is an unhandled rejection", async () => {
    const boom = new Error("write refused");
    const adapter: SaveAdapter = {
      ...memoryAdapter(),
      async write() {
        throw boom;
      },
    };
    const save = createSave({ adapter });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled = watchUnhandled();
    try {
      const s = counter();
      const stop = save.autoPersist("ap", s);
      s.set({ v: 1 });
      await settle();

      expect(unhandled.seen).toEqual([boom]);
      expect(errorSpy).not.toHaveBeenCalled();

      const failure = await save.flush().catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([boom]);
      expect((failure as Error).message).toBe(
        'Save.flush: automatic writes failed for "ap".',
      );
      stop();
    } finally {
      unhandled.restore();
      errorSpy.mockRestore();
    }
  });

  it("a failure reaches a waiting flush and is reported once", async () => {
    const boom = new Error("write refused");
    const release: Array<() => void> = [];
    const adapter: SaveAdapter = {
      ...memoryAdapter(),
      async write() {
        await new Promise<void>((resolve) => release.push(resolve));
        throw boom;
      },
    };
    const save = createSave({ adapter });
    const unhandled = watchUnhandled();
    try {
      const s = counter();
      const stop = save.autoPersist("ap", s);
      s.set({ v: 1 });
      const flushed = save.flush();
      await settle();
      release.shift()?.();

      await expect(flushed).rejects.toBeInstanceOf(AggregateError);
      await settle();
      expect(unhandled.seen).toEqual([]);
      stop();
    } finally {
      unhandled.restore();
    }
  });

  it("a later successful write clears the failure", async () => {
    const base = memoryAdapter();
    let failing = true;
    const adapter: SaveAdapter = {
      ...base,
      async write(key, value) {
        if (failing) throw new Error("write refused");
        return base.write(key, value);
      },
    };
    const save = createSave({ adapter });
    const s = counter();
    const stop = save.autoPersist("ap", s);

    s.set({ v: 1 });
    await expect(save.flush()).rejects.toBeInstanceOf(AggregateError);

    failing = false;
    s.set({ v: 2 });
    await expect(save.flush()).resolves.toBeUndefined();
    stop();
  });

  it("a failure a later write in the same run supersedes is not reported", async () => {
    const base = memoryAdapter();
    const release: Array<() => void> = [];
    let writes = 0;
    const adapter: SaveAdapter = {
      ...base,
      async write(key, value) {
        writes += 1;
        if (writes === 1) {
          await new Promise<void>((resolve) => release.push(resolve));
          throw new Error("write refused");
        }
        return base.write(key, value);
      },
    };
    const save = createSave({ adapter });
    const unhandled = watchUnhandled();
    try {
      const s = counter();
      const stop = save.autoPersist("ap", s);
      s.set({ v: 1 });
      await settle();
      s.set({ v: 2 });
      release.shift()?.();
      await settle();

      expect(writes).toBe(2);
      expect(unhandled.seen).toEqual([]);
      await expect(save.flush()).resolves.toBeUndefined();
      stop();
    } finally {
      unhandled.restore();
    }
  });

  it("flush waits for the in-flight write and for a change just made", async () => {
    const seen: string[] = [];
    const release: Array<() => void> = [];
    const adapter: SaveAdapter = {
      ...memoryAdapter(),
      async write(_key, value) {
        seen.push(value);
        await new Promise<void>((resolve) => release.push(resolve));
      },
    };
    const save = createSave({ adapter });
    const s = counter();
    const stop = save.autoPersist("ap", s);

    s.set({ v: 1 });
    await settle();
    expect(seen).toHaveLength(1);

    s.set({ v: 2 });
    let done = false;
    const flushed = save.flush().then(() => {
      done = true;
    });
    release.shift()?.();
    await settle();
    expect(done).toBe(false);
    expect(seen).toHaveLength(2);
    release.shift()?.();
    await flushed;
    expect(JSON.parse(seen[1] as string).data).toEqual({ v: 2 });

    s.set({ v: 3 });
    let secondDone = false;
    const second = save.flush().then(() => {
      secondDone = true;
    });
    await settle();
    expect(secondDone).toBe(false);
    expect(seen).toHaveLength(3);
    release.shift()?.();
    await second;
    stop();
  });

  it("a change after stop writes nothing", async () => {
    const adapter = memoryAdapter();
    const save = createSave({ adapter });
    const writeSpy = vi.spyOn(adapter, "write");
    const s = counter();
    const stop = save.autoPersist("ap", s);

    stop();
    s.set({ v: 1 });
    await settle();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("flush resolves with no registrations and ignores a stopped one", async () => {
    const adapter: SaveAdapter = {
      ...memoryAdapter(),
      async write() {
        throw new Error("write refused");
      },
    };
    const save = createSave({ adapter });
    await expect(save.flush()).resolves.toBeUndefined();

    const s = counter();
    const stop = save.autoPersist("ap", s);
    s.set({ v: 1 });
    await expect(save.flush()).rejects.toBeInstanceOf(AggregateError);

    stop();
    await expect(save.flush()).resolves.toBeUndefined();
  });

  it("flush reports every failing store in registration order", async () => {
    const first = new Error("one refused");
    const second = new Error("two refused");
    const adapter: SaveAdapter = {
      ...memoryAdapter(),
      async write(key) {
        throw key.startsWith("a1") ? first : second;
      },
    };
    const save = createSave({ adapter });
    const a = counter();
    const b = counter();
    const stopA = save.autoPersist("a1", a);
    const stopB = save.autoPersist("a2", b);

    a.set({ v: 1 });
    b.set({ v: 1 });
    const failure = await save.flush().catch((e: unknown) => e);
    expect((failure as AggregateError).errors).toEqual([first, second]);
    expect((failure as Error).message).toBe(
      'Save.flush: automatic writes failed for "a1", "a2".',
    );
    stopA();
    stopB();
  });
});
