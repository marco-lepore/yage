/* eslint-disable @typescript-eslint/no-extraneous-class -- Empty classes are decorator test targets */
import { describe, it, expect } from "vitest";
import {
  serializable,
  SERIALIZABLE_KEY,
  SerializableRegistry,
  isSerializable,
  getSerializableType,
} from "./Serializable.js";

describe("@serializable decorator", () => {
  it("zero-arg: uses class name as type", () => {
    @serializable
    class Foo {}
    expect(getSerializableType(Foo)).toBe("Foo");
    expect(SerializableRegistry.get("Foo")).toBe(Foo);
  });

  it("config override: uses provided type string", () => {
    @serializable({ type: "custom-bar" })
    class Bar {}
    expect(getSerializableType(Bar)).toBe("custom-bar");
    expect(SerializableRegistry.get("custom-bar")).toBe(Bar);
  });

  it("stores SERIALIZABLE_KEY on the class", () => {
    @serializable
    class Baz {}
    expect(SERIALIZABLE_KEY in Baz).toBe(true);
  });

  it("isSerializable returns true for decorated instance", () => {
    @serializable
    class Qux {}
    expect(isSerializable(new Qux())).toBe(true);
  });

  it("isSerializable returns false for undecorated instance", () => {
    class Plain {}
    expect(isSerializable(new Plain())).toBe(false);
  });

  it("getSerializableType works on instances", () => {
    @serializable
    class Inst {}
    expect(getSerializableType(new Inst())).toBe("Inst");
  });

  it("getSerializableType returns undefined for undecorated", () => {
    class Nope {}
    expect(getSerializableType(Nope)).toBeUndefined();
  });
});
