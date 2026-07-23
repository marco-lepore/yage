import { Vec2, defineEvent } from "@yagejs/core";
import { CollisionLayers } from "@yagejs/physics";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const WIDTH = 800;
export const HEIGHT = 600;
export const WORLD_W = 1200;
export const WORLD_H = 800;
export const TOTAL_ENEMIES = 6;
export const SPAWN = new Vec2(100, 680);

/** Screen-space render layer for the in-canvas HUD (counter + win banner). */
export const HUD_LAYER = "hud";

// Collision layers
const layers = new CollisionLayers();
export const LAYER_PLAYER = layers.define("player");
export const LAYER_PLATFORM = layers.define("platform");
export const LAYER_BULLET = layers.define("bullet");
export const LAYER_ENEMY = layers.define("enemy");

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export const Hurt = defineEvent<{ dir: number }>("hurt");
export const EnemyKilled = defineEvent("enemy:killed");
