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

The inventory belongs to the entity that carries it. A component on the player
owns the model and applies what the items do; the `InventoryController` beside
it draws the panel.

```ts
import { Component, Entity, Scene } from "@yagejs/core";
import {
  defineItems,
  instanceData,
  Inventory,
  InventoryController,
  InventoryActionEvent,
} from "@yagejs-addons/inventory";
import {
  createInventoryPanel,
  INVENTORY_LAYERS,
} from "@yagejs-addons/inventory/presenters";

const catalog = defineItems({
  potion: { name: "Potion", maxStack: 5, description: "Heals 20 HP." },
  sword: { name: "Iron Sword" },
  key: { name: "Gold Key", instance: instanceData<{ opens: string }>() },
});

/** The player's items, and what using one does. */
class Backpack extends Component {
  readonly items = new Inventory({
    catalog,
    capacity: 15,
    actions: [
      { id: "use", label: "Use", consumes: true },
      { id: "drop", label: "Drop" },
    ],
  });
  private readonly health = this.sibling(Health); // the player's own component

  onAdd(): void {
    // The controller emits the action on this entity; its meaning is the game's.
    this.listen(this.entity, InventoryActionEvent, (e) => {
      if (e.actionId === "use" && e.itemId === "potion") this.health.heal(20);
    });
  }
}

class Player extends Entity {
  setup(): void {
    // ...the player's Transform, sprite, Health, and controller
    const bag = this.add(new Backpack());
    // Default input = keyboard/gamepad + mouse/touch, already wired.
    this.add(
      new InventoryController({
        ...createInventoryPanel(), // zero-asset default theme
        inventory: bag.items,
      }),
    );
  }
}

class TownScene extends Scene {
  readonly name = "town";
  readonly layers = [...INVENTORY_LAYERS];

  onEnter() {
    this.spawn(Player, { key: "player" });
  }
}
```

Game code reaches the model through the component, with the panel open or
closed. A pickup or a door component finds the player with
`this.scene.findByKey("player")`, a query, or the reference `spawn()` returned:

```ts
const items = player.get(Backpack).items;
items.add("potion", 3);
if (items.has("sword")) equip();

// Per-instance items (durability, rolled stats) carry a `data` payload.
// Query or grab them by a data predicate, then act on the exact stack:
items.add("key", 1, { data: { opens: "boss-lair" } });
const bossKey = items.find("key", (d) => d.opens === "boss-lair");
if (bossKey) {
  items.remove(bossKey); // returns { removed, stacks } — the payload comes back
  openDoor();
}
```

The `key` def declares its per-stack `data` shape with
`instance: instanceData<{ opens: string }>()`, so `d` in `find("key", (d) => …)`
is typed `{ opens: string }` and a wrong field is a compile error. An item that
declares no `instance` carries no per-stack `data`, so passing a `data` payload
to `add` on it is a compile error too. To keep the permissive
`Record<string, unknown>` instead, type the inventory by id only
(`new Inventory<ItemId>(…)`) or leave the catalog untyped.

Press the `inventory` action (or call `toggle()` on the `InventoryController`) to
open the panel.

The model is always live — pickups, quest checks (`items.has("key")`), and
removals work with the panel closed. Embedding in an existing menu is
configuration, not a different API: `chrome: false` + `bounds` on the factory,
`input: null` + `closeOnCancel: false` on the controller, then drive
`open`/`move`/`confirm` from your menu's focus handling.

This inventory lives as long as the player entity. An inventory the game saves,
or carries from scene to scene, is part of the game's save root instead: create
it at module level next to that root, and hand it to the component instead of
creating one there. `snapshot()` and `restore()` give the root the whole state
as JSON.

Full docs: [yage.dev](https://yage.dev) → Addons → Inventory.

> **Status:** pre-1.0. Breaking changes land in minor versions.
