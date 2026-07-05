# @yagejs-addons/inventory

Slot-based inventory for [YAGE](https://yage.dev): a headless model (stacking,
partial acceptance, move/merge/split, sorting, transfers, snapshots, item
actions) plus swappable grid/list presenters with a zero-asset default theme.

## Install

```bash
npm install @yagejs-addons/inventory
```

Engine packages (`@yagejs/core`, `@yagejs/input`, and — for the default
presenters — `@yagejs/renderer`) are peer dependencies; your game's install is
reused.

## Entry points

- `@yagejs-addons/inventory` — headless: catalog + `Inventory` model,
  `InventorySession`, `InventoryController`, engine events, input bindings.
  Never pulls pixi.
- `@yagejs-addons/inventory/presenters` — the renderer views: `createGridInventory`
  / `createListInventory` factories, `GridSlotsView`/`ListSlotsView`,
  `defaultInventoryTheme`, `INVENTORY_LAYERS`.

## Quick start

```ts
import { defineItems, Inventory, InventoryController, InventoryActionEvent } from "@yagejs-addons/inventory";
import { createGridInventory, INVENTORY_LAYERS } from "@yagejs-addons/inventory/presenters";

const catalog = defineItems({
  potion: { name: "Potion", maxStack: 5, description: "Heals 20 HP." },
  sword: { name: "Iron Sword" },
});

const inventory = new Inventory({
  catalog,
  capacity: 15,
  actions: [{ id: "use", label: "Use", consumes: true }, { id: "drop", label: "Drop" }],
});

class MyScene extends Scene {
  readonly layers = [...INVENTORY_LAYERS];
  onEnter() {
    const bundle = createGridInventory(); // zero-asset default theme
    const host = this.spawn("inventory");
    // Default input = keyboard/gamepad + mouse/touch, already wired.
    const controller = host.add(new InventoryController({ ...bundle, inventory }));
    host.on(InventoryActionEvent, (e) => {
      if (e.actionId === "use" && e.itemId === "potion") healPlayer(20);
    });
  }
}

// Anywhere in game logic — UI open or not:
inventory.add("potion", 3);
if (inventory.has("sword")) equip();
```

Press the `inventory` action (or call `controller.toggle()`) to open the panel.

The model is always live — pickups, quest checks (`inventory.has("goldKey")`),
and removals work with the panel closed. Embedding in an existing menu is
configuration, not a different API: `chrome: false` + `bounds` on the factory,
`input: null` + `closeOnCancel: false` on the controller, then drive
`open`/`move`/`confirm` from your menu's focus handling.

Full docs: [yage.dev](https://yage.dev) → Addons → Inventory.

> **Status:** pre-1.0. Breaking changes land in minor versions.
