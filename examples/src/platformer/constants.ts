import { Vec2, defineEvent } from "@yagejs/core";
import { CollisionLayers } from "@yagejs/physics";
import { sound } from "@yagejs/audio";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const WIDTH = 800;
export const HEIGHT = 600;
export const WORLD_W = 2400;
export const WORLD_H = 800;
export const TOTAL_COINS = 8;
export const SPAWN = new Vec2(100, 600);

/** Screen-space render layer for the in-canvas HUD (coin counter + win banner). */
export const HUD_LAYER = "hud";

// Collision layers
const layers = new CollisionLayers();
export const LAYER_PLAYER = layers.define("player");
export const LAYER_PLATFORM = layers.define("platform");
export const LAYER_COIN = layers.define("coin");
export const LAYER_GOAL = layers.define("goal");
export const LAYER_DEATH = layers.define("death");

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export const CoinCollected = defineEvent("coin:collected");
export const PlayerDied = defineEvent("player:died");
export const GoalReached = defineEvent("goal:reached");

// ---------------------------------------------------------------------------
// Sound asset handles
// ---------------------------------------------------------------------------
export const JumpSfx = sound("/assets/jump.wav");
export const LandSfx = sound("/assets/land.wav");
export const CoinSfx = sound("/assets/coin.wav");
export const HurtSfx = sound("/assets/hurt.wav");
export const WinSfx = sound("/assets/win.wav");
export const BgMusic = sound("/assets/bgm.mp3");
