import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeFileStore } from "./nodeFileStore.js";

let parent: string;
let directory: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "yage-store-"));
  directory = join(parent, "saves", "test");
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

describe("nodeFileStore", () => {
  it("creates the directory with the first write", async () => {
    const store = nodeFileStore(directory);
    await store.write("k-abc.sav", "value");
    expect(await readFile(join(directory, "k-abc.sav"), "utf8")).toBe("value");
    await store.write("k-abc.sav", "next");
    expect(await store.read("k-abc.sav")).toBe("next");
  });

  it("creates the directory again after the player removes it", async () => {
    const store = nodeFileStore(directory);
    await store.write("k-abc.sav", "value");
    await rm(directory, { recursive: true });

    await store.write("k-abc.sav", "next");

    expect(await store.read("k-abc.sav")).toBe("next");
  });

  it("reports an absent file, directory and removal as nothing stored", async () => {
    const store = nodeFileStore(directory);
    expect(await store.read("k-abc.sav")).toBeNull();
    expect(await store.list()).toEqual([]);
    await expect(store.delete("k-abc.sav")).resolves.toBeUndefined();
  });

  it("lists what it wrote and forgets what it removed", async () => {
    const store = nodeFileStore(directory);
    await store.write("k-abc.sav", "a");
    await store.write("k-abd.new", "b");
    expect((await store.list()).sort()).toEqual(["k-abc.sav", "k-abd.new"]);
    await store.delete("k-abd.new");
    expect(await store.list()).toEqual(["k-abc.sav"]);
  });

  it("reports a failure the directory itself caused", async () => {
    const store = nodeFileStore(directory);
    await mkdir(join(directory, "k-abc.sav"), { recursive: true });
    await expect(store.read("k-abc.sav")).rejects.toThrowError(/EISDIR/);
    await expect(store.delete("k-abc.sav")).rejects.toThrowError(
      /EPERM|EISDIR/,
    );

    const file = join(parent, "a-file");
    await writeFile(file, "", "utf8");
    await expect(nodeFileStore(file).list()).rejects.toThrowError(/ENOTDIR/);
  });

  it("refuses a name it could not have written", async () => {
    const store = nodeFileStore(directory);
    for (const name of ["../x", "A.sav", "", ".hidden", "a/b"]) {
      await expect(store.read(name)).rejects.toThrowError(
        `nodeFileStore.read: name must match ^[a-z0-9-][a-z0-9.-]*$, got ${JSON.stringify(name)}.`,
      );
      await expect(store.write(name, "v")).rejects.toThrowError(
        /^nodeFileStore\.write: name must match/,
      );
      await expect(store.delete(name)).rejects.toThrowError(
        /^nodeFileStore\.delete: name must match/,
      );
    }
    expect(await store.list()).toEqual([]);
  });
});
