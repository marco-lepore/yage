import { Component, Entity } from "@yagejs/core";
import {
  Inventory,
  InventoryOpenedEvent,
  type InventoryController,
} from "@yagejs-addons/inventory";
import { PLAYER_KEY, ShowToast } from "./constants.js";
import { CATALOG, itemActions, type ItemId } from "./catalog.js";
import {
  BackpackPanelEntity,
  HotbarEntity,
  KeyItemsPanelEntity,
} from "./panels.js";
import type { PlayerEntity } from "./player.js";

// ---------------------------------------------------------------------------
// Bag — the two inventories
// ---------------------------------------------------------------------------

/**
 * The player's two inventories: game state that pickups, the vault door, the
 * HUD and the panels read. Rules in: capacity, the key-items filter and the
 * item actions are set here, and stacking comes from the catalog. What an
 * action means for the game is `ItemConsequences`' job.
 */
export class Bag extends Component {
  private readonly actions = itemActions(() => this.equipped);

  /** Bounded 5×3 grid for everything except key items. */
  readonly backpack: Inventory<ItemId> = new Inventory({
    catalog: CATALOG,
    capacity: 15,
    actions: this.actions,
  });

  /** Unbounded list that only accepts `category: "key"`. */
  readonly keyItems: Inventory<ItemId> = new Inventory({
    catalog: CATALOG,
    autoCompact: true, // list-style: no holes
    accepts: (def) => def.category === "key",
    actions: this.actions.filter((a) => a.id === "examine"),
  });

  /** How many potions the backpack holds, across all its stacks. */
  get potions(): number {
    return this.backpack.count("potion");
  }

  /**
   * Pour a floor bundle into the inventory its category belongs to. Returns
   * how many units fit; the rest stays on the floor. A refusal reaches the
   * panel's `InventoryRejectedEvent`, which `ItemConsequences` turns into a
   * toast.
   */
  collect(itemId: ItemId, quantity: number): number {
    const def = CATALOG.get(itemId);
    const target = def.category === "key" ? this.keyItems : this.backpack;
    const { added } = target.add(itemId, quantity);
    if (added > 0) {
      const where = def.category === "key" ? " (pouch)" : "";
      this.entity.emit(ShowToast, {
        message: `+${added} ${def.name}${where}`,
      });
    }
    return added;
  }

  /** The item the player holds. Equip, Unequip and Drop read it. */
  private get equipped(): ItemId | null {
    return (
      this.scene.findByKey<PlayerEntity>(PLAYER_KEY)?.stats.equipped ?? null
    );
  }
}

// ---------------------------------------------------------------------------
// PanelFocus — one browsing panel at a time
// ---------------------------------------------------------------------------

/** Opening one browsing panel closes the other. The hotbar is always on and
 *  outside this rule. */
export class PanelFocus extends Component {
  constructor(private readonly panels: readonly InventoryController<ItemId>[]) {
    super();
  }

  /** True while a browsing panel is open. Movement, the door and the hotbar
   *  keys wait then, because the same keys drive the panel. */
  get anyOpen(): boolean {
    return this.panels.some((panel) => panel.isOpen());
  }

  onAdd(): void {
    for (const panel of this.panels) {
      this.listen(panel.entity, InventoryOpenedEvent, () => {
        for (const other of this.panels) {
          if (other !== panel) other.close();
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// BagEntity
// ---------------------------------------------------------------------------

/**
 * Hosts the bag and its three views as child entities: the backpack panel,
 * the key-items panel and the hotbar. Spawned with `BAG_KEY`; other entities
 * find it with `scene.findByKey`.
 */
export class BagEntity extends Entity {
  bag!: Bag;
  panels!: PanelFocus;
  backpackPanel!: BackpackPanelEntity;
  keyItemsPanel!: KeyItemsPanelEntity;
  hotbar!: HotbarEntity;

  setup(): void {
    const bag = this.add(new Bag());
    this.bag = bag;
    this.backpackPanel = this.spawnChild("backpack", BackpackPanelEntity, {
      bag,
    });
    this.keyItemsPanel = this.spawnChild("key-items", KeyItemsPanelEntity, {
      bag,
    });
    this.hotbar = this.spawnChild("hotbar", HotbarEntity, { bag });
    this.panels = this.add(
      new PanelFocus([
        this.backpackPanel.controller,
        this.keyItemsPanel.controller,
      ]),
    );
  }
}
