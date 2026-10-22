import { Vec2 } from "@yagejs/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const WIDTH = 840;
export const HEIGHT = 560;
/** Top edge of the walkable arena; the HUD sits above it. */
export const ARENA_TOP = 120;

/** Screen-space render layer for the in-canvas HUD. */
export const HUD_LAYER = "hud";
/** World layer drawn over the player, so the shadow darkens whoever stands in it. */
export const SHADE_LAYER = "shade";
/** World layer for the sight labels above each target. */
export const LABEL_LAYER = "labels";

/** Spawn keys, for `scene.findByKey`. */
export const GUARD_KEY = "guard";
export const PLAYER_KEY = "player";

/** Targets with this tag are ignored by the guard's eligibility check. */
export const ALLY_TAG = "ally";

export const GUARD_POST = new Vec2(180, 310);
/** Guard body radius, used for drawing it and for where it can walk. */
export const GUARD_RADIUS = 13;
/** Radius of the player and the ally. */
export const TARGET_RADIUS = 11;
/** Cell size of the grid the guard walks on, in world pixels. */
export const NAV_TILE = 20;
export const SIGHT_RANGE = 420;
export const SIGHT_FOV = (Math.PI * 2) / 3;
export const ALLY_SPOT = new Vec2(320, 190);

/** The wall the player hides behind: center and size, in world pixels. */
export const COVER_WALL = { x: 425, y: 310, width: 28, height: 150 } as const;

/** A dark patch the player can hide in, in world pixels. */
export const SHADOW = { x: 270, y: 400, width: 150, height: 100 } as const;
/** The lowest visibility score the guard can see. */
export const VISIBILITY_THRESHOLD = 0.3;
/** Visibility inside the shadow, below `VISIBILITY_THRESHOLD`. */
export const SHADOW_VISIBILITY = 0.2;

/**
 * Debug spots the number keys move the player to, one per sight check. Each
 * key is also the input action name.
 */
export const SPOTS = {
  open: new Vec2(300, 310),
  cover: new Vec2(530, 310),
  far: new Vec2(760, 310),
  behind: new Vec2(70, 310),
  shadow: new Vec2(345, 450),
} as const;
