import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import type { RejectReason } from "@yagejs-addons/inventory";
import { LootComponent } from "@yagejs-addons/loot";
import type { LootResult } from "@yagejs-addons/loot";
import type { Adventurer } from "./adventurer.js";
import { HUD_LAYER } from "./constants.js";
import { TABLES } from "./tables.js";
import type { ChestContext, ChestTable, ItemId } from "./tables.js";

/** A reward the backpack has not accepted yet. */
export interface WaitingReward {
  readonly item: ItemId;
  readonly quantity: number;
  /** Why the backpack refused it. */
  readonly reason: RejectReason;
}

/**
 * Opens the chest and holds what the backpack could not take. Claiming is
 * game state: a reward stays beside the chest until it fits.
 */
export class Chest extends Component {
  static inspectExclude = ["loot", "graphics"];
  private _opened = 0;
  private _waiting: WaitingReward[] = [];

  constructor(
    private readonly loot: LootComponent<ItemId, ChestContext, ChestTable>,
    private readonly graphics: GraphicsComponent,
  ) {
    super();
  }

  get opened(): number {
    return this._opened;
  }
  get waiting(): readonly WaitingReward[] {
    return this._waiting;
  }
  get waitingQuantity(): number {
    return this._waiting.reduce((sum, reward) => sum + reward.quantity, 0);
  }

  /** Roll a new chest. Returns null while earlier rewards still wait. */
  open(adventurer: Adventurer): LootResult<ItemId> | null {
    if (this._waiting.length > 0) return null;
    const result = this.loot.roll("chest", adventurer.lootContext());
    this._opened++;
    this._waiting = offer(adventurer.backpack, result.rewards);
    this.draw();
    return result;
  }

  /** Offer every waiting reward to the adventurer's backpack again. */
  collect({ backpack }: Adventurer): void {
    this._waiting = offer(backpack, this._waiting);
    this.draw();
  }

  onAdd(): void {
    this.draw();
  }

  /** The lid stands open while rewards wait beside the chest. */
  private draw(): void {
    const open = this._waiting.length > 0;
    this.graphics.draw((g) => {
      g.clear();
      g.roundRect(-44, -12, 88, 44, 6).fill({ color: 0x854d0e });
      g.rect(-6, -4, 12, 12).fill({ color: 0xfacc15 });
      if (open) g.rect(-46, -48, 92, 14).fill({ color: 0xa16207 });
      else g.roundRect(-46, -34, 92, 22, 6).fill({ color: 0xa16207 });
    });
  }
}

/** Add each reward to the backpack and keep what it refused. */
function offer(
  backpack: Adventurer["backpack"],
  rewards: readonly { item: ItemId; quantity: number }[],
): WaitingReward[] {
  return rewards.flatMap(({ item, quantity }) => {
    const { rejected, reason } = backpack.add(item, quantity);
    // Inventory sets `reason` whenever it rejects part of an add.
    return rejected > 0 ? [{ item, quantity: rejected, reason: reason! }] : [];
  });
}

/** The chest at the top of the middle panel, with its loot component. */
export class ChestEntity extends Entity {
  loot!: LootComponent<ItemId, ChestContext, ChestTable>;
  chest!: Chest;

  setup(): void {
    this.add(new Transform({ position: new Vec2(441, 170) }));
    const graphics = this.add(new GraphicsComponent({ layer: HUD_LAYER }));
    this.loot = this.add(new LootComponent({ model: TABLES }));
    this.chest = this.add(new Chest(this.loot, graphics));
  }
}
