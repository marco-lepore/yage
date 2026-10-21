import { defineEvent } from "@yagejs/core";

// ---------------------------------------------------------------------------
// Sizes and layers
// ---------------------------------------------------------------------------
export const WIDTH = 960;
export const HEIGHT = 680;
/** Height of the HUD band at the top of the screen; the map is framed below it. */
export const HUD_HEIGHT = 170;

/** This game's world-pixel tile. Generation works in tiles; adapters multiply by this. */
export const TILE = 16;
export const TILE_SCALE = { tileWidth: TILE, tileHeight: TILE };
/** Explorer walking speed in world pixels per second. */
export const WALK_SPEED = 10 * TILE;

export const MAP_LAYER = "map";
export const CONTENT_LAYER = "content";
export const OVERLAY_LAYER = "overlay";
export const HUD_LAYER = "hud";

export const COLORS = {
  wall: 0x141e2e,
  outline: 0x6b8099,
  floor: 0x314a67,
  start: 0x1e6659,
  special: 0x554176,
  boss: 0x786128,
  locked: 0x22262f,
  route: 0xfbbf24,
  explorer: 0xf8fafc,
  caveFloor: 0x3c6762,
  link: 0x475569,
} as const;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
/** A generation job started or finished. Emitted on the map entity. */
export const MapChanged = defineEvent("procedural-rooms:map-changed");
/** The explorer entered a region that grants `key`. Emitted on the map host; bubbles to the scene. */
export const KeyCollected = defineEvent<{ readonly key: string }>(
  "procedural-rooms:key-collected",
);
/** The explorer's target or route changed. Bubbles from the explorer. */
export const RouteChanged = defineEvent("procedural-rooms:route-changed");
