import { afterEach, describe, expect, it } from "vitest";
import { capacitorFileStore } from "./fileStore.js";
import { files, resetCapacitor } from "./test/fakeCapacitor.js";

const store = capacitorFileStore("yage-saves/test");

afterEach(() => {
  resetCapacitor();
});

describe("capacitorFileStore", () => {
  it("reads back what it wrote", async () => {
    await store.write("k-abc.sav", "payload");
    expect(await store.read("k-abc.sav")).toBe("payload");
    expect(files.content.get("yage-saves/test/k-abc.sav")).toBe("payload");
  });

  it("writes into the app's Library directory as text, making the path", async () => {
    await store.write("k-abc.sav", "payload");
    expect(files.calls).toEqual([
      {
        method: "writeFile",
        options: {
          path: "yage-saves/test/k-abc.sav",
          directory: "LIBRARY",
          encoding: "utf8",
          data: "payload",
          recursive: true,
        },
      },
    ]);
  });

  it("reads and lists through the same directory", async () => {
    await store.write("k-abc.sav", "payload");
    files.calls = [];
    await store.read("k-abc.sav");
    await store.list();
    expect(files.calls).toEqual([
      {
        method: "readFile",
        options: {
          path: "yage-saves/test/k-abc.sav",
          directory: "LIBRARY",
          encoding: "utf8",
        },
      },
      {
        method: "readdir",
        options: { path: "yage-saves/test", directory: "LIBRARY" },
      },
    ]);
  });

  it("treats a file that was never written as absent", async () => {
    expect(await store.read("k-abc.sav")).toBeNull();
    await expect(store.delete("k-abc.sav")).resolves.toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("lists the names in its own directory", async () => {
    await store.write("k-abc.sav", "one");
    await store.write("k-abd.new", "two");
    expect((await store.list()).sort()).toEqual(["k-abc.sav", "k-abd.new"]);
  });

  it("removes a file", async () => {
    await store.write("k-abc.sav", "payload");
    await store.delete("k-abc.sav");
    expect(await store.read("k-abc.sav")).toBeNull();
  });

  it("passes on every failure that is not a missing file", async () => {
    await store.write("k-abc.sav", "payload");
    for (const method of ["readFile", "deleteFile", "readdir"]) {
      files.failing = new Set([method]);
      const call =
        method === "readFile"
          ? store.read("k-abc.sav")
          : method === "deleteFile"
            ? store.delete("k-abc.sav")
            : store.list();
      await expect(call).rejects.toBe(files.failure);
    }
    files.failing = new Set(["writeFile"]);
    await expect(store.write("k-abc.sav", "x")).rejects.toBe(files.failure);
  });

  it("states what the plugin returned when it is not text", async () => {
    await store.write("k-abc.sav", "payload");
    files.data = { size: 7 };
    await expect(store.read("k-abc.sav")).rejects.toThrow(
      "capacitorFileStore.read: the Filesystem plugin returned object data " +
        'for "k-abc.sav", expected a string.',
    );
  });

  it("refuses a name it never wrote, before it calls the plugin", async () => {
    for (const name of ["../x", "A.sav", ""]) {
      await expect(store.read(name)).rejects.toThrow(
        `capacitorFileStore.read: name must match ^[a-z0-9-][a-z0-9.-]*$, ` +
          `got ${JSON.stringify(name)}.`,
      );
      await expect(store.write(name, "x")).rejects.toThrow(
        `capacitorFileStore.write: name must match ^[a-z0-9-][a-z0-9.-]*$, ` +
          `got ${JSON.stringify(name)}.`,
      );
      await expect(store.delete(name)).rejects.toThrow(
        `capacitorFileStore.delete: name must match ^[a-z0-9-][a-z0-9.-]*$, ` +
          `got ${JSON.stringify(name)}.`,
      );
    }
    expect(files.calls).toEqual([]);
  });
});
