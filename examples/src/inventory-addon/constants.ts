import { defineEvent } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import { INVENTORY_LAYERS } from "@yagejs-addons/inventory/presenters";

// ---------------------------------------------------------------------------
// Sizes and layers
// ---------------------------------------------------------------------------
export const WIDTH = 800;
export const HEIGHT = 600;
export const PLAYER_SPEED = 175;
export const HOTBAR_SLOTS = 5;
/** Centred along the bottom, above the controls line. Sized so five cells of
 *  about 52 px show their icons unsquashed inside the strip's 8 px padding. */
export const HOTBAR_BOUNDS = {
  x: (WIDTH - 300) / 2,
  y: HEIGHT - 90,
  width: 300,
  height: 66,
};
/** How long a toast stays on screen, in seconds. */
export const TOAST_SECONDS = 2.6;

export const ROOM_LAYER = "room";
export const HUD_LAYER = "hud";
export const LAYERS: LayerDef[] = [
  { name: ROOM_LAYER, order: 10, space: "world" },
  ...INVENTORY_LAYERS,
  { name: HUD_LAYER, order: 1200, space: "screen" },
];

/** Asset key of the potion icon. `main.ts` draws and registers the texture
 *  at boot. */
export const ICON_POTION = "icon-potion";

// ---------------------------------------------------------------------------
// Spawn keys, for `scene.findByKey`
// ---------------------------------------------------------------------------
export const PLAYER_KEY = "player";
export const BAG_KEY = "bag";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
/** A line for the HUD's toast. Emit it on any entity; the HUD hears it at the
 *  scene. */
export const ShowToast = defineEvent<{ message: string }>("hud:toast");
/** The player's HP or equipped item changed. */
export const PlayerStatsChanged = defineEvent("player:stats-changed");
