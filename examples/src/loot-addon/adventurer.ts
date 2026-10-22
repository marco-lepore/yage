import { Component, Entity } from "@yagejs/core";
import { Inventory } from "@yagejs-addons/inventory";
import { LootRolledEvent } from "@yagejs-addons/loot";
import { Stats, StatsComponent } from "@yagejs-addons/stats";
import type { StatsModel } from "@yagejs-addons/stats";
import { ITEMS } from "./tables.js";
import type { ChestContext, ItemId } from "./tables.js";

type AdventurerStat = "level" | "luck";

/**
 * The adventurer's progress: stats, a two-slot backpack, a bank, and the
 * loot rules the game owns. The addon keeps no state between rolls, so the
 * once-per-adventurer crown and its pity counter live here.
 */
export class Adventurer extends Component {
  static inspectExclude = ["stats", "backpack", "bank"];
  readonly backpack = new Inventory({ catalog: ITEMS, capacity: 2 });
  readonly bank = new Inventory({ catalog: ITEMS });
  private readonly _found = new Set<ItemId>();
  private _misses = 0;

  constructor(readonly stats: StatsModel<AdventurerStat>) {
    super();
  }

  get level(): number {
    return this.stats.get("level");
  }
  get misses(): number {
    return this._misses;
  }
  get found(): ItemId[] {
    return [...this._found];
  }
  get backpackItems(): { item: ItemId; quantity: number }[] {
    return this.backpack.slots.flatMap((stack) =>
      stack ? [{ item: stack.itemId, quantity: stack.quantity }] : [],
    );
  }
  get bankedQuantity(): number {
    return this.bank.slots.reduce(
      (sum, stack) => sum + (stack?.quantity ?? 0),
      0,
    );
  }

  onAdd(): void {
    // Chest rolls bubble to the scene. The rewards decide the pity count.
    this.listenScene(LootRolledEvent, ({ table, rewards }) => {
      if (table !== "chest") return;
      if (rewards.some((reward) => reward.item === "crown")) {
        this._found.add("crown");
        this._misses = 0;
      } else if (!this._found.has("crown")) {
        this._misses++;
      }
    });
  }

  /** The values the chest rules read. */
  lootContext(): ChestContext {
    return {
      level: this.level,
      luck: this.stats.get("luck"),
      misses: this._misses,
      found: this._found,
    };
  }

  /** Move everything from the backpack to the bank. */
  bankAll(): void {
    for (const stack of [...this.backpack.slots]) {
      if (stack)
        this.backpack.transfer(this.bank, stack.itemId, stack.quantity);
    }
  }

  /** Switch between level 1 and level 3. Level 3 also raises luck. */
  toggleLevel(): void {
    const high = this.level === 1;
    this.stats.setBases({ level: high ? 3 : 1, luck: high ? 4 : 1 });
  }
}

/** The player's side of every chest: stats, inventories and loot progress. */
export class AdventurerEntity extends Entity {
  adventurer!: Adventurer;

  setup(): void {
    const stats = this.add(
      new StatsComponent({
        model: new Stats({ level: { base: 1 }, luck: { base: 1 } }),
      }),
    );
    this.adventurer = this.add(new Adventurer(stats.model));
  }
}
