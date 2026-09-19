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

  // Walk the focus demo through each of its regions with the arrow keys.
  // Ends with the confirm dialog cancelled, the save list scrolled down, and
  // focus back on the save row that opened the dialog.
  "ui-focus": {
    warmup: 20,
    actions: [
      // The scope opens on the first tab, so left and right run the strip.
      // Confirm on a tab re-labels the grid beneath it.
      { tap: "ArrowRight", frames: 2 },
      { tap: "ArrowRight", frames: 2 },
      { tap: "Enter", frames: 2 },
      { step: 4 },
      // Down leaves the strip for the pane under the focused tab, and the
      // grid moves by where its cells are drawn rather than by a stored
      // row and column.
      { tap: "ArrowDown", frames: 2 },
      { tap: "ArrowRight", frames: 2 },
      { tap: "ArrowDown", frames: 2 },
      { tap: "ArrowLeft", frames: 2 },
      { step: 4 },
      // Left off the grid's first column crosses into the menu column, where
      // the disabled row is passed over rather than focused.
      { tap: "ArrowLeft", frames: 2 },
      { tap: "ArrowDown", frames: 2 },
      { tap: "ArrowDown", frames: 2 },
      { step: 4 },
      // One held press, repeating at the shipped 0.35 s delay and 0.1 s
      // interval, walks out of the menu, through the two stepper rows and
      // the save-name field, and into the save list past the fold, where the
      // list scrolls to follow the focus.
      { hold: "ArrowDown", frames: 120 },
      { step: 6 },
      // Confirm on the focused save row opens the dialog, which is a nested
      // scope: the move inside it belongs to the dialog, and cancel closes it
      // and hands the keys back to the row that opened it.
      { tap: "Enter", frames: 2 },
      { step: 6 },
      { tap: "ArrowDown", frames: 2 },
      { tap: "Escape", frames: 2 },
      { step: 10 },
    ],
  },
};
