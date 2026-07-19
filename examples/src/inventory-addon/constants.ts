import type { LayerDef } from "@yagejs/renderer";
import { INVENTORY_LAYERS } from "@yagejs-addons/inventory/presenters";

export const WIDTH = 800;
export const HEIGHT = 600;
export const PLAYER_SPEED = 175;
export const HOTBAR_SLOTS = 5;
/** Centered along the bottom, clear of the controls line beneath it. Sized so
 *  five ~52px cells show their icons unsquashed — paired with the reduced
 *  padding below (a chrome-less strip needs far less inset than a framed panel). */
export const HOTBAR_BOUNDS = { x: (WIDTH - 300) / 2, y: HEIGHT - 90, width: 300, height: 66 };

export const ROOM_LAYER = "room";
export const HUD_LAYER = "hud";
export const LAYERS: LayerDef[] = [
  { name: ROOM_LAYER, order: 10, space: "world" },
  ...INVENTORY_LAYERS,
  { name: HUD_LAYER, order: 1200, space: "screen" },
];

export const ICON_POTION = "icon-potion";
