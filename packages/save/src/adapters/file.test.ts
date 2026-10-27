import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createRecord } from "@yagejs/core";
import { createSave, CorruptPayloadError, SlotNotFoundError } from "../Save.js";
import { fileAdapter } from "./file.js";
import type { SaveFileStore } from "./file.js";

const KEY = "run/s/a";
const OLD = JSON.stringify({ value: "old" });
const OTHER = JSON.stringify({ value: "other" });
const FRESH = JSON.stringify({ value: "fresh" });

/** A directory of files held in a `Map`. */
function memoryFileStore(): SaveFileStore & {
  readonly files: Map<string, string>;
} {
  const files = new Map<string, string>();
  return {
    files,
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, content) {
      files.set(name, content);
    },
    async delete(name) {
      files.delete(name);
    },
    async list() {
      return [...files.keys()];
    },
  };
}

/** A directory of real files, for the same checks over a file system. */
function diskFileStore(directory: string): SaveFileStore {
  return {
    async read(name) {
      try {
        return await readFile(join(directory, name), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async write(name, content) {
      await writeFile(join(directory, name), content, "utf8");
    },
    async delete(name) {
      try {
        await unlink(join(directory, name));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },
    async list() {
      return readdir(directory);
    },
  };
}

/** Counts the store operations and fails the chosen one, tearing a write. */
function trackingStore(raw: SaveFileStore): {
  store: SaveFileStore;
  calls: string[];
  fail(operation: number | null, fraction?: number): void;
} {
  let operations = 0;
  let failOperation: number | null = null;
  let fraction = 0;
  const calls: string[] = [];
  const step = (label: string): boolean => {
    calls.push(label);
    operations += 1;
    return operations === failOperation;
  };
  return {
    calls,
    fail(operation, tear = 0) {
      failOperation = operation;
      fraction = tear;
      operations = 0;
    },
    store: {
      async read(name) {
        if (step(`read ${name}`)) throw new Error("store read failed");
        return raw.read(name);
      },
      async write(name, content) {
        if (step(`write ${name}`)) {
          await raw.write(
            name,
            content.slice(0, Math.floor(content.length * fraction)),
          );
          throw new Error("store write failed");
        }
        return raw.write(name, content);
      },
      async delete(name) {
        if (step(`delete ${name}`)) throw new Error("store delete failed");
        return raw.delete(name);
      },
      async list() {
        if (step("list")) throw new Error("store list failed");
        return raw.list();
      },
    },
  };
}

/** The two file names the adapter gives {@link KEY}, read off a real write. */
let MAIN = "";
let SHADOW = "";
/** Intact file contents holding each test value. */
let intactOld = "";
let intactOther = "";

/** Half of a file's content: a write the storage cut off. */
const torn = (content: string): string =>
  content.slice(0, Math.floor(content.length / 2));

beforeAll(async () => {
  const store = memoryFileStore();
  const adapter = fileAdapter({ store });
  await adapter.write(KEY, OLD);
  MAIN = [...store.files.keys()][0] as string;
  SHADOW = MAIN.replace(/\.sav$/, ".new");
  intactOld = store.files.get(MAIN) as string;
  await adapter.write(KEY, OTHER);
  intactOther = store.files.get(MAIN) as string;
});

/** Every arrangement of the two files an interruption can leave behind. */
function startStates(): Array<{ name: string; files: Record<string, string> }> {
  return [
    { name: "absent", files: {} },
    { name: "main intact", files: { [MAIN]: intactOld } },
    { name: "torn shadow alone", files: { [SHADOW]: torn(intactOther) } },
    { name: "intact shadow alone", files: { [SHADOW]: intactOld } },
    {
      name: "main torn, shadow intact",
      files: { [MAIN]: torn(intactOther), [SHADOW]: intactOld },
    },
    {
      name: "main and shadow intact, same value",
      files: { [MAIN]: intactOld, [SHADOW]: intactOld },
    },
    {
      name: "main and shadow intact, different values",
      files: { [MAIN]: intactOld, [SHADOW]: intactOther },
    },
    {
      name: "main intact, shadow torn",
      files: { [MAIN]: intactOld, [SHADOW]: torn(intactOther) },
    },
    {
      name: "main torn, shadow torn",
      files: { [MAIN]: torn(intactOther), [SHADOW]: torn(intactOld) },
    },
  ];
}

async function seed(
  store: SaveFileStore,
  files: Record<string, string>,
): Promise<void> {
  for (const name of await store.list()) await store.delete(name);
  for (const [name, content] of Object.entries(files)) {
    await store.write(name, content);
  }
}

/**
 * Interrupt a write at every store operation and every tear point, from every
 * start state, and check that a reader only ever sees the value it saw before
 * the write or the value the write carried.
 */
async function checkWriteInterruptions(raw: SaveFileStore): Promise<void> {
  for (const state of startStates()) {
    for (const fraction of [0, 0.5, 0.99]) {
      for (const failOperation of [1, 2, 3, 4, 5, 6, null]) {
        await seed(raw, state.files);
        const before = await fileAdapter({ store: raw }).read(KEY);
        const tracked = trackingStore(raw);
        const adapter = fileAdapter({ store: tracked.store });
        tracked.fail(failOperation, fraction);
        let resolved = true;
        await adapter.write(KEY, FRESH).catch(() => {
          resolved = false;
        });
        tracked.fail(null);
        const after = await fileAdapter({ store: raw }).read(KEY);
        const label = `${state.name} / fail ${failOperation} / tear ${fraction}`;
        if (resolved) expect(after, label).toBe(FRESH);
        else expect([before, FRESH], label).toContain(after);
      }
    }
  }
}

describe("fileAdapter", () => {
  it("round-trips a value and removes it", async () => {
    const store = memoryFileStore();
    const adapter = fileAdapter({ store });

    await adapter.write(KEY, OLD);
    expect(await adapter.read(KEY)).toBe(OLD);
    expect(await adapter.list("run/")).toEqual([KEY]);

    await adapter.delete(KEY);
    expect(await adapter.read(KEY)).toBeNull();
    expect(await adapter.list("")).toEqual([]);
    expect(store.files.size).toBe(0);
  });

  it("names files from the key and keeps distinct keys apart", async () => {
    const store = memoryFileStore();
    const adapter = fileAdapter({ store });
    const keys = ["Run/s/a", "run/s/a", "a%b", "a:b", "ok 🎮", ""];
    for (const key of keys) await adapter.write(key, OLD);

    expect(store.files.size).toBe(keys.length);
    for (const name of store.files.keys()) {
      expect(name).toMatch(/^k-[a-z2-7]*\.sav$/);
    }
    expect((await adapter.list("")).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(await adapter.read(key)).toBe(OLD);
  });

  it("writes a 96-byte key and refuses to write a longer one", async () => {
    const store = memoryFileStore();
    const adapter = fileAdapter({ store });
    const longest = "k".repeat(96);
    await adapter.write(longest, OLD);
    expect(await adapter.read(longest)).toBe(OLD);
    expect([...store.files.keys()][0]).toHaveLength(160);

    const tracked = trackingStore(memoryFileStore());
    const guarded = fileAdapter({ store: tracked.store });
    const tooLong = "k".repeat(97);
    await expect(guarded.write(tooLong, OLD)).rejects.toThrow(
      "fileAdapter.write: key must be at most 96 bytes in UTF-8, got 97 " +
        `(${JSON.stringify(tooLong)}).`,
    );
    expect(tracked.calls).toEqual([]);
  });

  it("reads a longer key as absent and deletes it without touching the store", async () => {
    const tracked = trackingStore(memoryFileStore());
    const adapter = fileAdapter({ store: tracked.store });
    const tooLong = "k".repeat(97);
    expect(await adapter.read(tooLong)).toBeNull();
    await expect(adapter.delete(tooLong)).resolves.toBeUndefined();
    expect(tracked.calls).toEqual([]);
  });

  it("refuses a key or a value that is not a well-formed string", async () => {
    const tracked = trackingStore(memoryFileStore());
    const adapter = fileAdapter({ store: tracked.store });
    const lone = "a\uD800b";
    const keyMessage =
      "key must be a well-formed string, got a lone surrogate at index 1.";
    await expect(adapter.read(lone)).rejects.toThrow(
      `fileAdapter.read: ${keyMessage}`,
    );
    await expect(adapter.write(lone, OLD)).rejects.toThrow(
      `fileAdapter.write: ${keyMessage}`,
    );
    await expect(adapter.delete(lone)).rejects.toThrow(
      `fileAdapter.delete: ${keyMessage}`,
    );
    await expect(adapter.write(KEY, "a\uDC00")).rejects.toThrow(
      "fileAdapter.write: value must be a well-formed string, " +
        "got a lone surrogate at index 1.",
    );
    await expect(adapter.write(KEY, "end\uD800")).rejects.toThrow(
      "got a lone surrogate at index 3.",
    );
    expect(tracked.calls).toEqual([]);

    await adapter.write("pair \u{1F3AE}", OLD);
    expect(await adapter.read("pair \u{1F3AE}")).toBe(OLD);
  });

  it("list ignores files it did not write and filters by prefix", async () => {
    const store = memoryFileStore();
    const adapter = fileAdapter({ store });
    await adapter.write("run/s/a", OLD);
    await adapter.write("other/s/a", OLD);
    for (const name of [
      ".DS_Store",
      "notes.txt",
      "k-0.sav",
      "k-a.sav",
      "k-7b.sav",
      "k-74.sav",
    ]) {
      await store.write(name, "whatever");
    }

    expect((await adapter.list("")).sort()).toEqual(["other/s/a", "run/s/a"]);
    expect(await adapter.list("run/")).toEqual(["run/s/a"]);
  });

  it("an interrupted write leaves one of the two values readable", async () => {
    await checkWriteInterruptions(memoryFileStore());
  });

  it("an interrupted write over real files leaves one of the two readable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yage-save-"));
    try {
      await checkWriteInterruptions(diskFileStore(directory));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("a second interruption keeps the last written value", async () => {
    const raw = memoryFileStore();
    await seed(raw, { [MAIN]: intactOld });
    const tracked = trackingStore(raw);
    const adapter = fileAdapter({ store: tracked.store });

    // Killed while writing the main file: main torn, shadow holds the value.
    tracked.fail(3, 0.5);
    await expect(adapter.write(KEY, FRESH)).rejects.toThrow();
    // Killed while writing the shadow file of the next value.
    tracked.fail(4, 0.5);
    await expect(adapter.write(KEY, OTHER)).rejects.toThrow();

    tracked.fail(null);
    expect(await fileAdapter({ store: raw }).read(KEY)).toBe(FRESH);
  });

  it("an interrupted delete leaves the value or nothing", async () => {
    const raw = memoryFileStore();
    for (const state of startStates()) {
      for (const failOperation of [1, 2, 3, null]) {
        await seed(raw, state.files);
        const before = await fileAdapter({ store: raw }).read(KEY);
        const tracked = trackingStore(raw);
        const adapter = fileAdapter({ store: tracked.store });
        tracked.fail(failOperation);
        let resolved = true;
        await adapter.delete(KEY).catch(() => {
          resolved = false;
        });
        tracked.fail(null);
        const after = await fileAdapter({ store: raw }).read(KEY);
        const label = `${state.name} / fail ${failOperation}`;
        if (resolved) expect(after, label).toBeNull();
        else expect([before, null], label).toContain(after);
      }
    }
  });

  it("a delete killed after its first removal still reads the value", async () => {
    const raw = memoryFileStore();

    await seed(raw, { [MAIN]: torn(intactOther), [SHADOW]: intactOld });
    const torned = trackingStore(raw);
    torned.fail(3);
    await expect(
      fileAdapter({ store: torned.store }).delete(KEY),
    ).rejects.toThrow();
    expect(await fileAdapter({ store: raw }).read(KEY)).toBe(OLD);

    await seed(raw, { [MAIN]: intactOld, [SHADOW]: intactOther });
    const both = trackingStore(raw);
    both.fail(3);
    await expect(
      fileAdapter({ store: both.store }).delete(KEY),
    ).rejects.toThrow();
    expect(await fileAdapter({ store: raw }).read(KEY)).toBe(OLD);
  });

  it("two writes to one key never leave a mix", async () => {
    const raw = memoryFileStore();
    for (const failOperation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, null]) {
      await seed(raw, { [MAIN]: intactOld });
      const tracked = trackingStore(raw);
      const adapter = fileAdapter({ store: tracked.store });
      tracked.fail(failOperation, 0.5);
      const outcomes = await Promise.allSettled([
        adapter.write(KEY, FRESH),
        adapter.write(KEY, OTHER),
      ]);
      tracked.fail(null);
      const after = await fileAdapter({ store: raw }).read(KEY);
      const label = `fail ${failOperation}`;
      expect([OLD, FRESH, OTHER], label).toContain(after);
      if (outcomes[1].status === "fulfilled") expect(after, label).toBe(OTHER);
      else if (outcomes[0].status === "fulfilled") {
        expect([FRESH, OTHER], label).toContain(after);
      }
    }
  });

  it("a read issued behind an unawaited write sees the written value", async () => {
    const adapter = fileAdapter({ store: memoryFileStore() });
    const written = adapter.write(KEY, FRESH);
    expect(await adapter.read(KEY)).toBe(FRESH);
    await written;
  });

  it("both copies damaged reads as stored and loads as a corrupt payload", async () => {
    const raw = memoryFileStore();
    await seed(raw, { [MAIN]: torn(intactOther), [SHADOW]: torn(intactOld) });
    const adapter = fileAdapter({ store: raw });
    expect(await adapter.read(KEY)).toBe(torn(intactOther));

    const save = createSave({ adapter });
    const target = createRecord<{ value: string }>({
      default: () => ({ value: "" }),
    });
    await expect(save.loadSlot("run", "a", target)).rejects.toBeInstanceOf(
      CorruptPayloadError,
    );
    expect(await save.listSlots("run")).toEqual([]);
  });

  it("a shadow file alone counts only when it is intact", async () => {
    const raw = memoryFileStore();

    await seed(raw, { [SHADOW]: torn(intactOld) });
    expect(await fileAdapter({ store: raw }).read(KEY)).toBeNull();
    expect(await fileAdapter({ store: raw }).list("")).toEqual([]);

    await seed(raw, { [SHADOW]: intactOld });
    expect(await fileAdapter({ store: raw }).read(KEY)).toBe(OLD);
    expect(await fileAdapter({ store: raw }).list("")).toEqual([KEY]);
  });

  it("a file whose body was cut short does not count as intact", async () => {
    const raw = memoryFileStore();
    const header = intactOld.slice(0, intactOld.indexOf("\n") + 1);
    await seed(raw, { [MAIN]: `${header}{"val` });

    expect(await fileAdapter({ store: raw }).read(KEY)).toBe(`${header}{"val`);
  });

  it("a file whose content changed under its checksum is not intact", async () => {
    const raw = memoryFileStore();
    const header = intactOld.slice(0, intactOld.indexOf("\n") + 1);
    const edited = `${header}{"value":"xld"}`;
    await seed(raw, { [MAIN]: edited });

    expect(await fileAdapter({ store: raw }).read(KEY)).toBe(edited);
  });

  it("a rejected store write rejects the write and keeps the value", async () => {
    const raw = memoryFileStore();
    await seed(raw, { [MAIN]: intactOld });
    const tracked = trackingStore(raw);
    const adapter = fileAdapter({ store: tracked.store });

    tracked.fail(2);
    await expect(adapter.write(KEY, FRESH)).rejects.toThrow(
      "store write failed",
    );
    tracked.fail(null);
    expect(await adapter.read(KEY)).toBe(OLD);
  });

  it("a Save over the adapter saves, lists and deletes slots", async () => {
    const save = createSave({
      adapter: fileAdapter({ store: memoryFileStore() }),
    });
    const run = createRecord<{ chapter: number }>({
      default: () => ({ chapter: 1 }),
    });
    run.set({ chapter: 5 });
    await save.saveSlot("run", "manual-1", run, { metadata: { label: "A" } });

    expect(await save.listSlots("run")).toMatchObject([
      { name: "manual-1", metadata: { label: "A" } },
    ]);
    const loaded = createRecord<{ chapter: number }>({
      default: () => ({ chapter: 1 }),
    });
    await save.loadSlot("run", "manual-1", loaded);
    expect(loaded.get()).toEqual({ chapter: 5 });

    await save.deleteSlot("run", "manual-1");
    expect(await save.listSlots("run")).toEqual([]);
    await expect(
      save.loadSlot("run", "manual-1", loaded),
    ).rejects.toBeInstanceOf(SlotNotFoundError);
  });

  it("a Save over the adapter finds no slot under a name over the key budget", async () => {
    const save = createSave({
      adapter: fileAdapter({ store: memoryFileStore() }),
    });
    const run = createRecord<{ chapter: number }>({
      default: () => ({ chapter: 1 }),
    });
    // "run/s/" and 91 letters make a 97-byte key.
    const name = "n".repeat(91);
    await expect(save.loadSlot("run", name, run)).rejects.toBeInstanceOf(
      SlotNotFoundError,
    );
    await expect(save.deleteSlot("run", name)).resolves.toBeUndefined();
  });
});
