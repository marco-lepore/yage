// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { LocalStorageSaveStorage } from "./LocalStorageAdapter.js";

describe("LocalStorageSaveStorage", () => {
  let storage: LocalStorageSaveStorage;

  beforeEach(() => {
    localStorage.clear();
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
