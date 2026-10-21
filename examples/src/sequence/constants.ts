import { defineEvent } from "@yagejs/core";
import type { SequenceRect } from "@yagejs-addons/sequence";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const WIDTH = 960;
export const HEIGHT = 540;

/** Where the clip's authored size is placed on screen. */
export const STAGE: SequenceRect = { x: 60, y: 40, width: 840, height: 420 };

/** The scene's actors, keyed by the clip's target slots. */
export const ACTORS = {
  actorA: { name: "Aster", color: 0x8be9cd, width: 48, height: 68 },
  actorB: { name: "Ember", color: 0xffcc6e, width: 72, height: 48 },
};

/** Seconds the director holds playback after an actor says hello. */
export const GREETING_HOLD = 0.75;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** An actor reached a gesture marker. The clip's `gesture` event emits it. */
export const Gesture = defineEvent<{ name: "hello" | "ready" }>(
  "sequence-example:gesture",
);
