import { texture } from "@yagejs/renderer";
import { sound } from "@yagejs/audio";

// Asset handles. `GameScene.preload` lists them, so each one is loaded before
// the scene's `onEnter` runs.
export const playerIdleTex = texture("/assets/player-idle.png");
export const playerWalkTex = texture("/assets/player-walk.png");
export const playerJumpTex = texture("/assets/player-jump.png");
export const coinTex = texture("/assets/coin.png");
export const slimeTex = texture("/assets/slime_purple.png");
export const jumpSfx = sound("/assets/jump.wav");
export const hurtSfx = sound("/assets/hurt.wav");

/** Player sprite strips use 48×48 frames. */
export const PLAYER_FRAME_SIZE = 48;
/** Coin sprite strip uses 16×16 frames. */
export const COIN_FRAME_SIZE = 16;
/** Slime sprite sheet first row: 24×24 frames. */
export const SLIME_FRAME_SIZE = 24;
