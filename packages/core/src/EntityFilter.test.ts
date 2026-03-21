import { describe, it, expect } from "vitest";
import { filterEntities } from "./EntityFilter.js";
import { Entity } from "./Entity.js";
import { defineTrait, trait } from "./Trait.js";

const Damageable = defineTrait<{ hp: number }>("Damageable");

@trait(Damageable)
class DamageableEntity extends Entity {
  hp = 100;
}

describe("filterEntities", () => {
  it("returns all non-destroyed entities when filter is empty", () => {
    const a = new Entity("a");
    const b = new Entity("b");
    const result = filterEntities([a, b], {});
    expect(result).toEqual([a, b]);
  });

  it("skips destroyed entities", () => {
    const a = new Entity("a");
    const b = new Entity("b");
    b.destroy();
    const result = filterEntities([a, b], {});
    expect(result).toEqual([a]);
  });

  it("filters by name", () => {
    const a = new Entity("player");
    const b = new Entity("enemy");
    const c = new Entity("player");
    const result = filterEntities([a, b, c], { name: "player" });
    expect(result).toEqual([a, c]);
  });

  it("filters by single tag", () => {
    const a = new Entity("a", ["coin"]);
    const b = new Entity("b", ["enemy"]);
    const c = new Entity("c", ["coin", "shiny"]);
    const result = filterEntities([a, b, c], { tags: ["coin"] });
    expect(result).toEqual([a, c]);
  });

  it("filters by multiple tags (AND)", () => {
    const a = new Entity("a", ["coin"]);
    const b = new Entity("b", ["coin", "shiny"]);
    const c = new Entity("c", ["shiny"]);
    const result = filterEntities([a, b, c], { tags: ["coin", "shiny"] });
    expect(result).toEqual([b]);
  });

  it("filters by trait", () => {
    const a = new DamageableEntity("goblin");
    const b = new Entity("wall");
    const result = filterEntities([a, b], { trait: Damageable });
    expect(result).toEqual([a]);
  });

  it("filters by custom predicate", () => {
    const a = new Entity("a");
    const b = new Entity("b");
    const result = filterEntities([a, b], {
      filter: (e) => e.name === "b",
    });
    expect(result).toEqual([b]);
  });

  it("combines multiple filters with AND logic", () => {
    const a = new DamageableEntity("goblin", ["enemy"]);
    const b = new DamageableEntity("goblin", ["friendly"]);
    const c = new Entity("goblin", ["enemy"]);
    const result = filterEntities([a, b, c], {
      name: "goblin",
      tags: ["enemy"],
      trait: Damageable,
    });
    expect(result).toEqual([a]);
  });

  it("returns empty array when nothing matches", () => {
    const a = new Entity("a");
    const result = filterEntities([a], { name: "nope" });
    expect(result).toEqual([]);
  });
});
