/**
 * Deterministic e2e fixture for @yagejs-addons/inventory.
 *
 * Boots a tiny scene with a grid backpack + a list key-items pouch (zero
 * assets, `defaultInventoryTheme()`), freezes the clock, and exposes the
 * models + controllers + a small game state on `window.__inventory__` so the
 * spec drives the controller's input-agnostic host API and asserts against
 * the MODEL. `input: null` — the spec IS the input.
 *
 * The game-state wiring mirrors the shipped example: "use" heals, rejections
 * write a toast line, and the potion counter tracks the model events — so the
 * spec exercises the whole rules-in/consequences-out loop.
 */

import { Engine, Scene, Vec2 } from "@yagejs/core";
import { RendererPlugin, CameraEntity } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import {
  defineItems,
  Inventory,
  InventoryActionEvent,
  InventoryController,
  InventoryItemAddedEvent,
  InventoryItemRemovedEvent,
  InventoryOpenedEvent,
  InventoryRejectedEvent,
  type ItemActionDef,
  type RejectReason,
} from "@yagejs-addons/inventory";
import {
  createGridInventory,
  createListInventory,
  INVENTORY_LAYERS,
} from "@yagejs-addons/inventory/presenters";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const container = setupContainer(WIDTH, HEIGHT);

// Catalog order matters: the sort spec asserts potion < gem < sword.
const CATALOG = defineItems({
  potion: { name: "Potion", maxStack: 5, category: "consumable", actions: ["use", "drop"] },
  gem: { name: "Gem", maxStack: 99, category: "treasure", actions: ["drop"] },
  arrows: { name: "Arrows", maxStack: 30, stacking: "single", actions: ["drop"] },
  sword: { name: "Iron Sword", category: "gear", actions: ["equip", "drop"] },
  goldKey: { name: "Gold Key", category: "key", actions: [] },
});
type ItemId = Parameters<typeof CATALOG.get>[0];

interface FixtureState {
  hp: number;
  potions: number;
  lastToast: string;
}

class InventoryScene extends Scene {
  readonly name = "inventory-e2e";
  readonly layers = [...INVENTORY_LAYERS];

  onEnter(): void {
    const state: FixtureState = { hp: 55, potions: 0, lastToast: "" };
    const toast = (message: string): void => {
      state.lastToast = message;
    };

    const actions: ItemActionDef<ItemId>[] = [
      { id: "use", label: "Use", consumes: true },
      { id: "equip", label: "Equip" },
      { id: "drop", label: "Drop", consumes: true },
    ];
    const backpack = new Inventory({ catalog: CATALOG, capacity: 15, actions });
    const keyItems = new Inventory({
      catalog: CATALOG,
      autoCompact: true,
      accepts: (def) => def.category === "key",
    });

    this.spawn(CameraEntity, { position: new Vec2(WIDTH / 2, HEIGHT / 2) });

    const backpackBundle = createGridInventory(undefined, { columns: 5, visibleRows: 3 });
    const backpackHost = this.spawn("backpack-ui");
    const backpackCtrl = backpackHost.add(
      new InventoryController({
        ...backpackBundle,
        inventory: backpack,
        title: "Backpack",
        input: null, // the spec drives the host API directly
      }),
    );

    const pouchBundle = createListInventory(undefined, { visibleRows: 6 });
    const pouchHost = this.spawn("pouch-ui");
    const pouchCtrl = pouchHost.add(
      new InventoryController({
        ...pouchBundle,
        inventory: keyItems,
        title: "Key Items",
        input: null,
      }),
    );

    // One panel at a time — the host-policy line the spec asserts.
    backpackHost.on(InventoryOpenedEvent, () => pouchCtrl.close());
    pouchHost.on(InventoryOpenedEvent, () => backpackCtrl.close());

    // Consequences: the same shapes the shipped example wires. `CATALOG.has`
    // narrows the engine bus's string ids.
    backpackHost.on(InventoryActionEvent, (e) => {
      if (!CATALOG.has(e.itemId)) return;
      const def = CATALOG.get(e.itemId);
      if (e.actionId === "use") {
        state.hp = Math.min(100, state.hp + 25);
        toast(`Used ${def.name}`);
      } else if (e.actionId === "drop") {
        toast(`Dropped ${def.name}`);
      } else if (e.actionId === "equip") {
        toast(`Equipped ${def.name}`);
      }
    });
    const rejectionToast = (e: { itemId: string; quantity: number; reason: RejectReason }): void => {
      if (!CATALOG.has(e.itemId)) return;
      const def = CATALOG.get(e.itemId);
      toast(
        e.reason === "filtered"
          ? "The pouch only takes key items"
          : e.reason === "stack-cap"
            ? `Can't carry more ${def.name} (${e.quantity} left behind)`
            : `Backpack full (${e.quantity} × ${def.name} left behind)`,
      );
    };
    backpackHost.on(InventoryRejectedEvent, rejectionToast);
    pouchHost.on(InventoryRejectedEvent, rejectionToast);
    const syncPotions = (): void => {
      state.potions = backpack.count("potion");
    };
    backpackHost.on(InventoryItemAddedEvent, syncPotions);
    backpackHost.on(InventoryItemRemovedEvent, syncPotions);

    (window as unknown as { __inventory__: unknown }).__inventory__ = {
      backpack,
      keyItems,
      backpackCtrl,
      pouchCtrl,
      state,
    };
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(new InputPlugin({ actions: { interact: ["Enter"] } }));
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new InventoryScene());
