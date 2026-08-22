import { type Engine, type Scene, ServiceKey } from "@yagejs/core";
import type { ControlValue } from "../grammar/controls.js";
import type {
  DriveContext,
  DriveInput,
  DriveStepOptions,
  DriveUntilOptions,
} from "../grammar/drive.js";
import { captureLab, type CaptureView } from "./labCapture.js";
import { expect } from "./labExpect.js";

export type RunPace = "immediate" | "frame";

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
  readonly warnings: readonly string[];
}

/**
 * A failed run always says why, so `error` comes with `ok: false` and only
 * there. `value` is what the driven callback returned — `void` for a
 * scenario's own `drive`, whatever an ad-hoc `LabApi.drive` callback returns.
 */
export type DriveResult<T = void> =
  | (DriveOutcome & { readonly ok: true; readonly value: T })
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

interface DriveContextOptions {
  readonly pace?: RunPace | undefined;
  readonly captureView?: CaptureView | undefined;
  readonly warnings?: string[] | undefined;
}

interface RunDriveOptions {
  readonly pace?: RunPace;
  readonly captureView?: CaptureView;
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
  opts: DriveContextOptions = {},
): ErasedDriveContext {
  const { events, input: raw, time } = engine.inspector;
  const pace = opts.pace ?? "immediate";
  const warnings = opts.warnings ?? [];

  const waitForAnimationFrame = (): Promise<void> =>
    new Promise((resolve) => {
      // Browsers pause animation frames in background tabs. A frame-paced run
      // resumes when the tab is focused; `yage-lab test` uses immediate pace.
      requestAnimationFrame(() => resolve());
    });

  const stepAsync = (
    frames: number,
    stepOpts?: DriveStepOptions,
  ): Promise<void> => time.stepAsync(frames, stepOpts);

  const advance = async (
    frames: number,
    stepOpts?: DriveStepOptions,
  ): Promise<void> => {
    if (pace === "immediate") {
      await stepAsync(frames, stepOpts);
      return;
    }
    // A count the loop cannot pace goes to the engine, which is where a bad
    // one is rejected and where zero frames means zero frames.
    if (!Number.isInteger(frames) || frames <= 0) {
      await stepAsync(frames, stepOpts);
      return;
    }
    for (let frame = 0; frame < frames; frame++) {
      await stepAsync(1, stepOpts);
      await waitForAnimationFrame();
    }
  };

  const until = async (
    predicate: () => boolean,
    untilOpts?: DriveUntilOptions,
  ): Promise<number> => {
    if (predicate()) return 0;
    const maxFrames = untilOpts?.maxFrames ?? 600;
    if (!Number.isInteger(maxFrames) || maxFrames < 0) {
      throw new Error(
        "drive.until(): maxFrames must be a non-negative integer.",
      );
    }
    const stepOpts =
      untilOpts?.dtMs === undefined ? undefined : { dtMs: untilOpts.dtMs };
    for (let frame = 1; frame <= maxFrames; frame++) {
      await advance(1, stepOpts);
      if (predicate()) return frame;
    }
    throw new Error(
      `drive.until(): predicate still false after ${maxFrames} frames.`,
    );
  };

  // One capture warning says the same thing however many captures raised it.
  const addWarnings = (raised: readonly string[]): void => {
    for (const warning of raised) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  };

  const hold = async (code: string, frames: number): Promise<void> => {
    raw.keyDown(code);
    try {
      await advance(frames);
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
        await advance(frames);
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
    step: (frames = 1, stepOpts) => advance(frames, stepOpts),
    until,
    capture: async (label) => {
      // A data URL rather than `capture.png()`'s bytes: it goes straight into
      // an `<img>`, and it survives being read out of the page as a string.
      const captured = await captureLab(engine, opts.captureView ?? "content");
      addWarnings(captured.warnings);
      captures.push({ label, dataUrl: captured.dataUrl });
      return captured.dataUrl;
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
export async function runDrive<T = void>(
  engine: Engine,
  scene: Scene,
  controls: Record<string, ControlValue>,
  drive: (ctx: ErasedDriveContext) => Promise<T> | T,
  opts: RunDriveOptions = {},
): Promise<DriveResult<T>> {
  const time = engine.inspector.time;
  const captures: DriveCapture[] = [];
  const warnings: string[] = [];
  const startFrame = time.getFrame();
  const startedAt = performance.now();
  let error: string | undefined;
  let value: T | undefined;

  try {
    value = await drive(
      createDriveContext(engine, scene, controls, captures, {
        pace: opts.pace,
        captureView: opts.captureView,
        warnings,
      }),
    );
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  const outcome: DriveOutcome = {
    framesUsed: time.getFrame() - startFrame,
    durationMs: performance.now() - startedAt,
    captures,
    warnings,
  };
  return error === undefined
    ? { ...outcome, ok: true, value: value as T }
    : { ...outcome, ok: false, error };
}
