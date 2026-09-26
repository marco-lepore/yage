import { Component } from "@yagejs/core";
import type { ItemStackSnapshot } from "@yagejs-addons/inventory";
import type { ItemId } from "./catalog.js";
import type { BagEntity } from "./bag.js";
import type { HudEntity } from "./hud.js";
import type { PlayerEntity } from "./player.js";

/**
 * Inspector-readable state for e2e tests and for a human poking around:
 * `inspector.getComponentData("inventory-probe", "InventoryProbe")`.
 */
export class InventoryProbe extends Component {
  constructor(
    private readonly player: PlayerEntity,
    private readonly host: BagEntity,
    private readonly hudHost: HudEntity,
  ) {
    super();
  }

  get hp(): number {
    return this.player.stats.hp;
  }

  get equipped(): ItemId | null {
    return this.player.stats.equipped;
  }

  get potions(): number {
    return this.host.bag.potions;
  }

  get lastToast(): string {
    return this.hudHost.hud.lastToast;
  }

  /** Backpack slots in order, `null` for an empty slot. */
  get backpack(): readonly (ItemStackSnapshot | null)[] {
    return this.host.bag.backpack.snapshot().slots;
  }

  get keyItems(): readonly (ItemStackSnapshot | null)[] {
    return this.host.bag.keyItems.snapshot().slots;
  }

  get backpackOpen(): boolean {
    return this.host.backpackPanel.controller.isOpen();
  }

  get keyItemsOpen(): boolean {
    return this.host.keyItemsPanel.controller.isOpen();
  }

  get hotbarOpen(): boolean {
    return this.host.hotbar.controller.isOpen();
  }

  get hotbarCancels(): number {
    return this.host.hotbar.quickUse.cancels;
  }
}
