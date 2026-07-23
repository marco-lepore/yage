import type { LayerDef } from "@yagejs/renderer";
import { DIALOGUE_LAYERS } from "@yagejs-addons/dialogue/presenters";

export const WIDTH = 800;
export const HEIGHT = 600;
export const WORLD_WIDTH = 1600; // wider than the canvas → the camera scrolls

export const SKIP_HOLD = 0.6; // hold X this many seconds to confirm a skip
export const AUTO_ADVANCE = 1.5; // seconds between lines when auto-advance is on
export const PLAYER_SPEED = 165; // px/sec

// The key price (50) and Rook's timeout (5s) now live in the dialogue data
// files (`merchant.yaml` / `rook.yaml`).
export const GATE_X = 1410; // the locked gate; blocks progress until unlocked

/** Portrait texture keys for the avatars (drawn on a canvas in onEnter, so the
 *  demo stays asset-free). The Captain uses two expressions in the box; Sage
 *  uses one beside his bubble. */
export const FACE_NEUTRAL = "cap-neutral";
export const FACE_STERN = "cap-stern";
export const FACE_SAGE = "sage-face";
export const FACE_PIP_SMILE = "pip-smile";
export const FACE_PIP_THINK = "pip-think";

/** World-space render layers (under the camera) + the screen-space HUD. The
 *  dialogue box rides DIALOGUE_LAYERS (screen); bubbles ride BUBBLE_LAYER. */
export const ROOM_LAYER = "room";
export const BUBBLE_LAYER = "dialogue-bubble";
export const HUD_LAYER = "hud";
export const LAYERS: LayerDef[] = [
  { name: ROOM_LAYER, order: 10, space: "world" },
  { name: BUBBLE_LAYER, order: 50, space: "world" },
  ...DIALOGUE_LAYERS,
  { name: HUD_LAYER, order: 1200, space: "screen" },
];

/** Mutable walkable area (world coords). `maxX` starts at the gate and extends
 *  when it opens; leaves headroom at the bottom for the dialogue box. */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ── shared game state (the "game" the dialogue bridges into) ──────────────────

/** The host owns this; the dialogue reads/writes it only through the storage
 *  cell (`gold`) and the command handlers (`inventory`). */
export interface GameState {
  gold: number;
  readonly inventory: Set<string>;
}
