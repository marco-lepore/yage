import type { Inventory, InventoryController } from "@yagejs-addons/inventory";
import type { DemoState, ItemId } from "./catalog.js";

// ── inspector/e2e probe ───────────────────────────────────────────────────────

interface InventoryProbeHandle {
  readonly backpack: Inventory<ItemId>;
  readonly keyItems: Inventory<ItemId>;
  readonly backpackCtrl: InventoryController<ItemId>;
  readonly pouchCtrl: InventoryController<ItemId>;
  readonly hotbarCtrl: InventoryController<ItemId>;
  readonly hotbarCancels: () => number;
  readonly state: DemoState;
}

export function exposeProbe(handle: InventoryProbeHandle): void {
  (window as unknown as { __inventory__: InventoryProbeHandle }).__inventory__ =
    handle;
}
