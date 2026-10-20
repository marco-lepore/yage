import { defineItems } from "@yagejs-addons/inventory";
import { LootTables } from "@yagejs-addons/loot";

export const ITEMS = defineItems({
  coin: { name: "Coins", maxStack: 10 },
  herb: { name: "Herbs", maxStack: 3 },
  potion: { name: "Potions", maxStack: 2 },
  ruby: { name: "Ruby", maxStack: 1 },
});
export type ItemId = "coin" | "herb" | "potion" | "ruby";
export interface ChestContext {
  level: number;
  luck: number;
}

export const TABLES = new LootTables<
  ItemId,
  ChestContext,
  "chest" | "supplies"
>({
  chest: {
    pools: [
      {
        id: "guaranteed",
        entries: [
          {
            id: "coins",
            kind: "item",
            item: "coin",
            quantity: { min: 6, max: 9 },
          },
        ],
      },
      {
        id: "supplies",
        entries: [{ id: "bundle", kind: "table", table: "supplies" }],
      },
      {
        id: "treasure",
        entries: [
          {
            id: "ruby",
            kind: "item",
            item: "ruby",
            when: ({ level }) => level >= 3 || "requires-level-3",
            weight: ({ luck }) => luck,
          },
          { id: "nothing", kind: "empty", weight: 3 },
        ],
      },
    ],
  },
  supplies: {
    pools: [
      {
        id: "different-supplies",
        rolls: 2,
        unique: true,
        entries: [
          {
            id: "herbs",
            kind: "item",
            item: "herb",
            quantity: { min: 1, max: 3 },
          },
          { id: "potion", kind: "item", item: "potion" },
        ],
      },
    ],
  },
});
