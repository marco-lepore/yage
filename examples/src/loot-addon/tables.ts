import { defineItems } from "@yagejs-addons/inventory";
import { LootTables } from "@yagejs-addons/loot";

export const ITEMS = defineItems({
  coin: { name: "Coins", maxStack: 10 },
  herb: { name: "Herbs", maxStack: 3 },
  potion: { name: "Potions", maxStack: 2 },
  ruby: { name: "Ruby", maxStack: 1 },
  crown: { name: "Crown", maxStack: 1 },
});
export type ItemId = (typeof ITEMS.ids)[number];

/** What the chest rules read about the adventurer opening it. */
export interface ChestContext {
  readonly level: number;
  readonly luck: number;
  /** Chests opened without finding the crown. */
  readonly misses: number;
  /** Once-per-adventurer rewards already found. */
  readonly found: ReadonlySet<ItemId>;
}

export type ChestTable = "chest" | "supplies";

export const TABLES = new LootTables<ItemId, ChestContext, ChestTable>({
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
      {
        // Once per adventurer, with a pity weight that grows on every miss.
        id: "relic",
        entries: [
          {
            id: "crown",
            kind: "item",
            item: "crown",
            when: ({ found }) => !found.has("crown") || "already-found",
            weight: ({ misses }) => 1 + misses,
          },
          { id: "nothing", kind: "empty", weight: 6 },
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
