import { describe, it, expect } from "vitest";
import {
  getProperty,
  getPropertyArray,
  resolveObjectRef,
  resolveObjectRefArray,
} from "./properties.js";
import type { MapObject, HasProperties } from "./types.js";

function makeObj(properties: HasProperties["properties"] = []): HasProperties {
  return { properties };
}

function makeMapObject(
  id: number,
  name: string,
  properties?: HasProperties["properties"],
): MapObject {
  return {
    id,
    name,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    properties,
  };
}

describe("getProperty", () => {
  it("returns value for existing property", () => {
    const obj = makeObj([{ name: "health", type: "int", value: 100 }]);
    expect(getProperty<number>(obj, "health")).toBe(100);
  });

  it("returns undefined for missing property", () => {
    const obj = makeObj([{ name: "health", type: "int", value: 100 }]);
    expect(getProperty(obj, "mana")).toBeUndefined();
  });

  it("returns undefined when properties array is missing", () => {
    expect(getProperty({}, "health")).toBeUndefined();
  });

  it("returns string values", () => {
    const obj = makeObj([{ name: "label", type: "string", value: "hello" }]);
    expect(getProperty<string>(obj, "label")).toBe("hello");
  });

  it("returns boolean values", () => {
    const obj = makeObj([{ name: "locked", type: "bool", value: true }]);
    expect(getProperty<boolean>(obj, "locked")).toBe(true);
  });
});

describe("getPropertyArray", () => {
  it("collects pseudo-array properties in order", () => {
    const obj = makeObj([
      { name: "items[0]", type: "string", value: "sword" },
      { name: "items[2]", type: "string", value: "shield" },
      { name: "items[1]", type: "string", value: "bow" },
    ]);
    const result = getPropertyArray<string>(obj, "items");
    expect(result[0]).toBe("sword");
    expect(result[1]).toBe("bow");
    expect(result[2]).toBe("shield");
  });

  it("returns empty array when no matching properties", () => {
    const obj = makeObj([{ name: "health", type: "int", value: 100 }]);
    expect(getPropertyArray(obj, "items")).toEqual([]);
  });

  it("returns empty array when properties is undefined", () => {
    expect(getPropertyArray({}, "items")).toEqual([]);
  });

  it("doesn't match similar but wrong names", () => {
    const obj = makeObj([
      { name: "items[0]", type: "string", value: "sword" },
      { name: "items_extra[0]", type: "string", value: "nope" },
      { name: "items", type: "string", value: "nope" },
    ]);
    const result = getPropertyArray<string>(obj, "items");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("sword");
  });

  it("handles sparse arrays", () => {
    const obj = makeObj([
      { name: "vals[0]", type: "int", value: 10 },
      { name: "vals[3]", type: "int", value: 40 },
    ]);
    const result = getPropertyArray<number>(obj, "vals");
    expect(result[0]).toBe(10);
    expect(result[1]).toBeUndefined();
    expect(result[2]).toBeUndefined();
    expect(result[3]).toBe(40);
  });
});

describe("resolveObjectRef", () => {
  it("resolves object ID to MapObject", () => {
    const target = makeMapObject(42, "door");
    const obj = makeObj([{ name: "target", type: "object", value: 42 }]);
    const result = resolveObjectRef(obj, "target", [
      makeMapObject(1, "wall"),
      target,
    ]);
    expect(result).toBe(target);
  });

  it("returns undefined for missing property", () => {
    const result = resolveObjectRef(makeObj(), "target", [
      makeMapObject(1, "wall"),
    ]);
    expect(result).toBeUndefined();
  });

  it("returns undefined when referenced object not found", () => {
    const obj = makeObj([{ name: "target", type: "object", value: 999 }]);
    const result = resolveObjectRef(obj, "target", [makeMapObject(1, "wall")]);
    expect(result).toBeUndefined();
  });
});

describe("resolveObjectRefArray", () => {
  it("resolves array of object IDs", () => {
    const a = makeMapObject(10, "a");
    const b = makeMapObject(20, "b");
    const c = makeMapObject(30, "c");
    const obj = makeObj([
      { name: "targets[0]", type: "object", value: 10 },
      { name: "targets[1]", type: "object", value: 30 },
    ]);
    const result = resolveObjectRefArray(obj, "targets", [a, b, c]);
    expect(result).toEqual([a, c]);
  });

  it("filters out unresolved references", () => {
    const a = makeMapObject(10, "a");
    const obj = makeObj([
      { name: "targets[0]", type: "object", value: 10 },
      { name: "targets[1]", type: "object", value: 999 },
    ]);
    const result = resolveObjectRefArray(obj, "targets", [a]);
    expect(result).toEqual([a]);
  });

  it("returns empty array when no properties match", () => {
    const result = resolveObjectRefArray(makeObj(), "targets", []);
    expect(result).toEqual([]);
  });
});
