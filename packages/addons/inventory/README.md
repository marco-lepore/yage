# @yagejs-addons/inventory

Slot-based inventory for [YAGE](https://yage.dev): a headless model (stacking,
partial acceptance, move/merge/split, sorting, transfers, snapshots, item
actions) plus one windowed slot view with swappable icon/row cell presets and a
zero-asset default theme.

## Install

```bash
npm install @yagejs-addons/inventory
```

Engine packages (`@yagejs/core`, `@yagejs/input`, and — for the default
presenters — `@yagejs/renderer`) are peer dependencies; your game's install is
reused.

## Entry points

- `@yagejs-addons/inventory` — headless: catalog + `Inventory` model,
  `filteredView` (a subset projection of one model), `InventorySession`,
  `InventoryController`, engine events, input bindings. Never pulls pixi.
- `@yagejs-addons/inventory/presenters` — the renderer views: the
  `createInventoryPanel` factory, `SlotsView` + `iconCell`/`rowCell` cell presets,
  `defaultInventoryTheme`, `INVENTORY_LAYERS`.

## Quick start

```ts
import { defineItems, Inventory, InventoryController, InventoryActionEvent } from "@yagejs-addons/inventory";
import { createInventoryPanel, INVENTORY_LAYERS } from "@yagejs-addons/inventory/presenters";

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
    const bundle = createInventoryPanel(); // zero-asset default theme
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

// Per-instance items (durability, rolled stats) carry a `data` payload.
// Query or grab them by a data predicate, then act on the exact stack:
inventory.add("key", 1, { data: { opens: "boss-lair" } });
const bossKey = inventory.find("key", (d) => d.opens === "boss-lair");
if (bossKey) {
  inventory.remove(bossKey); // returns { removed, stacks } — the payload comes back
  openDoor();
}
```

Declare a stack's `data` shape per item to type the payload and the predicates.
Add `instance: instanceData<{ opens: string }>()` to the `key` def, build the
inventory with no explicit type argument, and `d` in `find("key", (d) => …)` is
typed `{ opens: string }` — a wrong field or a `data` payload on an item that
declares none is a compile error. Without an `instance` declaration the payload
stays an open `Record<string, unknown>`.

Press the `inventory` action (or call `controller.toggle()`) to open the panel.

The model is always live — pickups, quest checks (`inventory.has("goldKey")`),
and removals work with the panel closed. Embedding in an existing menu is
configuration, not a different API: `chrome: false` + `bounds` on the factory,
`input: null` + `closeOnCancel: false` on the controller, then drive
`open`/`move`/`confirm` from your menu's focus handling.

Full docs: [yage.dev](https://yage.dev) → Addons → Inventory.

> **Status:** pre-1.0. Breaking changes land in minor versions.
