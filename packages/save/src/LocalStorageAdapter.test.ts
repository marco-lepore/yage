import { describe, it, expect, beforeEach } from "vitest";
import { LocalStorageSaveStorage } from "./LocalStorageAdapter.js";

/** Minimal localStorage stub — no jsdom needed. */
function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
}

describe("LocalStorageSaveStorage", () => {
  let storage: LocalStorageSaveStorage;

  beforeEach(() => {
    const stub = createLocalStorageStub();
    Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });
    storage = new LocalStorageSaveStorage();
  });

  it("load returns null for missing key", () => {
    expect(storage.load("missing")).toBeNull();
  });

  it("save/load round-trips a string", () => {
    storage.save("key", "value");
    expect(storage.load("key")).toBe("value");
  });

  it("delete removes a key", () => {
    storage.save("key", "value");
    storage.delete("key");
    expect(storage.load("key")).toBeNull();
  });

  it("list returns all stored keys", () => {
    storage.save("a", "1");
    storage.save("b", "2");
    expect(storage.list()).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("list with prefix filters keys", () => {
    storage.save("yage:snapshot:quick", "1");
    storage.save("yage:data:profile", "2");
    storage.save("other:key", "3");

    expect(storage.list("yage:")).toEqual(
      expect.arrayContaining(["yage:snapshot:quick", "yage:data:profile"]),
    );
    expect(storage.list("yage:")).not.toContain("other:key");
  });
});
