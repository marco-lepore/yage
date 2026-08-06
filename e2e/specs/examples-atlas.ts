/**
 * Atlas of deterministic scripts for the shipped examples (examples/*.html).
 *
 * The runner (examples.spec.ts) auto-discovers every example HTML file and
 * loads it with `?test`, which boots the engine frozen and seeded. For each
 * example it advances `warmup` frames, replays `actions`, then captures a
 * stable inspector snapshot — used by the example-snapshot-diff workflow to
 * compare two branches, and otherwise as a boots-cleanly smoke test.
 *
 * Examples not listed here get the default treatment: advance DEFAULT_WARMUP
 * frames, then snapshot. Add an entry only when an example needs input to reach
 * an interesting state, a different warmup, or a skip.
 */

/** A single deterministic input action, replayed in-page against the inspector. */
export type AtlasAction =
  | { step: number } // advance N frames with no input
  | { tap: string; frames?: number } // key down, advance, key up
  | { hold: string; frames: number } // alias of tap with an explicit duration
  | { keyDown: string }
  | { keyUp: string }
  | { action: string; frames?: number } // inspector.input.fireAction
  | { pointerMove: [number, number] }
  | { click: [number, number]; button?: 0 | 1 | 2 }; // move + down + up at a point

export interface ExampleScript {
  /** Frames to advance before replaying actions (lets the scene settle). */
  warmup?: number;
  /** Deterministic input sequence performed after warmup. */
  actions?: AtlasAction[];
  /** Skip this example entirely. */
  skip?: boolean;
  /** Human-readable reason, surfaced in the test title when skipped. */
  reason?: string;
}

/** Frames advanced for examples without an explicit `warmup`. */
export const DEFAULT_WARMUP = 20;

export const EXAMPLE_SCRIPTS: Record<string, ExampleScript> = {
  // The slow asset loader is driven by wall-clock setTimeout, which keeps
  // running while the render clock is frozen — so the loaded-vs-loading state
  // at snapshot time is a race. Revisit once the loader can be frame-driven.
  "loading-scene": {
    skip: true,
    reason: "async loader uses wall-clock timers, not the frozen clock",
  },

  // --- Input-scripted examples (representative coverage) -------------------

  // Run right along the ground, then jump. Exercises the platformer
  // controller, physics integration, and grounded/jump-buffer logic.
  platformer: {
    warmup: 10,
    actions: [
      { hold: "KeyD", frames: 40 },
      { tap: "Space", frames: 30 },
    ],
  },

  // Move right, then fire. Exercises movement + the shoot cooldown / spawn.
  shooter: {
    warmup: 10,
    actions: [
      { hold: "KeyD", frames: 30 },
      { tap: "KeyJ", frames: 20 },
    ],
  },

  // Drive player 1 right then left. Exercises the action-map bindings the
  // remapping UI edits (KeyD = p1Right, KeyA = p1Left).
  "input-remapping": {
    warmup: 5,
    actions: [
      { hold: "KeyD", frames: 20 },
      { hold: "KeyA", frames: 20 },
    ],
  },

  // Move toward an enemy, slash, dash, then drink a potion. Exercises the
  // Abilities addon's timeline runner + hit contract end to end.
  "abilities-addon": {
    warmup: 10,
    actions: [
      { hold: "KeyD", frames: 30 },
      { tap: "Space", frames: 20 },
      { tap: "ShiftLeft", frames: 15 },
      { tap: "KeyQ", frames: 10 },
    ],
  },

  // The scene opens already roped and swinging. Let it swing, convert the
  // live grapple to elastic with E, then re-grapple elsewhere with a click.
  "physics-joints": {
    warmup: 10,
    actions: [
      { step: 90 },
      { tap: "KeyE", frames: 10 },
      { click: [600, 180] },
      { step: 120 },
    ],
  },
};
