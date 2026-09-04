import { Phase, Vec2 } from "@yagejs/core";
import type { RendererAdapter, ErrorBoundary } from "@yagejs/core";
import { applyRadialDeadzone } from "./deadzone.js";
import type {
  ActionMapDefinition,
  BufferedPressOptions,
  CameraLike,
  GamepadAxisKey,
  GamepadInfo,
  HoldDurationOptions,
  InputClock,
  InputActionSource,
  PointerPressInfo,
  PointerPressOptions,
  PointerEventInfo,
  PointerInfo,
  PointerType,
  RebindOptions,
  RebindResult,
  SchedulerLike,
} from "./types.js";

/** Action-map codes for the three primary mouse buttons, indexed by button. */
const MOUSE_BUTTON_CODES = ["MouseLeft", "MouseMiddle", "MouseRight"] as const;

/** Mutable internal pointer record. Exposed externally as the read-only {@link PointerInfo}. */
interface MutablePointerInfo {
  id: number;
  generation: number;
  screenPos: Vec2;
  type: PointerType;
  isPrimary: boolean;
  buttons: Set<number>;
  isDown: boolean;
}

/**
 * DOM-originated input events buffered between the browser dispatch tick and
 * the next `InputPollSystem` drain at `Phase.EarlyUpdate`. Synthetic injection
 * (`fireKeyDown`, `firePointerDown`, etc.) bypasses the queue and applies state
 * synchronously through `_apply*` to keep test ergonomics intact.
 */
type BufferedInputEvent =
  | { kind: "keyDown"; code: string }
  | { kind: "keyUp"; code: string }
  | { kind: "pointerDown"; info: PointerEventInfo; generation: number }
  | { kind: "pointerUp"; info: PointerEventInfo; generation: number }
  | {
      kind: "pointerCancel";
      id: number;
      generation: number;
      hadActivePress: boolean;
    }
  | { kind: "wheel"; dx: number; dy: number; screenX: number; screenY: number };

interface QueuedPointerState {
  generation: number;
  buttons: Set<number>;
  type: PointerType;
  isPrimary: boolean;
  terminalQueued: boolean;
}

interface FramePointerPress {
  info: PointerInfo;
  worldPos: Vec2;
  consumed: boolean;
}

/** Standard-mapping button codes, indexed by W3C button position. */
const STANDARD_BUTTON_CODES = [
  "GamepadA",
  "GamepadB",
  "GamepadX",
  "GamepadY",
  "GamepadLB",
  "GamepadRB",
  "GamepadLT",
  "GamepadRT",
  "GamepadSelect",
  "GamepadStart",
  "GamepadLeftStick",
  "GamepadRightStick",
  "GamepadDPadUp",
  "GamepadDPadDown",
  "GamepadDPadLeft",
  "GamepadDPadRight",
  "GamepadHome",
] as const;

const TRIGGER_LEFT_INDEX = 6;
const TRIGGER_RIGHT_INDEX = 7;
const STICK_DIRECTION_PRESS_THRESHOLD = 0.5;
const STICK_DIRECTION_RELEASE_THRESHOLD = 0.375;

const STICK_AXIS_KEYS: Record<
  "left" | "right",
  { x: GamepadAxisKey; y: GamepadAxisKey }
> = {
  left: { x: "leftX", y: "leftY" },
  right: { x: "rightX", y: "rightY" },
};

const TRIGGER_AXIS_KEYS: Record<"left" | "right", GamepadAxisKey> = {
  left: "leftTrigger",
  right: "rightTrigger",
};

/** Standard-mapping axis indices map to semantic axis keys. */
const STANDARD_AXIS_KEYS: readonly GamepadAxisKey[] = [
  "leftX",
  "leftY",
  "rightX",
  "rightY",
];

/**
 * Press, hold, and release bookkeeping measured on one time source. The raw
 * input clock gets one of these, and so does every clock registered through
 * {@link InputManager._registerClock}, so a query can answer on whichever clock
 * the caller names.
 *
 * Times are stored in the source's own unit — milliseconds for the input clock,
 * seconds for a scene clock — and {@link ClockState.perSecond} converts a
 * difference to seconds.
 */
interface ClockState {
  /** The registered clock this state measures, or `null` for the raw input clock. */
  readonly source: InputClock | null;
  /** Units per second of `source`: 1000 for the millisecond input clock, 1 for a scene clock. */
  readonly perSecond: number;
  /** Hold start per key code, for the hold-duration queries. */
  holdStart: Map<string, number>;
  /** Hold start per action for one-frame synthetic pulses. */
  syntheticStart: Map<string, number>;
  /** Hold length of the press that ended this frame, keyed by action. Valid only in the release frame. */
  releaseDuration: Map<string, number>;
  /** Hold length of a release edge per action, tagged with the fixed-step window it belongs to. */
  stepReleaseDuration: Map<string, { duration: number; tag: number }>;
  /** Per-action hold at the end of the previous frame — the frame baseline for {@link InputManager.isJustHeldFor}. */
  prevHold: Map<string, number>;
  /** Per-action hold at the previous step-window rotation — the fixed-step baseline. */
  stepPrevHold: Map<string, number>;
  /** Per-action hold sampled at the latest rotation; becomes the next window's baseline. */
  stepHoldSnapshot: Map<string, number>;
  /** Last press time per action, for {@link InputManager.consumeBufferedPress}. */
  pressStamp: Map<string, number>;
}

class ManagerActionSource implements InputActionSource {
  constructor(
    private readonly manager: InputManager,
    private readonly id: number,
  ) {}

  setHeld(action: string, held: boolean): void {
    this.manager._setActionSourceHeld(this.id, action, held);
  }

  releaseAll(): void {
    this.manager._releaseActionSource(this.id);
  }
}

function createClockState(
  source: InputClock | null,
  perSecond: number,
): ClockState {
  return {
    source,
    perSecond,
    holdStart: new Map(),
    syntheticStart: new Map(),
    releaseDuration: new Map(),
    stepReleaseDuration: new Map(),
    prevHold: new Map(),
    stepPrevHold: new Map(),
    stepHoldSnapshot: new Map(),
    pressStamp: new Map(),
  };
}

/** Central input state manager. Resolved via DI with InputManagerKey. */
export class InputManager {
  private pressedKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  private justReleasedKeys = new Set<string>();
  /** Press, hold, and release bookkeeping on the raw input clock, in milliseconds. */
  private readonly rawState = createClockState(null, 1000);
  /** The same bookkeeping per registered clock, in that clock's seconds. */
  private readonly clockStates = new Map<InputClock, ClockState>();
  /** One-frame synthetic action pulses from {@link fireAction}, cleared each frame. */
  private pulsedSyntheticActions = new Set<string>();
  /** Actions pressed in the current frame by any physical or synthetic code. */
  private actionPressesThisFrame = new Set<string>();
  /** Actions released in the current frame by any physical or synthetic code. */
  private actionReleasesThisFrame = new Set<string>();
  /** Action mapping captured when each currently-held code was pressed. */
  private activePressActions = new Map<string, readonly string[]>();
  /** Internal codes owned by action sources, excluded from public key listeners. */
  private syntheticCodes = new Set<string>();
  /** Held internal codes per action source. */
  private sourceCodes = new Map<number, Set<string>>();
  private nextActionSourceId = 1;
  /** Actions whose buffered press has been claimed via {@link consumeBufferedPress}; cleared by the next press. */
  private claimedBufferedPress = new Set<string>();
  /**
   * Fixed-step edge windows. Each map records, per key code or action name,
   * the scheduler's fixed-step count at the moment the edge arrived. An edge
   * tagged `s` belongs to the window of step `s + 1` — the first fixed step
   * to start after it — so a query made during `Phase.FixedUpdate` matches
   * entries tagged exactly one below the running step's index. Entries
   * survive {@link _clearFrameState} (a frame can run zero steps) and are
   * pruned once their step has passed.
   */
  private stepPressTags = new Map<string, number>();
  /** Release edges per key code, tagged like {@link stepPressTags}. */
  private stepReleaseTags = new Map<string, number>();
  /** Synthetic action pulses ({@link fireAction}), tagged like {@link stepPressTags}. */
  private stepPulseTags = new Map<string, number>();
  /** Action press edges from any code, tagged like {@link stepPressTags}. */
  private stepActionPressTags = new Map<string, number>();
  /** Action release edges from any code, tagged like {@link stepPressTags}. */
  private stepActionReleaseTags = new Map<string, number>();
  /** Step index of the latest hold-baseline rotation, shared by every clock. */
  private stepHoldRotatedAt = -1;
  /**
   * Scheduler for calling-context resolution, wired by {@link _setScheduler}.
   * When null (standalone manager, no plugin), every query resolves against
   * the frame window.
   */
  private scheduler: SchedulerLike | null = null;
  private actionMap = new Map<string, string[]>();
  private defaultBindings = new Map<string, string[]>();
  private groups = new Map<string, Set<string>>();
  private actionGroups = new Map<string, Set<string>>();
  private disabledGroups = new Set<string>();
  /** Tracked pointers keyed by `pointerId`. Mouse persists; touch/pen removed on up/cancel. */
  private pointers = new Map<number, MutablePointerInfo>();
  /** Browser-order pointer state used to assign generations before queue drain. */
  private queuedPointers = new Map<number, QueuedPointerState>();
  private nextPointerGeneration = 1;
  /** Pointer-down edges retained until the end of the rendered frame. */
  private pointerPressesThisFrame: FramePointerPress[] = [];
  /** Id of the pointer the browser last marked `isPrimary`, or `null` when none are tracked. */
  private primaryPointerId: number | null = null;
  /**
   * Aggregate "any pointer has this button held" cache. The action-map codes
   * `MouseLeft`/`MouseMiddle`/`MouseRight` are driven from edges into/out of this
   * set so two simultaneous taps holding button 0 do not double-fire.
   * Consumed pointers are excluded from the aggregate so UI-claimed presses
   * never propagate to gameplay actions.
   */
  private mouseButtonAggregate = new Set<number>();
  /**
   * Pointers marked as "claimed" via {@link consumePointer} (or auto-claimed by
   * the renderer's UI hit-test fallback). Lifetime is per-pointer-event-cycle:
   * cleared when the pointer's last button releases (drained `pointerUp`) or on
   * `pointercancel`.
   */
  private consumedPointers = new Map<number, number>();
  /** Pointer generation whose listeners are currently running. */
  private activePointerDispatch: { id: number; generation: number } | null =
    null;
  /** Claim state for each active wheel dispatch, including nested injection. */
  private wheelClaims: boolean[] = [];
  /** Buffered DOM-originated events awaiting drain at `Phase.EarlyUpdate`. */
  private inputQueue: BufferedInputEvent[] = [];
  /**
   * Renderer reference for the optional `hitTestUI(x, y)` lookup. Stashed by
   * {@link _setRenderer} during `InputPlugin.install` so the drain step can
   * read it cheaply each frame.
   */
  private renderer: RendererAdapter | null = null;
  /**
   * Wired by {@link _setErrorBoundary} during `InputPlugin.install`, since
   * this manager is constructed directly (no `EngineContext` of its own)
   * rather than resolved through DI.
   */
  private errorBoundary: ErrorBoundary | undefined;
  private pointerDownListeners: Array<(info: PointerInfo) => void> = [];
  private pointerUpListeners: Array<(info: PointerInfo) => void> = [];
  private pointerMoveListeners: Array<(info: PointerInfo) => void> = [];
  private keyDownListenersAny: Array<(code: string) => void> = [];
  private keyUpListenersAny: Array<(code: string) => void> = [];
  private keyDownListeners = new Map<string, Array<(code: string) => void>>();
  private keyUpListeners = new Map<string, Array<(code: string) => void>>();
  private actionListeners = new Map<string, Array<(name: string) => void>>();
  private actionReleasedListeners = new Map<
    string,
    Array<(name: string) => void>
  >();
  private wheelListeners: Array<(dx: number, dy: number) => void> = [];
  /** Real-pad axis values keyed by `${padIndex}:${axisKey}`. */
  private gamepadAxisState = new Map<string, number>();
  /** Synthetic axis values for fireGamepadAxis injection (test path). */
  private syntheticAxisState = new Map<GamepadAxisKey, number>();
  /** "Any pad" aggregate of currently-pressed gamepad codes. */
  private lastButtonState = new Map<string, boolean>();
  /** Per-pad "anything happening" flag, used to detect rising-edge activity for active-pad promotion. */
  private lastPadActivity = new Map<number, boolean>();
  /** Pads currently known to the engine (populated via events or polling). */
  private connectedPads = new Map<number, GamepadInfo>();
  /** Index of the pad whose analog input is read by default. `null` when no pad is connected. */
  private activePadIndex: number | null = null;
  private gamepadConnectListeners: Array<(info: GamepadInfo) => void> = [];
  private gamepadDisconnectListeners: Array<(info: GamepadInfo) => void> = [];
  private activePadListeners: Array<(info: GamepadInfo | null) => void> = [];
  private stickDeadzone = 0.15;
  private triggerDeadzone = 0.05;
  private triggerThreshold = 0.5;
  private pollingEnabled = true;
  private camera: CameraLike | null = null;
  private elapsedMs = 0;
  private listenResolve: ((key: string | null) => void) | null = null;

  // -- Action-based queries --

  /** Whether any currently-held code captured this action at press time. */
  private isActionHeldByCode(action: string): boolean {
    for (const actions of this.activePressActions.values()) {
      if (actions.includes(action)) return true;
    }
    return false;
  }

  /** Whether any key mapped to this action is currently held. */
  isPressed(action: string): boolean {
    if (!this.isActionEnabled(action)) return false;
    return (
      this.pulsedSyntheticActions.has(action) || this.isActionHeldByCode(action)
    );
  }

  /**
   * Whether a press edge for the action landed in the caller's query window.
   *
   * The window matches the calling context. From frame-phase code (`update`,
   * listeners, any non-fixed system) it is the current rendered frame. From
   * fixed-step code (`fixedUpdate`, `Phase.FixedUpdate` systems) it is the
   * current fixed step: the edges that arrived since the previous step began.
   * Each context sees a press exactly once — when several fixed steps run in
   * one frame only the first sees it, and a press in a frame that runs no
   * fixed step is held for the next step.
   */
  isJustPressed(action: string): boolean {
    if (!this.isActionEnabled(action)) return false;
    const window = this.currentStepWindow();
    if (window === null) {
      return (
        this.pulsedSyntheticActions.has(action) ||
        this.actionPressesThisFrame.has(action)
      );
    }
    return (
      this.stepPulseTags.get(action) === window ||
      this.stepActionPressTags.get(action) === window
    );
  }

  /**
   * Whether a release edge for the action landed in the caller's query
   * window — the current frame or the current fixed step, matching the
   * calling context like {@link isJustPressed}.
   */
  isJustReleased(action: string): boolean {
    if (!this.isActionEnabled(action)) return false;
    const window = this.currentStepWindow();
    if (window === null) {
      return this.actionReleasesThisFrame.has(action);
    }
    return this.stepActionReleaseTags.get(action) === window;
  }

  /** Whether any binding (key or synthetic) still holds the action, ignoring group enablement. */
  private isActionStillHeld(action: string): boolean {
    return (
      this.isActionHeldByCode(action) || this.pulsedSyntheticActions.has(action)
    );
  }

  /** Tag for an edge arriving now: the number of fixed steps started so far. */
  private stepTag(): number {
    return this.scheduler?.fixedStepIndex ?? 0;
  }

  /** The raw input clock's state, then every registered clock's. */
  private *allStates(): IterableIterator<ClockState> {
    yield this.rawState;
    yield* this.clockStates.values();
  }

  /** Current reading of a state's time source, in that source's own unit. */
  private stateNow(state: ClockState): number {
    return state.source ? state.source.elapsed : this.elapsedMs;
  }

  /**
   * The state a query measures on. `undefined` selects the raw input clock;
   * anything else must be a clock the plugin registered, since a clock the
   * manager never saw carries no stamps to measure against. `subject` names
   * what the calling query measures, so the failure reads in that query's own
   * terms.
   */
  private resolveState(
    method: string,
    subject: "press" | "hold",
    clock: InputClock | undefined,
  ): ClockState {
    if (!clock) return this.rawState;
    const state = this.clockStates.get(clock);
    if (!state) {
      throw new Error(
        `InputManager.${method}(): the given clock is not registered, ` +
          `so no ${subject} can be measured on it. The input plugin registers a scene's ` +
          "SceneTime while the scene is on the stack and drops it on exit — the " +
          "usual causes are holding on to an exited scene's SceneTime, or a clock " +
          "the engine never saw.",
      );
    }
    return state;
  }

  /**
   * The step-window tag the current caller resolves against, or null when
   * the caller is not inside `Phase.FixedUpdate` (frame-window semantics).
   * During step `k` the visible window holds edges tagged `k - 1` — those
   * that arrived after the previous step began.
   */
  private currentStepWindow(): number | null {
    const scheduler = this.scheduler;
    if (!scheduler || scheduler.currentPhase !== Phase.FixedUpdate) return null;
    return scheduler.fixedStepIndex - 1;
  }

  /**
   * Rotate the fixed-step hold baseline on every clock: on the first
   * fixed-step hold query of a new step, the holds sampled at the previous
   * rotation become this window's baseline, and current holds are re-sampled
   * for the next one. Query-driven, so a caller polling {@link isJustHeldFor}
   * every step gets an exact step-over-step crossing test.
   */
  private rotateStepHolds(step: number): void {
    if (this.stepHoldRotatedAt === step) return;
    const isFirstRotation = this.stepHoldRotatedAt === -1;
    this.stepHoldRotatedAt = step;
    for (const state of this.allStates()) {
      const recycled = state.stepPrevHold;
      state.stepPrevHold = state.stepHoldSnapshot;
      recycled.clear();
      for (const action of this.actionMap.keys()) {
        const hold = this.rawHoldOn(action, state);
        if (hold > 0) recycled.set(action, hold);
      }
      state.stepHoldSnapshot = recycled;
      // The first rotation has no earlier sample to serve as a baseline. Seed
      // it with the current holds so an ongoing hold does not read as a fresh
      // crossing — matching the frame baseline, which is maintained every
      // frame whether or not anyone polls.
      if (isFirstRotation) {
        for (const [action, hold] of recycled) {
          state.stepPrevHold.set(action, hold);
        }
      }
    }
  }

  /**
   * Drop the fixed-step hold baseline for every action bound to `code`
   * whose hold has fully ended. A full release ends the hold's identity:
   * the next press's threshold crossing must be measured from zero, not
   * against the previous press's sample. Raw (enablement-ignoring),
   * matching how the baselines are sampled.
   */
  private clearEndedStepHoldBaselines(actions: readonly string[]): void {
    for (const action of actions) {
      for (const state of this.allStates()) {
        if (this.rawHoldOn(action, state) === 0) {
          state.stepPrevHold.delete(action);
          state.stepHoldSnapshot.delete(action);
        }
      }
    }
  }

  /**
   * Hold duration across all keys and synthetic sources mapped to the action,
   * in `state`'s own unit; 0 if not held. Ignores group enablement, matching
   * how the hold baselines are sampled.
   */
  private rawHoldOn(action: string, state: ClockState): number {
    const now = this.stateNow(state);
    let maxDuration = 0;
    for (const [key, actions] of this.activePressActions) {
      if (!actions.includes(action)) continue;
      const start = state.holdStart.get(key);
      if (start !== undefined) {
        maxDuration = Math.max(maxDuration, now - start);
      }
    }
    if (this.pulsedSyntheticActions.has(action)) {
      const syntheticStart = state.syntheticStart.get(action);
      if (syntheticStart !== undefined) {
        maxDuration = Math.max(maxDuration, now - syntheticStart);
      }
    }
    return maxDuration;
  }

  /**
   * Seconds the action has been held. Returns 0 if not held.
   *
   * The duration counts on the raw input clock ({@link getClockTime}), which
   * ignores scene pause and time scale — a charge keeps charging through a
   * pause menu. Pass `options.clock` — the `SceneTime` of a scene on the stack
   * — to count it on that scene's simulation time instead, so the hold stops
   * with the scene and follows its time scale; any other clock throws.
   */
  getHoldDuration(action: string, options?: HoldDurationOptions): number {
    const state = this.resolveState("getHoldDuration", "hold", options?.clock);
    return this.holdDurationOn(action, state);
  }

  /** Seconds held on `state`'s clock; 0 for a disabled action, as everywhere else. */
  private holdDurationOn(action: string, state: ClockState): number {
    if (!this.isActionEnabled(action)) return 0;
    return this.rawHoldOn(action, state) / state.perSecond;
  }

  /**
   * Seconds elapsed on the raw input clock.
   *
   * This clock advances from the engine's unscaled frame time. Scene pause and
   * time scaling do not affect it.
   */
  getClockTime(): number {
    return this.elapsedMs / 1000;
  }

  /**
   * Whether the action has been held for at least `minSeconds`. Counts on the
   * raw input clock unless `options.clock` names a registered scene clock,
   * like {@link getHoldDuration}.
   */
  isHeldFor(
    action: string,
    minSeconds: number,
    options?: HoldDurationOptions,
  ): boolean {
    // Resolved here rather than delegating to getHoldDuration so an unusable
    // clock names the method the caller actually wrote.
    const state = this.resolveState("isHeldFor", "hold", options?.clock);
    return this.holdDurationOn(action, state) >= minSeconds;
  }

  /**
   * Hold-start edge: true only in the query window where the action's hold
   * crosses `seconds` — the current frame or the current fixed step,
   * matching the calling context like {@link isJustPressed}. Threshold-
   * crossing math over the hold clock, so any call-site threshold works
   * with no per-action config. Drives "released before T = a tap, crossed
   * T = hold-start" input feel. A tap (released before the threshold) never
   * fires it — the hold resets to 0 in the release window.
   *
   * The hold counts on the raw input clock unless `options.clock` names a
   * registered scene clock, like {@link getHoldDuration}. Each clock carries
   * its own crossing baseline, so a threshold reached on scene time fires
   * exactly once there whatever the raw clock has done meanwhile.
   */
  isJustHeldFor(
    action: string,
    seconds: number,
    options?: HoldDurationOptions,
  ): boolean {
    const state = this.resolveState("isJustHeldFor", "hold", options?.clock);
    if (!this.isActionEnabled(action)) return false;
    const hold = this.rawHoldOn(action, state);
    if (hold <= 0) return false;
    const threshold = seconds * state.perSecond;
    const window = this.currentStepWindow();
    let baseline: number;
    if (window === null) {
      baseline = state.prevHold.get(action) ?? 0;
    } else {
      this.rotateStepHolds(window + 1);
      baseline = state.stepPrevHold.get(action) ?? 0;
    }
    return hold >= threshold && baseline < threshold;
  }

  /**
   * Seconds the action was held, valid only in the query window where the
   * action is fully released — the last pressed binding (key or synthetic)
   * lets go; a chord's partial release reports 0. The window is the current
   * frame or the current fixed step, matching the calling context like
   * {@link isJustPressed}. Captured at the release edge, so it survives
   * {@link getHoldDuration} resetting to 0 in that same window — no
   * sample-before-release dance needed.
   *
   * The length counts on the raw input clock unless `options.clock` names a
   * registered scene clock, like {@link getHoldDuration}. Each clock captures
   * its own length at the release, so a hold spanning a pause reports the
   * scene's simulation seconds on the scene clock, and the whole span
   * including the pause on the raw one. A
   * hold that began before a clock was registered reports only the part
   * measured since, matching how it counted while held.
   */
  getReleaseDuration(action: string, options?: HoldDurationOptions): number {
    const state = this.resolveState(
      "getReleaseDuration",
      "hold",
      options?.clock,
    );
    return this.releaseDurationOn(action, state) ?? 0;
  }

  /**
   * Seconds captured at the action's release edge, measured on `state`'s clock,
   * or `null` when this clock holds no length for the release in the query
   * window. Absent is not zero: the release can predate the clock's
   * registration, or have landed while the action's group was disabled, and a
   * hold whose length this clock never measured must not read as an instant
   * tap.
   */
  private releaseDurationOn(action: string, state: ClockState): number | null {
    if (!this.isActionEnabled(action)) return null;
    if (this.isActionStillHeld(action)) return null;
    const window = this.currentStepWindow();
    if (window === null) {
      const duration = state.releaseDuration.get(action);
      return duration === undefined ? null : duration / state.perSecond;
    }
    const entry = state.stepReleaseDuration.get(action);
    if (!entry || entry.tag !== window) return null;
    return entry.duration / state.perSecond;
  }

  /**
   * True in the query window where the action is fully released — frame or
   * fixed step, matching the calling context like {@link isJustPressed} —
   * if it was held for at most `maxSeconds`. Counts on the raw input clock
   * unless `options.clock` names a registered scene clock, like
   * {@link getHoldDuration}.
   *
   * False when the clock holds no length for the release — one that predates
   * the clock's registration, or landed while the action's group was disabled.
   * An unmeasured hold is not a tap.
   */
  isJustTapped(
    action: string,
    maxSeconds: number,
    options?: HoldDurationOptions,
  ): boolean {
    // Resolved up front so an unusable clock throws on every call, not only on
    // the one that happens to land in a release window.
    const state = this.resolveState("isJustTapped", "hold", options?.clock);
    if (!this.isJustReleased(action)) return false;
    const held = this.releaseDurationOn(action, state);
    return held !== null && held <= maxSeconds;
  }

  /**
   * True in the query window where the action is fully released — frame or
   * fixed step, matching the calling context like {@link isJustPressed} —
   * if it was held for at least `minSeconds`. Counts on the raw input clock
   * unless `options.clock` names a registered scene clock, like
   * {@link getHoldDuration}.
   *
   * False when the clock holds no length for the release, as in
   * {@link isJustTapped}.
   */
  isJustReleasedAfter(
    action: string,
    minSeconds: number,
    options?: HoldDurationOptions,
  ): boolean {
    // Resolved up front for the same reason as in {@link isJustTapped}.
    const state = this.resolveState(
      "isJustReleasedAfter",
      "hold",
      options?.clock,
    );
    if (!this.isJustReleased(action)) return false;
    const held = this.releaseDurationOn(action, state);
    return held !== null && held >= minSeconds;
  }

  /**
   * Consuming buffered-press query: true if the action was pressed within the
   * last `windowSeconds` and that press has not yet been claimed. Claims the
   * press on success, so it returns true at most once per press; only a new
   * press clears the claim (last-press-wins, no queue). Consumption is scoped
   * to this query — {@link isJustPressed} and action listeners still see every
   * press.
   *
   * Lets a consumer act on a press up to `windowSeconds` late (e.g. jump
   * buffered just before landing) without the press re-triggering later.
   *
   * The window counts on the raw input clock ({@link getClockTime}), which
   * ignores scene pause and time scale. Pass `options.clock` — the `SceneTime`
   * of a scene on the stack — to count it on that scene's simulation time
   * instead; any other clock throws. One press is claimed once whichever clock
   * measured it.
   *
   * A disabled action returns false without claiming, so a discard-on-resume
   * call has to run with the action enabled to drop a press buffered earlier.
   */
  consumeBufferedPress(
    action: string,
    windowSeconds: number,
    options?: BufferedPressOptions,
  ): boolean {
    const state = this.resolveState(
      "consumeBufferedPress",
      "press",
      options?.clock,
    );
    if (!this.isActionEnabled(action)) return false;
    const pressed = state.pressStamp.get(action);
    if (pressed === undefined) return false;
    if (this.claimedBufferedPress.has(action)) return false;
    // Compared in the state's own unit — dividing the age instead would shift
    // the raw clock's boundary answer against the shipped millisecond form.
    if (this.stateNow(state) - pressed > windowSeconds * state.perSecond) {
      return false;
    }
    this.claimedBufferedPress.add(action);
    return true;
  }

  /** Record a press edge for buffered-press tracking; a new press clears any prior claim. */
  private recordActionPress(action: string): void {
    for (const state of this.allStates()) {
      state.pressStamp.set(action, this.stateNow(state));
    }
    this.claimedBufferedPress.delete(action);
  }

  /**
   * Register a clock so press edges and hold starts capture its current
   * reading. Input already held is stamped at registration, so an ongoing hold
   * starts from zero on the new clock instead of reading as not held. A press
   * made before registration is not backfilled — it happened outside this
   * clock's timeline.
   * @internal
   */
  _registerClock(clock: InputClock): void {
    const state = createClockState(clock, 1);
    const now = clock.elapsed;
    for (const code of this.rawState.holdStart.keys()) {
      state.holdStart.set(code, now);
    }
    for (const action of this.rawState.syntheticStart.keys()) {
      state.syntheticStart.set(action, now);
    }
    this.clockStates.set(clock, state);
  }

  /**
   * Drop a clock and everything measured on it.
   * @internal
   */
  _unregisterClock(clock: InputClock): void {
    this.clockStates.delete(clock);
  }

  /**
   * Record the hold length of a press ending now, per clock, keeping the
   * longest across keys per window.
   */
  private recordActionRelease(
    action: string,
    durations: ReadonlyMap<ClockState, number>,
  ): void {
    const tag = this.stepTag();
    for (const [state, duration] of durations) {
      const prev = state.releaseDuration.get(action) ?? 0;
      state.releaseDuration.set(action, Math.max(prev, duration));
      const stepEntry = state.stepReleaseDuration.get(action);
      if (stepEntry && stepEntry.tag === tag) {
        stepEntry.duration = Math.max(stepEntry.duration, duration);
      } else {
        state.stepReleaseDuration.set(action, { duration, tag });
      }
    }
  }

  /**
   * Close a key's hold on every clock, returning how long it ran on each in
   * that clock's own unit.
   */
  private endKeyHold(code: string): ReadonlyMap<ClockState, number> {
    const durations = new Map<ClockState, number>();
    for (const state of this.allStates()) {
      const start = state.holdStart.get(code);
      durations.set(
        state,
        start !== undefined ? this.stateNow(state) - start : 0,
      );
      state.holdStart.delete(code);
    }
    return durations;
  }

  // -- Axis helpers --

  /** Returns -1, 0, or 1 based on negative/positive action states. */
  getAxis(negative: string, positive: string): number {
    const neg = this.isPressed(negative) ? 1 : 0;
    const pos = this.isPressed(positive) ? 1 : 0;
    return pos - neg;
  }

  /** Returns a Vec2 from four directional actions. Not normalized. */
  getVector(left: string, right: string, up: string, down: string): Vec2 {
    const x = this.getAxis(left, right);
    const y = this.getAxis(up, down);
    return new Vec2(x, y);
  }

  // -- Pointer --

  /**
   * Primary pointer's position in world coordinates (via Camera), or screen
   * coords if no camera. Returns `Vec2.ZERO` when no pointer is tracked.
   *
   * For multi-pointer access (touch UIs etc.) iterate {@link getPointers} and
   * convert each `screenPos` via the camera as needed.
   */
  getPointerPosition(): Vec2 {
    const primary = this.getPrimaryPointer();
    if (!primary) return Vec2.ZERO;
    if (this.camera) {
      const w = this.camera.screenToWorld(
        primary.screenPos.x,
        primary.screenPos.y,
      );
      return new Vec2(w.x, w.y);
    }
    return primary.screenPos;
  }

  /** Primary pointer's raw position in screen coordinates, or `Vec2.ZERO` when no pointer is tracked. */
  getPointerScreenPosition(): Vec2 {
    const primary = this.getPrimaryPointer();
    return primary ? primary.screenPos : Vec2.ZERO;
  }

  /** Whether the primary pointer has any button held. */
  isPointerDown(): boolean {
    const primary = this.getPrimaryPointer();
    return primary ? primary.isDown : false;
  }

  /** All currently-tracked pointers (one per active mouse, pen, or finger). */
  getPointers(): readonly PointerInfo[] {
    const out: PointerInfo[] = [];
    for (const p of this.pointers.values()) {
      out.push(this.toPointerInfo(p));
    }
    return out;
  }

  /** Direct lookup by `pointerId`, or `undefined` if no pointer with that id is tracked. */
  getPointer(id: number): PointerInfo | undefined {
    const p = this.pointers.get(id);
    return p ? this.toPointerInfo(p) : undefined;
  }

  /**
   * Pointer-down edges from the current rendered frame.
   *
   * Claimed presses are excluded by default. Use `consumed: "include"` to
   * return every press or `consumed: "only"` to inspect claimed presses.
   */
  getPointerPresses(
    options: PointerPressOptions = {},
  ): readonly PointerPressInfo[] {
    const consumed = options.consumed ?? "exclude";
    const out: PointerPressInfo[] = [];
    for (const press of this.pointerPressesThisFrame) {
      if (
        options.button !== undefined &&
        press.info.button !== options.button
      ) {
        continue;
      }
      if (consumed === "exclude" && press.consumed) continue;
      if (consumed === "only" && !press.consumed) continue;
      out.push({
        ...press.info,
        worldPos: press.worldPos,
        consumed: press.consumed,
      });
    }
    return out;
  }

  /**
   * Defensive snapshot of a tracked pointer. The runtime `MutablePointerInfo`
   * holds a real `Set` for `buttons` — even though the `PointerInfo` type
   * declares `ReadonlySet`, JS doesn't enforce that at runtime, so we copy the
   * set on every public read. `Vec2` is convention-immutable across YAGE, so
   * we share the same instance. `button` is the edge that triggered this
   * snapshot's delivery (down/up); `-1` for moves and query reads.
   */
  private toPointerInfo(pointer: MutablePointerInfo, button = -1): PointerInfo {
    return {
      id: pointer.id,
      generation: pointer.generation,
      screenPos: pointer.screenPos,
      type: pointer.type,
      isPrimary: pointer.isPrimary,
      buttons: new Set(pointer.buttons),
      isDown: pointer.isDown,
      button,
    };
  }

  /**
   * Subscribe to pointer-down events (button transitions from up → down on a
   * tracked pointer). DOM listeners run during input drain, after the UI
   * hit-test and before the button/action edge applies. Returns a disposer.
   */
  onPointerDown(fn: (info: PointerInfo) => void): () => void {
    this.pointerDownListeners.push(fn);
    return () => {
      const idx = this.pointerDownListeners.indexOf(fn);
      if (idx !== -1) this.pointerDownListeners.splice(idx, 1);
    };
  }

  /**
   * Subscribe to pointer-up events (button transitions from down → up, plus
   * touch / pen lifecycle ends and `pointercancel`). DOM listeners run during
   * input drain before the button/action edge applies. Returns a disposer.
   */
  onPointerUp(fn: (info: PointerInfo) => void): () => void {
    this.pointerUpListeners.push(fn);
    return () => {
      const idx = this.pointerUpListeners.indexOf(fn);
      if (idx !== -1) this.pointerUpListeners.splice(idx, 1);
    };
  }

  /** Subscribe to pointer-move events. Returns a disposer. */
  onPointerMove(fn: (info: PointerInfo) => void): () => void {
    this.pointerMoveListeners.push(fn);
    return () => {
      const idx = this.pointerMoveListeners.indexOf(fn);
      if (idx !== -1) this.pointerMoveListeners.splice(idx, 1);
    };
  }

  // -- Consume primitives --

  /**
   * Mark a pointer as claimed for the rest of its event cycle (down → up).
   * Subsequent action-map edges for this pointer (e.g. the `MouseLeft` edge a
   * `pointerdown` would normally fire) are suppressed; `onPointerDown/Up/Move`
   * listeners still fire because they are explicit user opt-ins.
   *
   * Two cases use this:
   *
   * 1. A UI handler claims a real event. Call from a Pixi `pointerdown`
   *    handler that wants to own the event: `manager.consumePointer(e.pointerId)`.
   *
   * 2. You forwarded or replayed a synthetic pointer to the canvas and need it
   *    kept out of gameplay actions. A DOM overlay above the canvas (virtual
   *    joystick, accessibility overlay, input-replay tooling) that dispatches a
   *    synthetic `PointerEvent` to the canvas — so listeners underneath still
   *    receive it — must pair the dispatch with `consumePointer` or every
   *    forwarded tap leaks into the `MouseLeft/Middle/Right` action edge:
   *
   *    ```ts
   *    canvas.dispatchEvent(syntheticPointerDown); // underneath listeners still fire
   *    input.consumePointer(e.pointerId);          // but no gameplay action edge
   *    ```
   *
   * The mark clears automatically when the pointer's last button releases or
   * on `pointercancel`.
   */
  consumePointer(id: number): void {
    const generation = this.claimablePointerGeneration(id);
    if (generation === undefined) {
      throw new Error(
        `InputManager.consumePointer(): pointer ${id} is not active.`,
      );
    }
    this.consumedPointers.set(id, generation);
    for (const press of this.pointerPressesThisFrame) {
      if (press.info.id === id && press.info.generation === generation) {
        press.consumed = true;
      }
    }
  }

  /** Whether the pointer is currently marked consumed. */
  isPointerConsumed(id: number): boolean {
    const generation = this.claimablePointerGeneration(id);
    return (
      generation !== undefined && this.consumedPointers.get(id) === generation
    );
  }

  private claimablePointerGeneration(id: number): number | undefined {
    if (this.activePointerDispatch?.id === id) {
      return this.activePointerDispatch.generation;
    }
    const queued = this.queuedPointers.get(id);
    if (queued && queued.buttons.size > 0 && !queued.terminalQueued) {
      return queued.generation;
    }
    const pointer = this.pointers.get(id);
    return pointer?.isDown ? pointer.generation : undefined;
  }

  /**
   * Suppress action-map edges for the wheel event currently notifying its
   * listeners. Calling outside an {@link onWheel} callback throws.
   */
  consumeWheel(): void {
    const activeIndex = this.wheelClaims.length - 1;
    if (activeIndex < 0) {
      throw new Error(
        "InputManager.consumeWheel(): call this inside an onWheel callback.",
      );
    }
    this.wheelClaims[activeIndex] = true;
  }

  // -- Listener parity (keys, actions, wheel) --

  /**
   * Subscribe to key-down events. Pass a code (e.g. `"Space"`, `"GamepadA"`)
   * to filter, or `"*"` for all keys. The listener fires on the same edge
   * `isJustPressed` reports — for DOM-originated events that's the next
   * `Phase.EarlyUpdate` after the browser dispatches; for synthetic injection
   * (`fireKeyDown`) it's synchronous. Returns a disposer.
   */
  onKeyDown(code: string, fn: (code: string) => void): () => void {
    if (code === "*") {
      this.keyDownListenersAny.push(fn);
      return () => {
        const idx = this.keyDownListenersAny.indexOf(fn);
        if (idx !== -1) this.keyDownListenersAny.splice(idx, 1);
      };
    }
    let arr = this.keyDownListeners.get(code);
    if (!arr) {
      arr = [];
      this.keyDownListeners.set(code, arr);
    }
    arr.push(fn);
    return () => {
      const list = this.keyDownListeners.get(code);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /** Subscribe to key-up events. See {@link onKeyDown}. */
  onKeyUp(code: string, fn: (code: string) => void): () => void {
    if (code === "*") {
      this.keyUpListenersAny.push(fn);
      return () => {
        const idx = this.keyUpListenersAny.indexOf(fn);
        if (idx !== -1) this.keyUpListenersAny.splice(idx, 1);
      };
    }
    let arr = this.keyUpListeners.get(code);
    if (!arr) {
      arr = [];
      this.keyUpListeners.set(code, arr);
    }
    arr.push(fn);
    return () => {
      const list = this.keyUpListeners.get(code);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /**
   * Subscribe to action press edges (rising edge of any key bound to the
   * action). Fires once per press. Returns a disposer.
   */
  onAction(name: string, fn: (name: string) => void): () => void {
    let arr = this.actionListeners.get(name);
    if (!arr) {
      arr = [];
      this.actionListeners.set(name, arr);
    }
    arr.push(fn);
    return () => {
      const list = this.actionListeners.get(name);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /** Subscribe to action release edges. Returns a disposer. */
  onActionReleased(name: string, fn: (name: string) => void): () => void {
    let arr = this.actionReleasedListeners.get(name);
    if (!arr) {
      arr = [];
      this.actionReleasedListeners.set(name, arr);
    }
    arr.push(fn);
    return () => {
      const list = this.actionReleasedListeners.get(name);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /**
   * Subscribe to scroll-wheel events. Receives raw `deltaX`/`deltaY` (already
   * sign-flipped by `InputConfig.wheelInvertY` if set). Fires regardless of
   * {@link consumeWheel} — it only gates action edges. Returns a disposer.
   */
  onWheel(fn: (dx: number, dy: number) => void): () => void {
    this.wheelListeners.push(fn);
    return () => {
      const idx = this.wheelListeners.indexOf(fn);
      if (idx !== -1) this.wheelListeners.splice(idx, 1);
    };
  }

  private getPrimaryPointer(): MutablePointerInfo | null {
    if (this.primaryPointerId === null) return null;
    return this.pointers.get(this.primaryPointerId) ?? null;
  }

  // -- Runtime action map management --

  /** Replace the entire action map and store it as the default for {@link resetBindings}. */
  setActionMap(actions: ActionMapDefinition): void {
    this.actionMap.clear();
    this.defaultBindings.clear();
    for (const [action, keys] of Object.entries(actions)) {
      this.actionMap.set(action, [...keys]);
      this.defaultBindings.set(action, [...keys]);
    }
  }

  /** Add a key binding to an action. Creates the action if it doesn't exist. */
  bindKey(action: string, key: string): void {
    let keys = this.actionMap.get(action);
    if (!keys) {
      keys = [];
      this.actionMap.set(action, keys);
    }
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }

  /** Remove a key binding from an action. */
  unbindKey(action: string, key: string): void {
    const keys = this.actionMap.get(action);
    if (!keys) return;
    const idx = keys.indexOf(key);
    if (idx !== -1) keys.splice(idx, 1);
  }

  // -- Binding queries --

  /** Returns the current key bindings for an action, or an empty array if unmapped. */
  getBindings(action: string): readonly string[] {
    return this.actionMap.get(action) ?? [];
  }

  /** Returns all action names that have the given key bound. */
  getActionsForKey(key: string): string[] {
    const result: string[] = [];
    for (const [action, keys] of this.actionMap) {
      if (keys.includes(key)) result.push(action);
    }
    return result;
  }

  // -- Rebinding --

  /**
   * Rebind a key to an action with optional conflict detection.
   * Conflicts are only detected between actions sharing at least one group.
   */
  rebind(action: string, key: string, opts?: RebindOptions): RebindResult {
    const conflict = opts?.conflict ?? "reject";
    const slot = opts?.slot;

    const conflictAction = this.findConflictInGroups(action, key);

    if (conflictAction && conflict === "reject") {
      return { ok: false, conflict: { action: conflictAction, key } };
    }

    if (conflictAction && conflict === "replace") {
      this.unbindKey(conflictAction, key);
    }

    let keys = this.actionMap.get(action);
    if (!keys) {
      keys = [];
      this.actionMap.set(action, keys);
    }

    // Remove existing occurrence to avoid duplicates, adjusting slot for the shift
    const existingIdx = keys.indexOf(key);
    let targetSlot = slot;
    if (
      targetSlot !== undefined &&
      existingIdx !== -1 &&
      existingIdx !== targetSlot
    ) {
      keys.splice(existingIdx, 1);
      if (targetSlot > existingIdx) targetSlot--;
    }

    if (targetSlot !== undefined && targetSlot < keys.length) {
      keys[targetSlot] = key;
    } else if (!keys.includes(key)) {
      keys.push(key);
    }

    return { ok: true };
  }

  /**
   * Finds the first action that uses the given key AND shares at least one
   * group with the target action. Ungrouped actions never conflict.
   */
  private findConflictInGroups(action: string, key: string): string | null {
    const myGroups = this.actionGroups.get(action);
    if (!myGroups || myGroups.size === 0) return null;

    for (const [otherAction, otherKeys] of this.actionMap) {
      if (otherAction === action) continue;
      if (!otherKeys.includes(key)) continue;

      const otherGroups = this.actionGroups.get(otherAction);
      if (!otherGroups) continue;

      for (const g of myGroups) {
        if (otherGroups.has(g)) return otherAction;
      }
    }
    return null;
  }

  // -- Binding persistence --

  /** Reset bindings to defaults. If an action name is provided, only reset that action. */
  resetBindings(action?: string): void {
    if (action !== undefined) {
      const defaults = this.defaultBindings.get(action);
      if (defaults) {
        this.actionMap.set(action, [...defaults]);
      }
    } else {
      this.actionMap.clear();
      for (const [a, keys] of this.defaultBindings) {
        this.actionMap.set(a, [...keys]);
      }
    }
  }

  /** Export the current bindings as a plain object for serialization. */
  exportBindings(): ActionMapDefinition {
    const result: ActionMapDefinition = {};
    for (const [action, keys] of this.actionMap) {
      result[action] = [...keys];
    }
    return result;
  }

  /** Load bindings from a plain object. Resets to defaults first, then overlays the provided map. */
  loadBindings(map: ActionMapDefinition): void {
    this.resetBindings();
    for (const [action, keys] of Object.entries(map)) {
      this.actionMap.set(action, [...keys]);
    }
  }

  // -- Group management --

  /** Configure input groups. Group name -> array of action names. */
  setGroups(groups: Record<string, string[]>): void {
    this.groups.clear();
    this.actionGroups.clear();
    for (const [name, actions] of Object.entries(groups)) {
      this.groups.set(name, new Set(actions));
      for (const action of actions) {
        let set = this.actionGroups.get(action);
        if (!set) {
          set = new Set();
          this.actionGroups.set(action, set);
        }
        set.add(name);
      }
    }
  }

  /** Enable a group by name. */
  enableGroup(name: string): void {
    this.disabledGroups.delete(name);
  }

  /** Disable a group by name. Actions only in disabled groups become inactive. */
  disableGroup(name: string): void {
    this.disabledGroups.add(name);
  }

  /** Set exactly these groups as active; all others are disabled. */
  setActiveGroups(names: string[]): void {
    this.disabledGroups.clear();
    for (const group of this.groups.keys()) {
      if (!names.includes(group)) {
        this.disabledGroups.add(group);
      }
    }
  }

  /** Whether a group is currently enabled. Returns true for unknown group names. */
  isGroupEnabled(name: string): boolean {
    return !this.disabledGroups.has(name);
  }

  /** Get all configured group names. */
  getGroups(): string[] {
    return Array.from(this.groups.keys());
  }

  /** Get the action names belonging to a group. Returns empty array for unknown groups. */
  getGroupActions(name: string): readonly string[] {
    const set = this.groups.get(name);
    return set ? Array.from(set) : [];
  }

  /** Returns true if the action is ungrouped or any of its groups is enabled. */
  private isActionEnabled(action: string): boolean {
    const groupSet = this.actionGroups.get(action);
    if (!groupSet || groupSet.size === 0) return true;
    for (const group of groupSet) {
      if (!this.disabledGroups.has(group)) return true;
    }
    return false;
  }

  // -- Key listening --

  /** Returns a promise that resolves with the next key code pressed. Intercepts the key. */
  listenForNextKey(): Promise<string | null> {
    this.cancelListen();
    return new Promise<string | null>((resolve) => {
      this.listenResolve = resolve;
    });
  }

  /** Cancel an active {@link listenForNextKey}. Resolves the pending promise with `null`. */
  cancelListen(): void {
    if (this.listenResolve) {
      const resolve = this.listenResolve;
      this.listenResolve = null;
      resolve(null);
    }
  }

  /** Public wrapper for synthetic key-down injection. Applies sync. */
  fireKeyDown(code: string): void {
    this._applyKeyDown(code);
  }

  /** Public wrapper for synthetic key-up injection. Applies sync. */
  fireKeyUp(code: string): void {
    this._applyKeyUp(code);
  }

  /**
   * Public wrapper for synthetic pointer movement. Defaults to the primary
   * mouse pointer (`id: 1`, `type: "mouse"`); pass `opts` to drive a specific
   * touch / pen pointer.
   */
  firePointerMove(
    screenX: number,
    screenY: number,
    opts?: { id?: number; type?: PointerType; isPrimary?: boolean },
  ): void {
    this._applyPointerMove(this.makeSyntheticInfo(screenX, screenY, -1, opts));
  }

  /**
   * Public wrapper for synthetic pointer-button presses. Defaults to button 0
   * on the primary mouse pointer. Pass `opts` for touch / pen / non-primary
   * pointers (e.g. `{ id: 5, type: "touch", isPrimary: false }`).
   */
  firePointerDown(
    button: 0 | 1 | 2 = 0,
    opts?: { id?: number; type?: PointerType; isPrimary?: boolean },
  ): void {
    const id = opts?.id ?? 1;
    const existing = this.pointers.get(id);
    this._applyPointerDown(
      this.makeSyntheticInfo(
        existing?.screenPos.x ?? 0,
        existing?.screenPos.y ?? 0,
        button,
        opts,
      ),
    );
  }

  /** Public wrapper for synthetic pointer-button releases. */
  firePointerUp(button: 0 | 1 | 2 = 0, opts?: { id?: number }): void {
    const id = opts?.id ?? 1;
    const existing = this.pointers.get(id);
    const info: PointerEventInfo = {
      id,
      screenX: existing?.screenPos.x ?? 0,
      screenY: existing?.screenPos.y ?? 0,
      type: existing?.type ?? "mouse",
      isPrimary: existing?.isPrimary ?? id === 1,
      button,
    };
    this._applyPointerUp(info);
  }

  /** Public wrapper for synthetic wheel input. Applies sync, including
   * action edges and `onWheel` listener notification — matching the DOM path
   * so tests and inspector probes drive the full surface. */
  fireWheel(dx: number, dy: number): void {
    this.dispatchWheel(dx, dy);
  }

  private makeSyntheticInfo(
    screenX: number,
    screenY: number,
    button: number,
    opts?: { id?: number; type?: PointerType; isPrimary?: boolean },
  ): PointerEventInfo {
    const id = opts?.id ?? 1;
    const existing = this.pointers.get(id);
    return {
      id,
      screenX,
      screenY,
      type: opts?.type ?? existing?.type ?? "mouse",
      isPrimary: opts?.isPrimary ?? existing?.isPrimary ?? id === 1,
      button,
    };
  }

  /**
   * Inject a synthetic gamepad button edge. Routes through the same internal
   * path as real polling, so action queries (`isPressed`, `isJustPressed`),
   * `listenForNextKey`, and rebinding all see the synthetic input.
   *
   * `code` should be a gamepad code string (e.g. `"GamepadA"`, `"GamepadLT"`).
   * Used by inspector probes / deterministic tests in lieu of real polling.
   */
  fireGamepadButton(code: string, pressed: boolean): void {
    const wasPressed = this.lastButtonState.get(code) ?? false;
    if (pressed && !wasPressed) {
      this._applyKeyDown(code);
      this.lastButtonState.set(code, true);
    } else if (!pressed && wasPressed) {
      this._applyKeyUp(code);
      this.lastButtonState.delete(code);
    }
  }

  /**
   * Inject a synthetic gamepad axis value. Stored separately from real-pad
   * axis state and consulted by `getStick` / `getTrigger` when no real pad
   * is active, or when the active pad's own input rests inside the deadzone
   * — so test fixtures and virtual sticks read back even while an idle
   * controller sits plugged in; a pad deflected past the deadzone wins.
   *
   * Trigger axes additionally emit `GamepadLT`/`GamepadRT` button edges when
   * crossing `triggerThreshold`, mirroring real-pad polling so synthetic
   * inspector probes drive `isPressed` the same way as physical hardware.
   * Stick values must be finite and in `[-1, 1]`; triggers must be finite and
   * in `[0, 1]`.
   */
  fireGamepadAxis(side: GamepadAxisKey, value: number): void {
    const isTrigger = side === "leftTrigger" || side === "rightTrigger";
    const min = isTrigger ? 0 : -1;
    if (!Number.isFinite(value) || value < min || value > 1) {
      throw new Error(
        `InputManager.fireGamepadAxis(): ${side} must be finite and in [${min}, 1], got ${value}`,
      );
    }
    this.syntheticAxisState.set(side, value);
    if (side === "leftTrigger") {
      this.fireGamepadButton("GamepadLT", value >= this.triggerThreshold);
    } else if (side === "rightTrigger") {
      this.fireGamepadButton("GamepadRT", value >= this.triggerThreshold);
    }
  }

  // -- Gamepad analog API --

  /**
   * Returns the deadzoned, magnitude-clamped stick vector for the given side.
   *
   * By default reads from the active pad (the most recently used controller,
   * or the first connected one if nothing has been used yet). Pass
   * `{ pad: index }` to read only that physical pad — useful for couch-co-op
   * where each player's controller is addressed explicitly. Explicit reads
   * return zero rather than falling back to synthetic axes.
   *
   * Falls back to synthetic injection (`fireGamepadAxis`) when no pad is
   * active — the test/probe/virtual-controls path — AND when the pad's own
   * stick rests inside the deadzone: a controller merely sitting plugged in
   * (its resting noise stays inside the deadzone) must not mask a virtual
   * stick that is actively deflected. A pad deflected past the deadzone
   * always wins.
   */
  getStick(side: "left" | "right", opts?: { pad?: number }): Vec2 {
    const { x: xKey, y: yKey } = STICK_AXIS_KEYS[side];
    const padIdx = opts?.pad !== undefined ? opts.pad : this.activePadIndex;
    let x = 0;
    let y = 0;
    if (padIdx !== null) {
      x = this.gamepadAxisState.get(`${padIdx}:${xKey}`) ?? 0;
      y = this.gamepadAxisState.get(`${padIdx}:${yKey}`) ?? 0;
    }
    if (
      opts?.pad === undefined &&
      (padIdx === null || Math.hypot(x, y) < this.stickDeadzone)
    ) {
      x = this.syntheticAxisState.get(xKey) ?? 0;
      y = this.syntheticAxisState.get(yKey) ?? 0;
    }
    return applyRadialDeadzone(x, y, this.stickDeadzone);
  }

  /**
   * Returns the deadzoned trigger value (0..1) for the given side.
   * Reads from the active pad by default; use `{ pad: index }` to read only
   * that physical pad. Default reads fall back to synthetic state when no pad
   * is active or the active pad's trigger rests inside the deadzone (mirrors
   * {@link getStick}).
   */
  getTrigger(side: "left" | "right", opts?: { pad?: number }): number {
    const key = TRIGGER_AXIS_KEYS[side];
    const padIdx = opts?.pad !== undefined ? opts.pad : this.activePadIndex;
    let v =
      padIdx !== null
        ? (this.gamepadAxisState.get(`${padIdx}:${key}`) ?? 0)
        : 0;
    if (
      opts?.pad === undefined &&
      (padIdx === null || v < this.triggerDeadzone)
    ) {
      v = this.syntheticAxisState.get(key) ?? 0;
    }
    if (v < this.triggerDeadzone) return 0;
    return Math.min(1, (v - this.triggerDeadzone) / (1 - this.triggerDeadzone));
  }

  // -- Gamepad enumeration / events --

  /**
   * Synchronously poll `navigator.getGamepads()` for currently-connected pads.
   * Use this rather than the cached event-driven list when you need ground
   * truth — `gamepadconnected` doesn't fire until the user presses a button.
   */
  gamepads(): readonly GamepadInfo[] {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.getGamepads !== "function"
    ) {
      return [];
    }
    const result: GamepadInfo[] = [];
    for (const pad of navigator.getGamepads()) {
      if (pad) result.push({ index: pad.index, id: pad.id });
    }
    return result;
  }

  /**
   * Subscribe to gamepad-connected events. Replays currently-known pads
   * synchronously so callers don't need a separate `gamepads()` call.
   * Returns a disposer.
   */
  onGamepadConnected(fn: (info: GamepadInfo) => void): () => void {
    for (const info of this.connectedPads.values()) {
      this._callListeners(
        [fn],
        (listener) => listener(info),
        "Gamepad connect listener",
        String(info.index),
      );
    }
    this.gamepadConnectListeners.push(fn);
    return () => {
      const idx = this.gamepadConnectListeners.indexOf(fn);
      if (idx !== -1) this.gamepadConnectListeners.splice(idx, 1);
    };
  }

  /** Subscribe to gamepad-disconnected events. Returns a disposer. */
  onGamepadDisconnected(fn: (info: GamepadInfo) => void): () => void {
    this.gamepadDisconnectListeners.push(fn);
    return () => {
      const idx = this.gamepadDisconnectListeners.indexOf(fn);
      if (idx !== -1) this.gamepadDisconnectListeners.splice(idx, 1);
    };
  }

  // -- Active pad --

  /**
   * The pad whose analog input is read by default. Auto-promotes on input
   * activity (button press or stick/trigger above deadzone) and on first
   * connect. Returns `null` when no pad is connected.
   */
  getActivePad(): GamepadInfo | null {
    if (this.activePadIndex === null) return null;
    return this.connectedPads.get(this.activePadIndex) ?? null;
  }

  /**
   * Manually set the active pad. Index must match a currently connected pad
   * — pass an unknown index and the call is a no-op. Pass `null` to clear
   * (analog reads will fall back to synthetic state if any).
   */
  setActivePad(index: number | null): void {
    if (index !== null && !this.connectedPads.has(index)) return;
    this.setActivePadInternal(index);
  }

  /**
   * Subscribe to active-pad changes. Replays the current active pad
   * synchronously on subscribe so callers get the present state without a
   * separate `getActivePad()` call. Returns a disposer.
   */
  onActivePadChanged(fn: (info: GamepadInfo | null) => void): () => void {
    const info = this.getActivePad();
    this._callListeners(
      [fn],
      (listener) => listener(info),
      "Active pad listener",
      String(info?.index ?? "none"),
    );
    this.activePadListeners.push(fn);
    return () => {
      const idx = this.activePadListeners.indexOf(fn);
      if (idx !== -1) this.activePadListeners.splice(idx, 1);
    };
  }

  private setActivePadInternal(index: number | null): void {
    if (this.activePadIndex === index) return;
    this.activePadIndex = index;
    const info = this.getActivePad();
    this._callListeners(
      this.activePadListeners,
      (fn) => fn(info),
      "Active pad listener",
      String(index),
    );
  }

  // -- Gamepad runtime config --

  /** Enable or disable real gamepad polling. Synthetic injection still works when disabled. */
  setPollingEnabled(enabled: boolean): void {
    this.pollingEnabled = enabled;
  }

  /** Whether real gamepad polling is currently enabled. */
  isPollingEnabled(): boolean {
    return this.pollingEnabled;
  }

  /**
   * Update analog deadzones at runtime. Either field may be omitted.
   * Values must be finite and in `[0, 1)`.
   */
  setDeadzones(opts: { stick?: number; trigger?: number }): void {
    if (opts.stick !== undefined) {
      if (!Number.isFinite(opts.stick) || opts.stick < 0 || opts.stick >= 1) {
        throw new Error(
          `InputManager.setDeadzones(): stick must be finite and in [0, 1), got ${opts.stick}`,
        );
      }
    }
    if (opts.trigger !== undefined) {
      if (
        !Number.isFinite(opts.trigger) ||
        opts.trigger < 0 ||
        opts.trigger >= 1
      ) {
        throw new Error(
          `InputManager.setDeadzones(): trigger must be finite and in [0, 1), got ${opts.trigger}`,
        );
      }
    }
    if (opts.stick !== undefined) this.stickDeadzone = opts.stick;
    if (opts.trigger !== undefined) this.triggerDeadzone = opts.trigger;
  }

  /**
   * Set the trigger button-edge threshold (default 0.5). Must be finite and in
   * `(0, 1]`.
   */
  setTriggerThreshold(value: number): void {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(
        `InputManager.setTriggerThreshold(): value must be finite and in (0, 1], got ${value}`,
      );
    }
    this.triggerThreshold = value;
  }

  // -- Internal: polling and connect/disconnect plumbing --

  /**
   * @internal Force-release held gamepad buttons and clear real-pad analog
   * snapshots. Used on tab-hide (where `navigator.getGamepads()` returns
   * stale data) and on disconnect when polling is paused. Synthetic axes
   * live in their own field, so they're untouched.
   */
  _releaseAllGamepadState(): void {
    for (const code of [...this.lastButtonState.keys()]) {
      this._applyKeyUp(code);
    }
    this.lastButtonState.clear();
    this.gamepadAxisState.clear();
    this.lastPadActivity.clear();
  }

  /** @internal Called by InputPlugin from `gamepadconnected` event or by
   * polling when discovering a previously-unknown pad. Idempotent. */
  _onGamepadConnected(info: GamepadInfo): void {
    if (this.connectedPads.has(info.index)) return;
    this.connectedPads.set(info.index, info);
    // First pad to connect auto-promotes — single-player "just works" with
    // no setActivePad call required.
    if (this.activePadIndex === null) {
      this.setActivePadInternal(info.index);
    }
    this._callListeners(
      this.gamepadConnectListeners,
      (fn) => fn(info),
      "Gamepad connect listener",
      String(info.index),
    );
  }

  /** @internal Called by InputPlugin from `gamepaddisconnected` event or by
   * polling when a pad vanishes silently. Idempotent. */
  _onGamepadDisconnected(info: GamepadInfo): void {
    if (!this.connectedPads.has(info.index)) return;
    this.connectedPads.delete(info.index);
    // Drop per-pad state for the departed pad.
    for (const key of [...this.gamepadAxisState.keys()]) {
      if (key.startsWith(`${info.index}:`)) this.gamepadAxisState.delete(key);
    }
    this.lastPadActivity.delete(info.index);
    // If the departed pad was active, demote and pick the first remaining
    // connected pad (or null) so analog reads keep working without API calls.
    if (this.activePadIndex === info.index) {
      const next = this.connectedPads.keys().next();
      this.setActivePadInternal(next.done ? null : next.value);
    }
    // Re-aggregate held buttons against remaining pads. We can't recursively
    // call `_pollGamepads` because the disconnect detection there is what got
    // us here — instead reconcile button state inline against the current
    // navigator snapshot.
    if (
      this.pollingEnabled &&
      typeof navigator !== "undefined" &&
      typeof navigator.getGamepads === "function"
    ) {
      this.reconcileButtonStateAcrossPads(navigator.getGamepads());
    } else {
      this._releaseAllGamepadState();
    }
    this._callListeners(
      this.gamepadDisconnectListeners,
      (fn) => fn(info),
      "Gamepad disconnect listener",
      String(info.index),
    );
  }

  /**
   * @internal Poll real gamepads via `navigator.getGamepads()` and emit
   * key-down/key-up edges for any aggregate state changes. Called by
   * `InputPollSystem` once per frame.
   */
  _pollGamepads(): void {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.getGamepads !== "function"
    ) {
      return;
    }
    const pads = navigator.getGamepads();

    // 1. Reconcile pad presence. The browser's `gamepadconnected` event is
    // gated behind first user input, so polling discovers already-plugged
    // pads. The matching `gamepaddisconnected` is also unreliable when the
    // tab backgrounds — polling reconciles vanished pads too.
    const liveIndices = new Set<number>();
    for (const pad of pads) {
      if (!pad) continue;
      liveIndices.add(pad.index);
      if (!this.connectedPads.has(pad.index)) {
        this._onGamepadConnected({ index: pad.index, id: pad.id });
      }
    }
    for (const [, info] of [...this.connectedPads]) {
      if (!liveIndices.has(info.index)) {
        this._onGamepadDisconnected(info);
      }
    }

    // 2. Defensive axis-state cleanup for any stale entries the disconnect
    // path missed (e.g. partial state during prior frames).
    for (const key of [...this.gamepadAxisState.keys()]) {
      const colon = key.indexOf(":");
      if (colon === -1) continue;
      const idx = Number.parseInt(key.slice(0, colon), 10);
      if (!liveIndices.has(idx)) this.gamepadAxisState.delete(key);
    }

    // 3. Refresh per-pad axis state and compute current activity. Activity
    // is captured into a map first so the promotion decision can consider
    // all pads together (not in iteration order).
    const currentActivity = new Map<number, boolean>();
    for (const pad of pads) {
      if (!pad) continue;
      const standard = pad.mapping === "standard";
      if (standard) {
        for (let axIdx = 0; axIdx < STANDARD_AXIS_KEYS.length; axIdx++) {
          const axisKey = STANDARD_AXIS_KEYS[axIdx];
          if (!axisKey) continue;
          const raw = pad.axes[axIdx] ?? 0;
          this.gamepadAxisState.set(
            `${pad.index}:${axisKey}`,
            Number.isFinite(raw) ? raw : 0,
          );
        }
        const lt = pad.buttons[TRIGGER_LEFT_INDEX]?.value ?? 0;
        const rt = pad.buttons[TRIGGER_RIGHT_INDEX]?.value ?? 0;
        this.gamepadAxisState.set(
          `${pad.index}:leftTrigger`,
          Number.isFinite(lt) ? lt : 0,
        );
        this.gamepadAxisState.set(
          `${pad.index}:rightTrigger`,
          Number.isFinite(rt) ? rt : 0,
        );
      }
      currentActivity.set(pad.index, this.padHasActivity(pad));
    }

    // 4. Auto-promotion. The active pad's own activity protects it — we
    // only promote when active is idle, so couch-co-op players don't steal
    // each other's slot mid-press. Among rising-edge candidates we pick the
    // first one in iteration order (deterministic; arbitrary in practice).
    const activeStillActive =
      this.activePadIndex !== null &&
      (currentActivity.get(this.activePadIndex) ?? false);
    if (!activeStillActive) {
      for (const [padIdx, isActive] of currentActivity) {
        const wasActive = this.lastPadActivity.get(padIdx) ?? false;
        if (isActive && !wasActive && padIdx !== this.activePadIndex) {
          this.setActivePadInternal(padIdx);
          break;
        }
      }
    }
    for (const [padIdx, isActive] of currentActivity) {
      this.lastPadActivity.set(padIdx, isActive);
    }

    // 5. Reconcile button state across all pads (any-pad action map).
    this.reconcileButtonStateAcrossPads(pads);
  }

  /** Whether a pad has any input that should claim active-pad ownership. */
  private padHasActivity(pad: Gamepad): boolean {
    for (const btn of pad.buttons) {
      if (btn?.pressed) return true;
    }
    if (pad.mapping === "standard") {
      const lx = pad.axes[0] ?? 0;
      const ly = pad.axes[1] ?? 0;
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      if (Math.hypot(lx, ly) > this.stickDeadzone) return true;
      if (Math.hypot(rx, ry) > this.stickDeadzone) return true;
      const lt = pad.buttons[TRIGGER_LEFT_INDEX]?.value ?? 0;
      const rt = pad.buttons[TRIGGER_RIGHT_INDEX]?.value ?? 0;
      if (lt > this.triggerDeadzone) return true;
      if (rt > this.triggerDeadzone) return true;
    }
    return false;
  }

  /**
   * Aggregate "any pad pressed" per code across the supplied pad list and
   * emit `_applyKeyDown`/`_applyKeyUp` edges. `lastButtonState` is updated
   * unconditionally so listen-mode interception doesn't cause held-button
   * re-fires on subsequent frames.
   */
  private reconcileButtonStateAcrossPads(
    pads: ReadonlyArray<Gamepad | null>,
  ): void {
    const codePressed = new Map<string, boolean>();
    const directionStrengths = new Map<string, number>();
    for (const pad of pads) {
      if (!pad) continue;
      const standard = pad.mapping === "standard";
      const buttons = pad.buttons;
      for (let btnIdx = 0; btnIdx < buttons.length; btnIdx++) {
        const btn = buttons[btnIdx];
        if (!btn) continue;
        const standardCode =
          standard && btnIdx < STANDARD_BUTTON_CODES.length
            ? STANDARD_BUTTON_CODES[btnIdx]
            : undefined;
        const code = standardCode ?? `GamepadButton${btnIdx}`;
        const isTrigger =
          standard &&
          (btnIdx === TRIGGER_LEFT_INDEX || btnIdx === TRIGGER_RIGHT_INDEX);
        const isDown = isTrigger
          ? btn.value >= this.triggerThreshold
          : btn.pressed;
        if (isDown) codePressed.set(code, true);
      }
      if (standard) {
        const lx = pad.axes[0] ?? 0;
        const ly = pad.axes[1] ?? 0;
        const rx = pad.axes[2] ?? 0;
        const ry = pad.axes[3] ?? 0;
        this.recordDirectionStrength(
          directionStrengths,
          "GamepadLeftStickLeft",
          -lx,
        );
        this.recordDirectionStrength(
          directionStrengths,
          "GamepadLeftStickRight",
          lx,
        );
        this.recordDirectionStrength(
          directionStrengths,
          "GamepadLeftStickUp",
          -ly,
        );
        this.recordDirectionStrength(
          directionStrengths,
          "GamepadLeftStickDown",
          ly,
        );
        this.recordDirectionStrength(
          directionStrengths,
          "GamepadRightStickLeft",
          -rx,
        );
        this.recordDirectionStrength(
          directionStrengths,
          "GamepadRightStickRight",
          rx,
        );
        this.recordDirectionStrength(
          directionStrengths,
          "GamepadRightStickUp",
          -ry,
        );
        this.recordDirectionStrength(
          directionStrengths,
          "GamepadRightStickDown",
          ry,
        );
      }
    }
    for (const [code, strength] of directionStrengths) {
      const threshold = this.lastButtonState.get(code)
        ? STICK_DIRECTION_RELEASE_THRESHOLD
        : STICK_DIRECTION_PRESS_THRESHOLD;
      if (strength >= threshold) codePressed.set(code, true);
    }

    const allCodes = new Set<string>([
      ...this.lastButtonState.keys(),
      ...codePressed.keys(),
    ]);
    for (const code of allCodes) {
      const wasPressed = this.lastButtonState.get(code) ?? false;
      const isPressed = codePressed.get(code) ?? false;
      if (isPressed && !wasPressed) {
        this._applyKeyDown(code);
      } else if (!isPressed && wasPressed) {
        this._applyKeyUp(code);
      }
      if (isPressed) {
        this.lastButtonState.set(code, true);
      } else {
        this.lastButtonState.delete(code);
      }
    }
  }

  private recordDirectionStrength(
    strengths: Map<string, number>,
    code: string,
    value: number,
  ): void {
    if (!Number.isFinite(value) || value <= 0) return;
    strengths.set(code, Math.max(strengths.get(code) ?? 0, value));
  }

  /** Whether `name` is defined in the current action map. */
  hasAction(name: string): boolean {
    return this.actionMap.has(name);
  }

  /** Inject a one-frame synthetic action pulse. */
  fireAction(name: string): void {
    if (!this.actionMap.has(name)) {
      throw new Error(`InputManager.fireAction(): unknown action "${name}".`);
    }
    this.pulsedSyntheticActions.add(name);
    this.stepPulseTags.set(name, this.stepTag());
    // Preserve a held action's start so a stray pulse can't rewind its hold.
    if (!this.isActionHeldByCode(name)) {
      for (const state of this.allStates()) {
        state.syntheticStart.set(name, this.stateNow(state));
      }
    }
    // Match the physical path: a disabled action's state is already suppressed
    // at query time, so its listeners must not fire either.
    if (this.isActionEnabled(name)) {
      this.notifyActionListeners(this.actionListeners, name);
      this.recordActionPress(name);
    }
  }

  /**
   * Create an independently releasable producer of sustained action presses.
   * Create one source per virtual device, replay driver, or other owner.
   */
  createActionSource(): InputActionSource {
    return new ManagerActionSource(this, this.nextActionSourceId++);
  }

  /** @internal Called by the source returned from {@link createActionSource}. */
  _setActionSourceHeld(sourceId: number, action: string, held: boolean): void {
    const code = `\u0000action:${sourceId}:${action}`;
    if (held) {
      if (!this.actionMap.has(action)) {
        throw new Error(
          `InputActionSource.setHeld(): unknown action "${action}".`,
        );
      }
      if (this.pressedKeys.has(code)) return;
      let codes = this.sourceCodes.get(sourceId);
      if (!codes) {
        codes = new Set();
        this.sourceCodes.set(sourceId, codes);
      }
      codes.add(code);
      this.syntheticCodes.add(code);
      this.applyCodeDown(code, [action], false);
      return;
    }
    if (!this.pressedKeys.has(code)) return;
    this.applyCodeUp(code, false);
    this.syntheticCodes.delete(code);
    const codes = this.sourceCodes.get(sourceId);
    codes?.delete(code);
    if (codes?.size === 0) this.sourceCodes.delete(sourceId);
  }

  /** @internal Called by the source returned from {@link createActionSource}. */
  _releaseActionSource(sourceId: number): void {
    const codes = this.sourceCodes.get(sourceId);
    if (!codes) return;
    for (const code of [...codes]) {
      this.applyCodeUp(code, false);
      this.syntheticCodes.delete(code);
    }
    this.sourceCodes.delete(sourceId);
  }

  /** Release all synthetic and physical input state. */
  clearAll(): void {
    for (const code of [...this.pressedKeys]) {
      this.applyCodeUp(code, !this.syntheticCodes.has(code));
    }
    // Hard reset: synthetic releases generated above are intentionally
    // discarded. Callers want a clean slate, not a flurry of justReleased
    // pulses for downstream listeners.
    this.justPressedKeys.clear();
    this.justReleasedKeys.clear();
    this.pulsedSyntheticActions.clear();
    this.actionPressesThisFrame.clear();
    this.actionReleasesThisFrame.clear();
    this.activePressActions.clear();
    this.syntheticCodes.clear();
    this.sourceCodes.clear();
    this.claimedBufferedPress.clear();
    for (const state of this.allStates()) {
      state.holdStart.clear();
      state.syntheticStart.clear();
      state.releaseDuration.clear();
      state.stepReleaseDuration.clear();
      state.prevHold.clear();
      state.stepPrevHold.clear();
      state.stepHoldSnapshot.clear();
      state.pressStamp.clear();
    }
    this.stepPressTags.clear();
    this.stepReleaseTags.clear();
    this.stepPulseTags.clear();
    this.stepActionPressTags.clear();
    this.stepActionReleaseTags.clear();
    this.stepHoldRotatedAt = -1;
    this.pointers.clear();
    this.queuedPointers.clear();
    this.pointerPressesThisFrame.length = 0;
    this.primaryPointerId = null;
    this.mouseButtonAggregate.clear();
    this.consumedPointers.clear();
    this.inputQueue.length = 0;
    this.lastButtonState.clear();
    this.gamepadAxisState.clear();
    this.syntheticAxisState.clear();
    this.lastPadActivity.clear();
  }

  /**
   * Drop all tracked pointers and release the aggregate `MouseLeft/Middle/Right`
   * codes without touching keyboard or gamepad state. Useful for window-blur
   * / page-hide handling.
   */
  clearPointerButtons(): void {
    this.inputQueue = this.inputQueue.filter(
      (event) => !event.kind.startsWith("pointer"),
    );
    this.queuedPointers.clear();
    for (const pointer of [...this.pointers.values()]) {
      if (pointer.isDown) this._applyPointerCancel(pointer.id);
    }
    this.pointers.clear();
    this.primaryPointerId = null;
    this.consumedPointers.clear();
    this.mouseButtonAggregate.clear();
  }

  /**
   * @internal Release physical input on window blur or page hide, then discard
   * browser events queued before the boundary.
   */
  _releaseAllPhysicalState(): void {
    this.inputQueue.length = 0;
    this.queuedPointers.clear();
    for (const code of [...this.pressedKeys]) {
      if (
        this.syntheticCodes.has(code) ||
        code.startsWith("Gamepad") ||
        MOUSE_BUTTON_CODES.includes(code as (typeof MOUSE_BUTTON_CODES)[number])
      ) {
        continue;
      }
      this._applyKeyUp(code);
    }
    this._releaseAllGamepadState();
    this.clearPointerButtons();
  }

  /** Snapshot of current held input state for inspector tooling. */
  snapshotState(): {
    keys: string[];
    actions: string[];
    mouse: { x: number; y: number; buttons: number[]; down: boolean };
    pointers: Array<{
      id: number;
      generation: number;
      x: number;
      y: number;
      type: PointerType;
      isPrimary: boolean;
      buttons: number[];
      down: boolean;
    }>;
    gamepad: {
      buttons: string[];
      axes: Array<{ key: string; value: number }>;
    };
  } {
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const keys = [...this.pressedKeys]
      .filter((code) => !this.syntheticCodes.has(code))
      .sort(cmp);
    const nonGamepadKeys = keys.filter((k) => !k.startsWith("Gamepad"));
    const gamepadButtons = keys.filter((k) => k.startsWith("Gamepad"));
    const actions = this.getActionNames()
      .filter((action) => this.isPressed(action))
      .sort(cmp);
    const aggregateButtons = [...this.mouseButtonAggregate].sort(
      (a, b) => a - b,
    );
    const pointers = [...this.pointers.values()]
      .sort((a, b) => a.id - b.id)
      .map((p) => ({
        id: p.id,
        generation: p.generation,
        x: p.screenPos.x,
        y: p.screenPos.y,
        type: p.type,
        isPrimary: p.isPrimary,
        buttons: [...p.buttons].sort((a, b) => a - b),
        down: p.isDown,
      }));
    const primary = this.getPrimaryPointer();
    const realAxes = [...this.gamepadAxisState.entries()]
      .filter(([, value]) => Math.abs(value) > 0.001)
      .map(([key, value]) => ({ key, value }));
    const syntheticAxes = [...this.syntheticAxisState.entries()]
      .filter(([, value]) => Math.abs(value) > 0.001)
      .map(([key, value]) => ({ key: `synthetic:${key}`, value }));
    const axes = [...realAxes, ...syntheticAxes].sort((a, b) =>
      cmp(a.key, b.key),
    );

    return {
      keys: nonGamepadKeys,
      actions,
      mouse: {
        x: primary?.screenPos.x ?? 0,
        y: primary?.screenPos.y ?? 0,
        buttons: aggregateButtons,
        down: this.mouseButtonAggregate.size > 0,
      },
      pointers,
      gamepad: {
        buttons: gamepadButtons,
        axes,
      },
    };
  }

  // -- Internal: DOM-handler enqueue path --

  /**
   * @internal Stash the renderer adapter so the drain step can call its
   * optional `hitTestUI(x, y)` for the auto-consume fallback. Called by
   * `InputPlugin.install`.
   */
  _setRenderer(renderer: RendererAdapter | null): void {
    this.renderer = renderer;
  }

  /**
   * @internal Wire the error boundary so a throwing key/action listener is
   * attributed and reported. Called by `InputPlugin.install`.
   */
  _setErrorBoundary(boundary: ErrorBoundary | undefined): void {
    this.errorBoundary = boundary;
  }

  /**
   * @internal Wire the scheduler so edge queries can resolve the caller's
   * execution context (phase and fixed step). Called by
   * `InputPlugin.registerSystems`. When never wired (standalone manager),
   * every query resolves against the frame window.
   */
  _setScheduler(scheduler: SchedulerLike): void {
    this.scheduler = scheduler;
  }

  /** @internal */
  _enqueueKeyDown(code: string): void {
    this.inputQueue.push({ kind: "keyDown", code });
  }

  /** @internal */
  _enqueueKeyUp(code: string): void {
    this.inputQueue.push({ kind: "keyUp", code });
  }

  /** @internal Apply pointer movement immediately for live cursor tracking. */
  _enqueuePointerMove(info: PointerEventInfo): void {
    const state = this.queuedPointerState(info);
    this.drainPointerMove(info, state.generation);
  }

  /**
   * @internal Queue a pointer press with the generation assigned at browser
   * dispatch time. Listeners and action edges run together at input drain.
   */
  _enqueuePointerDown(info: PointerEventInfo): void {
    const state = this.queuedPointerState(info);
    if (state.buttons.size === 0 || state.terminalQueued) {
      state.generation = this.nextPointerGeneration++;
      state.terminalQueued = false;
    }
    state.buttons.add(info.button);
    this.inputQueue.push({
      kind: "pointerDown",
      info,
      generation: state.generation,
    });
  }

  /** @internal */
  _enqueuePointerUp(info: PointerEventInfo): void {
    const state = this.queuedPointerState(info);
    if (state.terminalQueued || !state.buttons.has(info.button)) return;
    const generation = state.generation;
    state.buttons.delete(info.button);
    if (state.buttons.size === 0) state.terminalQueued = true;
    this.inputQueue.push({ kind: "pointerUp", info, generation });
  }

  /** @internal */
  _enqueuePointerCancel(id: number): void {
    const current = this.pointers.get(id);
    let state = this.queuedPointers.get(id);
    if (!state && current) {
      state = {
        generation: current.generation,
        buttons: new Set(current.buttons),
        type: current.type,
        isPrimary: current.isPrimary,
        terminalQueued: false,
      };
      this.queuedPointers.set(id, state);
    }
    if (!state || state.terminalQueued) return;
    const hadActivePress = state.buttons.size > 0 || current?.isDown === true;
    state.buttons.clear();
    state.terminalQueued = true;
    this.inputQueue.push({
      kind: "pointerCancel",
      id,
      generation: state.generation,
      hadActivePress,
    });
  }

  /** @internal */
  _enqueueWheel(dx: number, dy: number, screenX = 0, screenY = 0): void {
    this.inputQueue.push({ kind: "wheel", dx, dy, screenX, screenY });
  }

  /**
   * @internal Drain queued DOM events at `Phase.EarlyUpdate`. Each event
   * applies its deferred state (button mutations, action-map edges,
   * mouse-aggregate transitions). Consumed pointers are excluded from the
   * mouse aggregate so UI-claimed presses do not propagate to gameplay
   * actions. The renderer's optional `hitTestUI(x, y)` auto-claims a pointer
   * whose `pointerdown` lands on a UI-marked container.
   */
  _drainInputQueue(): void {
    if (this.inputQueue.length === 0) return;
    const queue = this.inputQueue;
    this.inputQueue = [];
    for (const event of queue) {
      switch (event.kind) {
        case "keyDown":
          this._applyKeyDown(event.code);
          break;
        case "keyUp":
          this._applyKeyUp(event.code);
          break;
        case "pointerDown":
          this.drainPointerDown(event.info, event.generation);
          break;
        case "pointerUp":
          this.drainPointerUp(event.info, event.generation);
          break;
        case "pointerCancel":
          this.drainPointerCancel(
            event.id,
            event.generation,
            event.hadActivePress,
          );
          break;
        case "wheel":
          this.dispatchWheel(event.dx, event.dy, event.screenX, event.screenY);
          break;
      }
    }
  }

  private drainPointerMove(info: PointerEventInfo, generation: number): void {
    const pointer = this.upsertPointer(info, generation);
    pointer.screenPos = new Vec2(info.screenX, info.screenY);
    this.notifyPointerListeners(
      this.pointerMoveListeners,
      pointer,
      "pointermove",
    );
  }

  private drainPointerDown(info: PointerEventInfo, generation: number): void {
    const pointer = this.upsertPointer(info, generation);
    pointer.screenPos = new Vec2(info.screenX, info.screenY);
    const world = this.camera?.screenToWorld(info.screenX, info.screenY);
    const worldPos = world ? new Vec2(world.x, world.y) : pointer.screenPos;
    if (this.renderer?.hitTestUI?.(info.screenX, info.screenY)) {
      this.consumedPointers.set(info.id, generation);
    }
    this.notifyPointerListeners(
      this.pointerDownListeners,
      pointer,
      "pointerdown",
      info.button,
    );
    const consumed = this.consumedPointers.get(info.id) === generation;
    if (info.button >= 0 && info.button <= 2) {
      pointer.buttons.add(info.button);
      pointer.isDown = true;
      this.pointerPressesThisFrame.push({
        info: this.toPointerInfo(pointer, info.button),
        worldPos,
        consumed,
      });
      this.recomputeMouseAggregate(info.button);
    } else {
      pointer.isDown = pointer.buttons.size > 0;
      this.pointerPressesThisFrame.push({
        info: this.toPointerInfo(pointer, info.button),
        worldPos,
        consumed,
      });
    }
  }

  private drainPointerUp(info: PointerEventInfo, generation: number): void {
    const pointer = this.pointers.get(info.id);
    if (!pointer || pointer.generation !== generation) return;
    pointer.screenPos = new Vec2(info.screenX, info.screenY);
    this.notifyPointerListeners(
      this.pointerUpListeners,
      pointer,
      "pointerup",
      info.button,
    );
    if (info.button >= 0 && info.button <= 2) {
      pointer.buttons.delete(info.button);
      this.recomputeMouseAggregate(info.button);
    }
    pointer.isDown = pointer.buttons.size > 0;
    if (!pointer.isDown) {
      // End of event cycle — clear the consume mark so the next press starts
      // unmarked. Touch / pen pointers also vanish here (mouse persists for
      // hover queries; the browser does not emit a separate "leave").
      if (this.consumedPointers.get(info.id) === generation) {
        this.consumedPointers.delete(info.id);
      }
      if (pointer.type !== "mouse") {
        this.removePointer(pointer.id);
      }
      const queued = this.queuedPointers.get(info.id);
      if (queued?.generation === generation && queued.terminalQueued) {
        this.queuedPointers.delete(info.id);
      }
    }
  }

  private drainPointerCancel(
    id: number,
    generation: number,
    hadActivePress: boolean,
  ): void {
    const pointer = this.pointers.get(id);
    if (!pointer || pointer.generation !== generation) return;
    const heldButtons = [...pointer.buttons];
    pointer.buttons.clear();
    pointer.isDown = false;
    for (const button of heldButtons) {
      this.recomputeMouseAggregate(button);
    }
    if (hadActivePress) {
      this.notifyPointerListeners(
        this.pointerUpListeners,
        pointer,
        "pointercancel",
      );
    }
    if (this.consumedPointers.get(id) === generation) {
      this.consumedPointers.delete(id);
    }
    if (pointer.type !== "mouse") {
      this.removePointer(id);
    }
    const queued = this.queuedPointers.get(id);
    if (queued?.generation === generation && queued.terminalQueued) {
      this.queuedPointers.delete(id);
    }
  }

  private dispatchWheel(
    dx: number,
    dy: number,
    screenX?: number,
    screenY?: number,
  ): void {
    const autoConsumed =
      screenX !== undefined &&
      screenY !== undefined &&
      (this.renderer?.hitTestUI?.(screenX, screenY) ?? false);
    this.wheelClaims.push(autoConsumed);
    this._callListeners(
      this.wheelListeners,
      (fn) => fn(dx, dy),
      "Wheel listener",
      "wheel",
    );
    const consumed = this.wheelClaims.pop() ?? false;
    if (consumed) return;
    // Wheel codes appear as one-frame `justPressed` edges that never enter
    // `pressedKeys` — scrolling is not a held state, just discrete ticks.
    if (Math.abs(dy) > 0.001) {
      const code = dy < 0 ? "WheelUp" : "WheelDown";
      this.fireOneFrameEdge(code);
    }
    if (Math.abs(dx) > 0.001) {
      const code = dx < 0 ? "WheelLeft" : "WheelRight";
      this.fireOneFrameEdge(code);
    }
  }

  private queuedPointerState(info: PointerEventInfo): QueuedPointerState {
    let state = this.queuedPointers.get(info.id);
    if (!state) {
      const current = this.pointers.get(info.id);
      state = {
        generation: current?.generation ?? 0,
        buttons: new Set(current?.buttons),
        type: info.type,
        isPrimary: info.isPrimary,
        terminalQueued: false,
      };
      this.queuedPointers.set(info.id, state);
    } else {
      state.type = info.type;
      state.isPrimary = info.isPrimary;
    }
    return state;
  }

  /**
   * Add a code to `justPressedKeys` without entering `pressedKeys`. Used for
   * discrete edges (wheel ticks) that are never "held". Listeners and
   * `listenForNextKey` still fire as usual.
   */
  private fireOneFrameEdge(code: string): void {
    if (this.listenResolve) {
      const resolve = this.listenResolve;
      this.listenResolve = null;
      resolve(code);
      return;
    }
    this.justPressedKeys.add(code);
    this.stepPressTags.set(code, this.stepTag());
    this.notifyKeyListeners(
      this.keyDownListeners,
      this.keyDownListenersAny,
      code,
    );
    for (const action of this.actionsForCode(code)) {
      this.actionPressesThisFrame.add(action);
      this.stepActionPressTags.set(action, this.stepTag());
      this.notifyActionListeners(this.actionListeners, action);
      this.recordActionPress(action);
    }
  }

  // -- Internal: synthetic / sync apply path --

  /**
   * @internal Synthetic key-down. DOM-originated events must use
   * {@link _enqueueKeyDown} so `consumePointer` and the UI hit-test fallback
   * have a chance to run before action edges fire.
   */
  _applyKeyDown(code: string): void {
    this.applyCodeDown(code, this.mappedActionsForCode(code), true);
  }

  private applyCodeDown(
    code: string,
    actions: readonly string[],
    notifyKey: boolean,
  ): void {
    if (notifyKey && this.listenResolve) {
      const resolve = this.listenResolve;
      this.listenResolve = null;
      resolve(code);
      return;
    }
    if (!this.pressedKeys.has(code)) {
      this.pressedKeys.add(code);
      this.activePressActions.set(code, [...actions]);
      this.justPressedKeys.add(code);
      this.stepPressTags.set(code, this.stepTag());
      for (const state of this.allStates()) {
        state.holdStart.set(code, this.stateNow(state));
      }
      if (notifyKey) {
        this.notifyKeyListeners(
          this.keyDownListeners,
          this.keyDownListenersAny,
          code,
        );
      }
      for (const action of actions) {
        if (this.isActionEnabled(action)) {
          this.actionPressesThisFrame.add(action);
          this.stepActionPressTags.set(action, this.stepTag());
          this.notifyActionListeners(this.actionListeners, action);
          this.recordActionPress(action);
        }
      }
    }
  }

  /**
   * @internal Synthetic key-up. DOM-originated events must use
   * {@link _enqueueKeyUp}.
   */
  _applyKeyUp(code: string): void {
    this.applyCodeUp(code, true);
  }

  private applyCodeUp(code: string, notifyKey: boolean): void {
    if (this.pressedKeys.has(code)) {
      const actions = this.activePressActions.get(code) ?? [];
      const durations = this.endKeyHold(code);
      this.pressedKeys.delete(code);
      this.activePressActions.delete(code);
      this.justReleasedKeys.add(code);
      this.stepReleaseTags.set(code, this.stepTag());
      this.clearEndedStepHoldBaselines(actions);
      if (notifyKey) {
        this.notifyKeyListeners(
          this.keyUpListeners,
          this.keyUpListenersAny,
          code,
        );
      }
      for (const action of actions) {
        this.actionReleasesThisFrame.add(action);
        this.stepActionReleaseTags.set(action, this.stepTag());
        if (this.isActionEnabled(action)) {
          this.notifyActionListeners(this.actionReleasedListeners, action);
          if (!this.isActionStillHeld(action)) {
            this.recordActionRelease(action, durations);
          }
        }
      }
    }
  }

  /**
   * @internal Synthetic pointer move. DOM-originated events must use
   * {@link _enqueuePointerMove}.
   */
  _applyPointerMove(info: PointerEventInfo): void {
    const state = this.queuedPointerState(info);
    this.drainPointerMove(info, state.generation);
  }

  /**
   * @internal Synthetic pointer down. DOM-originated events must use
   * {@link _enqueuePointerDown}. This applies all state (button mutation,
   * mouse-aggregate emit, listener notify) synchronously.
   */
  _applyPointerDown(info: PointerEventInfo): void {
    const state = this.queuedPointerState(info);
    if (state.buttons.size === 0 || state.terminalQueued) {
      state.generation = this.nextPointerGeneration++;
      state.terminalQueued = false;
    }
    state.buttons.add(info.button);
    this.drainPointerDown(info, state.generation);
  }

  /**
   * @internal Synthetic pointer up. DOM-originated events must use
   * {@link _enqueuePointerUp}.
   */
  _applyPointerUp(info: PointerEventInfo): void {
    const state = this.queuedPointerState(info);
    if (state.terminalQueued || !state.buttons.has(info.button)) return;
    const generation = state.generation;
    state.buttons.delete(info.button);
    if (state.buttons.size === 0) state.terminalQueued = true;
    this.drainPointerUp(info, generation);
  }

  /**
   * @internal Synthetic pointer cancel. Clears all buttons on the pointer,
   * fires up-listeners, and drops the entry (unless it's a mouse). Mirrors
   * the drain-time {@link drainPointerCancel} logic.
   */
  _applyPointerCancel(id: number): void {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    const state = this.queuedPointers.get(id) ?? {
      generation: pointer.generation,
      buttons: new Set(pointer.buttons),
      type: pointer.type,
      isPrimary: pointer.isPrimary,
      terminalQueued: false,
    };
    this.queuedPointers.set(id, state);
    if (state.terminalQueued) return;
    const hadActivePress = state.buttons.size > 0 || pointer.isDown;
    state.buttons.clear();
    state.terminalQueued = true;
    this.drainPointerCancel(id, state.generation, hadActivePress);
  }

  private upsertPointer(
    info: PointerEventInfo,
    generation: number,
  ): MutablePointerInfo {
    let pointer = this.pointers.get(info.id);
    if (!pointer || pointer.generation !== generation) {
      pointer = {
        id: info.id,
        generation,
        screenPos: new Vec2(info.screenX, info.screenY),
        type: info.type,
        isPrimary: info.isPrimary,
        buttons: new Set<number>(),
        isDown: false,
      };
      this.pointers.set(info.id, pointer);
    } else {
      pointer.type = info.type;
      pointer.isPrimary = info.isPrimary;
    }
    if (info.isPrimary) {
      this.primaryPointerId = info.id;
    } else if (this.primaryPointerId === null) {
      this.primaryPointerId = info.id;
    }
    return pointer;
  }

  private removePointer(id: number): void {
    this.pointers.delete(id);
    if (this.primaryPointerId === id) {
      // Promote any remaining tracked pointer to primary so singular getters
      // keep returning sensible state. Prefer one the browser already flagged
      // primary, otherwise the first one we find.
      let next: number | null = null;
      for (const p of this.pointers.values()) {
        if (p.isPrimary) {
          next = p.id;
          break;
        }
        if (next === null) next = p.id;
      }
      this.primaryPointerId = next;
    }
  }

  /**
   * Recompute the `MouseLeft/Middle/Right` aggregate edge for `button`.
   * Consumed pointers are excluded so a UI-claimed press never propagates to
   * gameplay actions, even if a second non-UI pointer simultaneously holds
   * the same button.
   */
  private recomputeMouseAggregate(button: number): void {
    const code = MOUSE_BUTTON_CODES[button];
    if (!code) return;
    let nowAny = false;
    for (const p of this.pointers.values()) {
      if (this.consumedPointers.get(p.id) === p.generation) continue;
      if (p.buttons.has(button)) {
        nowAny = true;
        break;
      }
    }
    const wasAny = this.mouseButtonAggregate.has(button);
    if (nowAny && !wasAny) {
      this.mouseButtonAggregate.add(button);
      this._applyKeyDown(code);
    } else if (!nowAny && wasAny) {
      this.mouseButtonAggregate.delete(button);
      this._applyKeyUp(code);
    }
  }

  private notifyPointerListeners(
    listeners: Array<(info: PointerInfo) => void>,
    pointer: MutablePointerInfo,
    event: "pointerdown" | "pointerup" | "pointermove" | "pointercancel",
    button = -1,
  ): void {
    if (listeners.length === 0) return;
    // Snapshot happens inside `_callListeners`; build the shared `PointerInfo`
    // view once so all listeners see the same values.
    const info = this.toPointerInfo(pointer, button);
    const previousDispatch = this.activePointerDispatch;
    this.activePointerDispatch = {
      id: pointer.id,
      generation: pointer.generation,
    };
    this._callListeners(listeners, (fn) => fn(info), "Pointer listener", event);
    this.activePointerDispatch = previousDispatch;
  }

  private notifyKeyListeners(
    perCode: Map<string, Array<(code: string) => void>>,
    anyList: Array<(code: string) => void>,
    code: string,
  ): void {
    const list = perCode.get(code);
    if (list) this._callListeners(list, (fn) => fn(code), "Key listener", code);
    if (anyList.length > 0) {
      this._callListeners(anyList, (fn) => fn(code), "Key listener", "*");
    }
  }

  private notifyActionListeners(
    perAction: Map<string, Array<(name: string) => void>>,
    name: string,
  ): void {
    const list = perAction.get(name);
    if (!list) return;
    this._callListeners(list, (fn) => fn(name), "Action listener", name);
  }

  /**
   * Shared listener fan-out for key/action edges, gamepad/active-pad events,
   * and pointer/wheel events. Iterates a snapshot so a listener that
   * unsubscribes itself doesn't skip the next one.
   */
  private _callListeners<T>(
    live: readonly T[],
    invoke: (fn: T) => void,
    kind: string,
    event: string,
  ): void {
    for (const fn of [...live]) {
      if (this.errorBoundary) {
        this.errorBoundary.wrapCallback(() => invoke(fn), { kind, event });
      } else {
        invoke(fn);
      }
    }
  }

  /**
   * Action names that include `code` in their bindings AND whose group is
   * currently enabled. Used for `onAction` / `onActionReleased` listener
   * fan-out so disabled-group suppression matches `isPressed` behavior.
   */
  private actionsForCode(code: string): string[] {
    const result: string[] = [];
    for (const [action, keys] of this.actionMap) {
      if (keys.includes(code) && this.isActionEnabled(action)) {
        result.push(action);
      }
    }
    return result;
  }

  /** Action mapping for a press, independent of temporary group enablement. */
  private mappedActionsForCode(code: string): string[] {
    const result: string[] = [];
    for (const [action, keys] of this.actionMap) {
      if (keys.includes(code)) result.push(action);
    }
    return result;
  }

  /** @internal End-of-frame reset: clear per-frame edge flags and snapshot per-action holds for the next frame's crossing tests. */
  _clearFrameState(): void {
    this.justPressedKeys.clear();
    this.justReleasedKeys.clear();
    this.actionPressesThisFrame.clear();
    this.actionReleasesThisFrame.clear();
    this.pointerPressesThisFrame.length = 0;
    const endedPulses = [...this.pulsedSyntheticActions];
    this.pulsedSyntheticActions.clear();
    // Fixed-step windows outlive the frame — a frame can run zero steps —
    // so only entries whose step has already started are dropped. This is
    // housekeeping: a stale tag can never match a future window, because
    // the step index is monotonic.
    const currentTag = this.stepTag();
    for (const state of this.allStates()) {
      // Release durations are release-frame-only, matching isJustReleased.
      state.releaseDuration.clear();
      for (const action of endedPulses) state.syntheticStart.delete(action);
      // Snapshot each action's hold for isJustHeldFor: the max across bindings
      // can DROP when the longest-held one releases, so "last frame's hold"
      // cannot be derived from dt — that would re-fire the crossing edge.
      // Raw (enablement-ignoring) so a hold spanning a disabled group keeps its
      // baseline: re-enabling mid-hold must not report a second crossing.
      for (const action of this.actionMap.keys()) {
        const hold = this.rawHoldOn(action, state);
        if (hold > 0) state.prevHold.set(action, hold);
        else state.prevHold.delete(action);
      }
      for (const [action, entry] of state.stepReleaseDuration) {
        if (entry.tag < currentTag) state.stepReleaseDuration.delete(action);
      }
    }
    this.pruneStepTags(this.stepPressTags, currentTag);
    this.pruneStepTags(this.stepReleaseTags, currentTag);
    this.pruneStepTags(this.stepPulseTags, currentTag);
    this.pruneStepTags(this.stepActionPressTags, currentTag);
    this.pruneStepTags(this.stepActionReleaseTags, currentTag);
  }

  /** Drop step-window entries whose step has already started. */
  private pruneStepTags(tags: Map<string, number>, beforeTag: number): void {
    for (const [key, tag] of tags) {
      if (tag < beforeTag) tags.delete(key);
    }
  }

  /** Set camera for pointer world-coord conversion. */
  setCamera(camera: CameraLike): void {
    this.camera = camera;
  }

  /** Clear the camera reference (e.g. on scene exit). */
  clearCamera(): void {
    this.camera = null;
  }

  /** Get all configured action names. */
  getActionNames(): string[] {
    return Array.from(this.actionMap.keys());
  }

  /** @internal Advance the elapsed game-time clock. Called by InputPollSystem. */
  _advanceTime(dtMs: number): void {
    this.elapsedMs += dtMs;
  }

  // -- Internal: sync-path aliases (back-compat with pre-0.5.x test callers) --

  /** @internal Sync alias — see {@link _applyKeyDown}. */
  _onKeyDown(code: string): void {
    this._applyKeyDown(code);
  }
  /** @internal Sync alias — see {@link _applyKeyUp}. */
  _onKeyUp(code: string): void {
    this._applyKeyUp(code);
  }
  /** @internal Sync alias — see {@link _applyPointerMove}. */
  _onPointerMove(info: PointerEventInfo): void {
    this._applyPointerMove(info);
  }
  /** @internal Sync alias — see {@link _applyPointerDown}. */
  _onPointerDown(info: PointerEventInfo): void {
    this._applyPointerDown(info);
  }
  /** @internal Sync alias — see {@link _applyPointerUp}. */
  _onPointerUp(info: PointerEventInfo): void {
    this._applyPointerUp(info);
  }
  /** @internal Sync alias — see {@link _applyPointerCancel}. */
  _onPointerCancel(id: number): void {
    this._applyPointerCancel(id);
  }
}
