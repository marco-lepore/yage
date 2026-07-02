import { describe, expect, it } from "vitest";
import { defineItems } from "./catalog.js";

describe("defineItems", () => {
  it("derives ids from map keys and preserves authoring order", () => {
    const catalog = defineItems({
      potion: { name: "Potion" },
      sword: { name: "Sword" },
    });
    expect(catalog.ids).toEqual(["potion", "sword"]);
    expect(catalog.get("potion").id).toBe("potion");
    expect(catalog.orderOf("sword")).toBe(1);
  });

  it("freezes defs", () => {
    const catalog = defineItems({ potion: { name: "Potion" } });
    expect(Object.isFrozen(catalog.get("potion"))).toBe(true);
  });

  it("rejects an empty name and a non-positive maxStack", () => {
    expect(() => defineItems({ x: { name: "" } })).toThrow(/name is required/);
    expect(() => defineItems({ x: { name: "X", maxStack: 0 } })).toThrow(/maxStack/);
    expect(() => defineItems({ x: { name: "X", maxStack: 2.5 } })).toThrow(/maxStack/);
  });

  it("get throws on unknown ids; tryGet and has don't", () => {
    const catalog = defineItems({ potion: { name: "Potion" } });
    expect(() => catalog.get("nope" as never)).toThrow(/unknown item id/);
    expect(catalog.tryGet("nope")).toBeUndefined();
    expect(catalog.has("nope")).toBe(false);
    expect(catalog.has("potion")).toBe(true);
  });

  it("lists defs in authoring order", () => {
    const catalog = defineItems({
      b: { name: "B" },
      a: { name: "A" },
    });
    expect(catalog.defs().map((d) => d.id)).toEqual(["b", "a"]);
  });
});
