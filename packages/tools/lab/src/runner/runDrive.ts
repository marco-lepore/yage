import { type Engine, type Scene, ServiceKey } from "@yagejs/core";
import type { ControlValue } from "../grammar/controls.js";
import type { DriveContext, DriveInput } from "../grammar/drive.js";
import { expect } from "./labExpect.js";

/**
 * The context as the runner builds it. `DriveContext<C>` types `controls`
 * against the scenario's own schema, which the registry erases — the runner
 * only ever holds a plain value record.
 */
export interface ErasedDriveContext extends Omit<DriveContext, "controls"> {
  controls: Record<string, ControlValue>;
}

/** One screenshot a run asked for. */
export interface DriveCapture {
  readonly label?: string | undefined;
  /** A `data:image/png;base64,...` URL. */
  readonly dataUrl: string;
}

interface DriveOutcome {
  /** Frames the run issued. */
  readonly framesUsed: number;
  readonly durationMs: number;
  readonly captures: readonly DriveCapture[];
}

/** A failed run always says why, so `error` comes with `ok: false` and only there. */
export type DriveResult =
  | (DriveOutcome & { readonly ok: true })
  | (DriveOutcome & {
      readonly ok: false;
      /** The assertion message, or whatever else the run threw. */
      readonly error: string;
    });

/**
 * Declared here rather than imported from `@yagejs/input`, so a game without
 * that package can still run a `drive` that never presses an action. Services
 * resolve by key id, so this key finds the game's own `InputManager`. The
 * Inspector declares the same key for the same reason.
 */
const InputManagerRuntimeKey = new ServiceKey<InputManagerLike>("inputManager");

/** The two calls that press and release an action without advancing the clock. */
interface InputManagerLike {
  fireActionDown(name: string): void;
  fireActionUp(name: string): void;
}

function requireActions(engine: Engine, call: string): InputManagerLike {
  const manager = engine.context.tryResolve(InputManagerRuntimeKey);
  if (!manager) {
    throw new Error(`input.${call}() requires InputPlugin to be active.`);
  }
  return manager;
}

/**
 * Builds the object a scenario's `drive` is called with. `captures` is the
 * array `capture()` appends to, which the result carries away.
 */
export function createDriveContext(
  engine: Engine,
  scene: Scene,
  controls: Record<string, ControlValue>,
  captures: DriveCapture[],
): ErasedDriveContext {
  const { capture, events, input: raw, time } = engine.inspector;

  const hold = async (code: string, frames: number): Promise<void> => {
    raw.keyDown(code);
    try {
      await time.stepAsync(frames);
    } finally {
      raw.keyUp(code);
    }
  };

  const input: DriveInput = {
    keyDown: (code) => {
      raw.keyDown(code);
    },
    keyUp: (code) => {
      raw.keyUp(code);
    },
    mouseMove: (x, y) => {
      raw.mouseMove(x, y);
    },
    mouseDown: (button) => {
      raw.mouseDown(button);
    },
    mouseUp: (button) => {
      raw.mouseUp(button);
    },
    pointerMove: (x, y, opts) => {
      raw.pointerMove(x, y, opts);
    },
    pointerDown: (button, opts) => {
      raw.pointerDown(button, opts);
    },
    pointerUp: (button, opts) => {
      raw.pointerUp(button, opts);
    },
    gamepadButton: (code, pressed) => {
      raw.gamepadButton(code, pressed);
    },
    gamepadAxis: (side, value) => {
      raw.gamepadAxis(side, value);
    },
    clearAll: () => {
      raw.clearAll();
    },
    pressAction: (name) => {
      requireActions(engine, "pressAction").fireActionDown(name);
    },
    releaseAction: (name) => {
      requireActions(engine, "releaseAction").fireActionUp(name);
    },

    tap: (code, frames = 1) => hold(code, frames),
    hold,
    // A sustained press rather than `Inspector.input.fireAction`'s one-frame
    // pulse per frame, so hold duration and the release edge read as they do
    // for a player holding the key.
    fireAction: async (name, frames = 1) => {
      const manager = requireActions(engine, "fireAction");
      manager.fireActionDown(name);
      try {
        await time.stepAsync(frames);
      } finally {
        manager.fireActionUp(name);
      }
    },
  };

  return {
    scene,
    controls,
    input,
    events,
    expect,
    step: async (frames = 1) => {
      await time.stepAsync(frames);
    },
    until: (predicate, opts) => time.stepUntil(predicate, opts),
    capture: async (label) => {
      // A data URL rather than `capture.png()`'s bytes: it goes straight into
      // an `<img>`, and it survives being read out of the page as a string.
      const dataUrl = await capture.dataURL();
      captures.push({ label, dataUrl });
      return dataUrl;
    },
  };
}

/**
 * Runs a scenario's `drive` against the mounted scene and reports what
 * happened. Nothing throws out of here — an assertion failure is the result.
 *
 * The caller owns the clock: the run issues its own frames, so it has to
 * happen with the clock control stopped and the clock already frozen.
 */
export async function runDrive(
  engine: Engine,
  scene: Scene,
  controls: Record<string, ControlValue>,
  drive: (ctx: ErasedDriveContext) => Promise<void>,
): Promise<DriveResult> {
  const time = engine.inspector.time;
  const captures: DriveCapture[] = [];
  const startFrame = time.getFrame();
  const startedAt = performance.now();
  let error: string | undefined;

  try {
    await drive(createDriveContext(engine, scene, controls, captures));
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  const outcome: DriveOutcome = {
    framesUsed: time.getFrame() - startFrame,
    durationMs: performance.now() - startedAt,
    captures,
  };
  return error === undefined
    ? { ...outcome, ok: true }
    : { ...outcome, ok: false, error };
}
