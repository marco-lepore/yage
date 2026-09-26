import { defineEvent } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import { DIALOGUE_LAYERS } from "@yagejs-addons/dialogue/presenters";

export const WIDTH = 800;
export const HEIGHT = 600;
export const WORLD_WIDTH = 1600; // wider than the canvas → the camera scrolls

export const SKIP_HOLD = 0.6; // hold X this many seconds to confirm a skip
export const AUTO_ADVANCE = 1.5; // seconds between lines when auto-advance is on
export const PLAYER_SPEED = 165; // px/sec
export const START_GOLD = 25;
export const TALK_RADIUS = 48; // how close the player stands to talk to an NPC

// The key's price (50) and Rook's time limit (5s) are part of the scripts
// (`merchant.yaml` / `rook.yaml`).
export const GATE_X = 1410; // the locked gate; blocks progress until unlocked

/** The walkable area (world coords). The bottom leaves room for the dialogue
 *  box. `maxX` stops at the gate until it opens, then reaches the vault. */
export const WALK_BOUNDS = {
  minX: 40,
  maxX: GATE_X - 32,
  minY: 90,
  maxY: 360,
} as const;
export const OPEN_GATE_MAX_X = WORLD_WIDTH - 40;

/** Portrait texture keys, named by the scripts' `meta.portrait` / `#portrait:`.
 *  `registerTownTextures` bakes and registers them at boot, so the demo stays
 *  asset-free. The Captain and Pip each have two expressions; Sage has one. */
export const FACE_NEUTRAL = "cap-neutral";
export const FACE_STERN = "cap-stern";
export const FACE_SAGE = "sage-face";
export const FACE_PIP_SMILE = "pip-smile";
export const FACE_PIP_THINK = "pip-think";
/** Nine-slice frame texture keys for the "Textured" theme preset. */
export const FRAME_TEXTURE = "town-frame";
export const BUBBLE_TEXTURE = "town-bubble";

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

/** Spawn keys, for `scene.findByKey`. */
export const PLAYER_KEY = "player";
export const DIALOGUE_KEY = "dialogue";

/** The gate emits this on itself when it opens; it bubbles to the scene. */
export const GateOpened = defineEvent("gate:opened");
/** The dialogue host emits this on itself when P pauses or resumes the town. */
export const TownPaused = defineEvent<{ paused: boolean }>("town:paused");
