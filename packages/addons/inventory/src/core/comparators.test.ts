import { describe, expect, it } from "vitest";
import { byCatalogOrder, byCategory, byName, byQuantity, type SortEntry } from "./comparators.js";
import { defineItems } from "./catalog.js";

const catalog = defineItems({
  potion: { name: "Potion", category: "consumable" },
  sword: { name: "Sword", category: "gear" },
  apple: { name: "Apple", category: "consumable" },
  rock: { name: "Rock" },
});

function entry(id: "potion" | "sword" | "apple" | "rock", quantity = 1): SortEntry {
  return { stack: { itemId: id, quantity }, def: catalog.get(id), order: catalog.orderOf(id) };
}

describe("comparators", () => {
  it("byCatalogOrder follows authoring order", () => {
    const sorted = [entry("rock"), entry("apple"), entry("potion")].sort(byCatalogOrder);
    expect(sorted.map((e) => e.def.id)).toEqual(["potion", "apple", "rock"]);
  });

  it("byName sorts by display name", () => {
    const sorted = [entry("sword"), entry("potion"), entry("apple")].sort(byName);
    expect(sorted.map((e) => e.def.name)).toEqual(["Apple", "Potion", "Sword"]);
  });

  it("byCategory groups categories, undefined last, catalog order within", () => {
    const sorted = [entry("rock"), entry("sword"), entry("apple"), entry("potion")].sort(byCategory);
    expect(sorted.map((e) => e.def.id)).toEqual(["potion", "apple", "sword", "rock"]);
  });

  it("byQuantity puts big piles first, catalog order on ties", () => {
    const sorted = [entry("apple", 2), entry("sword", 2), entry("potion", 9)].sort(byQuantity);
    expect(sorted.map((e) => e.def.id)).toEqual(["potion", "sword", "apple"]);
  });
});
