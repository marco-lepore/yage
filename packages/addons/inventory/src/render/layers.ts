import type { LayerDef } from "@yagejs/renderer";

/**
 * Screen-space render layers the inventory panel draws into. They sit above
 * the auto-provisioned ui-react layer (order 1000) but BELOW the dialogue
 * addon's layers (1100+), so a conversation can play over an open inventory.
 * `space: "screen"` pins the panel to the viewport (it doesn't scroll/zoom
 * with the world camera).
 *
 * Built-in presenters create missing layers. A host can declare orders explicitly:
 *   readonly layers = [...INVENTORY_LAYERS];
 */
export const INVENTORY_LAYER_PANEL = "inventory-panel";
export const INVENTORY_LAYER_CONTENT = "inventory-content";
export const INVENTORY_LAYER_OVERLAY = "inventory-overlay";

export const INVENTORY_LAYERS: readonly LayerDef[] = [
  // The chrome frame + dividers — below everything else the panel draws.
  { name: INVENTORY_LAYER_PANEL, order: 1050, space: "screen" },
  // Cells, cursor, icons, labels, quantities, detail text.
  { name: INVENTORY_LAYER_CONTENT, order: 1060, space: "screen" },
  // The action-menu popup, above everything panel-level.
  { name: INVENTORY_LAYER_OVERLAY, order: 1070, space: "screen" },
];
