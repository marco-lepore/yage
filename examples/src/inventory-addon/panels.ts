import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { TextComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import {
  filteredView,
  INVENTORY_ACTIONS,
  InventoryActionEvent,
  InventoryController,
  inventoryControls,
  InventoryRejectedEvent,
  type InventorySource,
} from "@yagejs-addons/inventory";
import {
  createInventoryPanel,
  defaultInventoryTheme,
  rowCell,
} from "@yagejs-addons/inventory/presenters";
import {
  BAG_KEY,
  HOTBAR_BOUNDS,
  HOTBAR_SLOTS,
  HUD_LAYER,
  PLAYER_KEY,
  ShowToast,
  WIDTH,
} from "./constants.js";
import { CATALOG, isUsable, type ItemId } from "./catalog.js";
import { PickupEntity } from "./room.js";
import type { Bag, BagEntity } from "./bag.js";
import type { PlayerEntity } from "./player.js";

// ---------------------------------------------------------------------------
// ItemConsequences — what the item actions mean
// ---------------------------------------------------------------------------

/**
 * Consequences out: applies what a panel's item actions mean for the game,
 * and turns a refused pickup into a toast. The panel's controller mirrors its
 * model's events onto this entity, open or closed, so this component listens
 * to its own entity.
 */
export class ItemConsequences extends Component {
  onAdd(): void {
    // Engine-bus payloads carry `string` ids. `CATALOG.has` is a type
    // predicate, so one guard narrows `e.itemId` to the catalog's ids.
    this.listen(this.entity, InventoryActionEvent, (e) => {
      if (CATALOG.has(e.itemId)) this.apply(e.actionId, e.itemId);
    });
    this.listen(this.entity, InventoryRejectedEvent, (e) => {
      if (!CATALOG.has(e.itemId)) return;
      const def = CATALOG.get(e.itemId);
      this.toast(
        e.reason === "filtered"
          ? "The pouch only takes key items"
          : e.reason === "stack-cap"
            ? `Can't carry more ${def.name} (${e.quantity} left behind)`
            : `Backpack full (${e.quantity} × ${def.name} left behind)`,
      );
    });
  }

  private apply(actionId: string, itemId: ItemId): void {
    const player = this.scene.findByKey<PlayerEntity>(PLAYER_KEY);
    if (!player) return;
    const def = CATALOG.get(itemId);
    if (actionId === "use") {
      const heal = itemId === "elixir" ? 100 : 25;
      player.stats.heal(heal);
      this.toast(`Used ${def.name} (+${heal} HP)`);
    } else if (actionId === "equip") {
      player.stats.equip(itemId);
      this.toast(`Equipped ${def.name}`);
    } else if (actionId === "unequip") {
      player.stats.unequip();
      this.toast(`Unequipped ${def.name}`);
    } else if (actionId === "drop") {
      // Drop consumes one unit from the stack (`consumes: true`); put it
      // back on the floor beside the player.
      const p = player.get(Transform).position;
      this.scene.spawn(PickupEntity, {
        itemId,
        quantity: 1,
        x: p.x + 36,
        y: p.y + 22,
      });
      this.toast(`Dropped ${def.name}`);
    } else if (actionId === "examine") {
      this.toast(def.description ?? def.name);
    }
  }

  private toast(message: string): void {
    this.entity.emit(ShowToast, { message });
  }
}

// ---------------------------------------------------------------------------
// The two browsing panels
// ---------------------------------------------------------------------------

/** The backpack as a 5×3 icon grid. I toggles it. */
export class BackpackPanelEntity extends Entity {
  controller!: InventoryController<ItemId>;

  setup(params: { bag: Bag }): void {
    this.controller = this.add(
      new InventoryController({
        ...createInventoryPanel(undefined, { columns: 5, visibleRows: 3 }),
        inventory: params.bag.backpack,
        title: "Backpack",
        // No `input`: the default is full keyboard/gamepad plus mouse/touch,
        // with pointer hit-testing against this bundle's presenters.
      }),
    );
    this.add(new ItemConsequences());
  }
}

/** The key-items pouch as a list of text rows. K toggles it. */
export class KeyItemsPanelEntity extends Entity {
  controller!: InventoryController<ItemId>;

  setup(params: { bag: Bag }): void {
    const bundle = createInventoryPanel(undefined, {
      cell: rowCell,
      visibleRows: 6,
    });
    this.controller = this.add(
      new InventoryController({
        ...bundle,
        inventory: params.bag.keyItems,
        title: "Key Items",
        // A custom binding only to rename an action: this panel toggles on K.
        input: inventoryControls(bundle, {
          actions: { ...INVENTORY_ACTIONS, toggle: ["key-items"] },
        }),
      }),
    );
    this.add(new ItemConsequences());
  }
}

// ---------------------------------------------------------------------------
// The hotbar
// ---------------------------------------------------------------------------

/**
 * Quick-use belt: number keys 1–HOTBAR_SLOTS fire "use" on the matching
 * hotbar cell. The index is a presented index into the filtered view the
 * strip shows, so key 1 always hits whatever the strip's first cell shows.
 * Frozen while a browsing panel is open, because those keys drive the panel
 * then.
 */
export class HotbarQuickUse extends Component {
  private readonly input = this.service(InputManagerKey);

  /** Times host code cancelled the strip. The strip has no device input, so
   *  only a `controller.cancel()` call reaches its `onCancel`. */
  cancels = 0;

  constructor(private readonly usable: InventorySource<ItemId>) {
    super();
  }

  countCancel(): void {
    this.cancels += 1;
  }

  update(): void {
    if (this.scene.findByKey<BagEntity>(BAG_KEY)?.panels.anyOpen) return;
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      if (this.input.isJustPressed(`quick-${i + 1}`)) {
        this.usable.invokeAction("use", i);
      }
    }
  }
}

/**
 * The always-on quick-use strip along the bottom. It shows a filtered view
 * of the backpack: only items offering "use" (potions, elixirs), packed with
 * no gaps. Because the view is over the shared model, using an item here or
 * in the backpack panel is the same mutation.
 */
export class HotbarEntity extends Entity {
  controller!: InventoryController<ItemId>;
  quickUse!: HotbarQuickUse;

  setup(params: { bag: Bag }): void {
    const usable = filteredView(params.bag.backpack, isUsable);
    const quickUse = new HotbarQuickUse(usable);
    this.controller = this.add(
      new InventoryController({
        ...createInventoryPanel(
          // A chrome-less strip needs far less inset than the framed panels;
          // the default 16 px padding would crush a one-row cell to about 20 px.
          { ...defaultInventoryTheme(), padding: 8 },
          {
            bounds: HOTBAR_BOUNDS,
            columns: HOTBAR_SLOTS,
            chrome: false,
            detail: false,
            actionMenu: false,
            visibleRows: 1,
          },
        ),
        inventory: usable,
        // A passive live mirror: no device input, cancel doesn't close it,
        // and it opens on mount. `HotbarQuickUse` drives it instead.
        input: null,
        closeOnCancel: false,
        openOnAdd: true,
        onCancel: () => quickUse.countCancel(),
      }),
    );
    this.quickUse = this.add(quickUse);

    // Label the strip so its number-key controls read. The hotbar entity has
    // no Transform, so the caption's position is in screen pixels.
    const caption = this.spawnChild("caption");
    caption.add(
      new Transform({ position: new Vec2(WIDTH / 2, HOTBAR_BOUNDS.y - 10) }),
    );
    caption.add(
      new TextComponent({
        text: `Quick-use · 1–${HOTBAR_SLOTS}`,
        style: { fontSize: 11, fill: 0x8888aa, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}
