/**
 * What a scenario's `drive` receives. Types only — the runner builds the
 * object, so a `*.scenario.ts` file that declares a `drive` still imports no
 * runtime engine code.
 */
import type { ExpectStatic } from "@vitest/expect";
import type { Inspector, Scene } from "@yagejs/core";
import type { ControlSchema, ControlValues } from "./controls.js";

type InspectorInput = Inspector["input"];

/** Taken from `Inspector.input` itself, so the facade cannot drift from it. */
type PointerOpts = Parameters<InspectorInput["pointerDown"]>[1];
type PointerUpOpts = Parameters<InspectorInput["pointerUp"]>[1];
type GamepadAxis = Parameters<InspectorInput["gamepadAxis"]>[0];

/**
 * Synthetic input for a driven run.
 *
 * `Inspector.input` cannot be handed over unchanged: its `tap`, `hold` and
 * `fireAction` advance the clock through the synchronous `Inspector.time.step`,
 * which drains nothing a frame started asynchronously. Here every call that
 * advances frames is async and every call that does not is not.
 */
export interface DriveInput {
  keyDown(code: string): void;
  keyUp(code: string): void;
  mouseMove(x: number, y: number): void;
  mouseDown(button?: 0 | 1 | 2): void;
  mouseUp(button?: 0 | 1 | 2): void;
  pointerMove(x: number, y: number, opts?: PointerOpts): void;
  pointerDown(button?: 0 | 1 | 2, opts?: PointerOpts): void;
  pointerUp(button?: 0 | 1 | 2, opts?: PointerUpOpts): void;
  gamepadButton(code: string, pressed: boolean): void;
  gamepadAxis(side: GamepadAxis, value: number): void;
  /** Releases every key, button and synthetic action. */
  clearAll(): void;
  /** Holds an action down until {@link releaseAction}. Needs `InputPlugin`. */
  pressAction(name: string): void;
  releaseAction(name: string): void;
  /**
   * Holds `codes` for the duration of `fn`, then restores what was held
   * before — including when `fn` throws — and resolves with whatever `fn`
   * returned. A code already down on entry is left alone at both ends, so
   * nested holds compose by lexical scope: an inner call that repeats one of
   * the outer call's codes does not drop it, and neither does a code a plain
   * `keyDown` is holding.
   */
  whileHolding<T>(codes: readonly string[], fn: () => Promise<T>): Promise<T>;
  /** {@link hold} for a single frame unless `frames` says otherwise. */
  tap(code: string, frames?: number): Promise<void>;
  /** Holds `code` down for `frames` frames, then releases it. */
  hold(code: string, frames: number): Promise<void>;
  /** Holds the action for `frames` frames, then releases it. Needs `InputPlugin`. */
  fireAction(name: string, frames?: number): Promise<void>;
}

export interface DriveStepOptions {
  /** Milliseconds one frame simulates. Defaults to the clock's fixed step. */
  dtMs?: number;
}

export interface DriveUntilOptions extends DriveStepOptions {
  /** Most frames to advance before rejecting. Defaults to 600. */
  maxFrames?: number;
}

export interface DriveContext<C extends ControlSchema = ControlSchema> {
  /** The scene the run drives. `findByKey` reaches what the scenario spawned. */
  scene: Scene;
  /** What the controls were set to when the run started. */
  controls: ControlValues<C>;
  /** Frames this run has spent so far, counting frames issued any way. */
  readonly framesUsed: number;
  input: DriveInput;
  /**
   * The engine's event log. The run is the only thing issuing frames, so
   * `waitFor` has to be started before the frames that satisfy it and awaited
   * after — awaiting it first parks the run with nothing left to advance it:
   *
   * ```ts
   * const hit = events.waitFor("enemy:hit", { withinFrames: 60 });
   * await step(60);
   * await hit;
   * ```
   */
  events: Inspector["events"];
  /** Advances `frames` frames, one at a time. */
  step(frames?: number, opts?: DriveStepOptions): Promise<void>;
  /**
   * Advances a frame at a time until `predicate` holds, and resolves with the
   * number it took. Rejects after `maxFrames` (600 by default).
   */
  until(predicate: () => boolean, opts?: DriveUntilOptions): Promise<number>;
  /** Jest-style assertions: `expect(hp).toBeLessThan(before)`. */
  expect: ExpectStatic;
  /**
   * Screenshots the canvas into the run's result and resolves with the same
   * PNG data URL.
   */
  capture(label?: string): Promise<string>;
}
