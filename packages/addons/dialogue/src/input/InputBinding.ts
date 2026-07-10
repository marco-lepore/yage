/**
 * Input is externalised so it's obviously *optional* and obviously *swappable*.
 * A `DialogueSession` exposes an input-agnostic API (`advance / moveSelection /
 * setFastForward`); an {@link InputBinding} is whatever maps a device onto it.
 * The default {@link KeyboardInputBinding} polls the YAGE `InputManager` action
 * map. An ambient (auto-advancing) conversation simply attaches no binding; a
 * touch/gamepad/pointer binding is a parallel implementation of this interface.
 */

import type { InputManager } from "@yagejs/input";
import type { DialogueSession } from "../core/session.js";

export interface DialogueActions {
  /** Tap → reveal-all if typing, else next line / confirm choice. */
  readonly advance: readonly string[];
  /** Hold → fast-forward the typewriter. */
  readonly speed: readonly string[];
  readonly up: readonly string[];
  readonly down: readonly string[];
  /** Tap → skip the current section to the next choice/end. Unbound by default. */
  readonly skip?: readonly string[];
}

export const DEFAULT_DIALOGUE_ACTIONS: DialogueActions = {
  advance: ["interact"],
  speed: ["attack"],
  up: ["move-up"],
  down: ["move-down"],
};

/** Keyboard actions with skip bound (the game maps `skip` → KeyX in main.ts). */
export const FULL_DIALOGUE_ACTIONS: DialogueActions = {
  ...DEFAULT_DIALOGUE_ACTIONS,
  skip: ["skip"],
};

export interface InputBinding {
  /**
   * Wire a device to a session. Called by the host once both exist. A binding
   * has a single owner: re-binding re-targets it (implementations must release
   * any resources held for the previous bind) — don't share one instance
   * between two live controllers.
   */
  bind(input: InputManager, session: DialogueSession): void;
  /** Poll the device and drive the session. Called once per frame by the host. */
  poll(): void;
  /** Optional teardown (e.g. unsubscribe pointer listeners). */
  dispose?(): void;
  /**
   * The `InputManager` action names this binding polls, if it polls any. The
   * host reads these to validate them against the live action map — a binding
   * whose names are all absent silently no-ops. Device bindings that poll no
   * action map (e.g. a pure pointer binding) omit this.
   */
  actionNames?(): readonly string[];
}

/**
 * A presenter that can resolve a pointer point to a choice position — lets a
 * pointer binding pick/hover choices without owning their geometry. Coords are
 * in `pointerSpace` ("screen" default; a bubble/world list uses "world").
 */
export interface PointerChoiceTarget {
  /** Position of the choice row under this point, or undefined. Omit for no
   *  pointer hit-testing. */
  choiceAtPoint?(x: number, y: number): number | undefined;
  readonly pointerSpace?: "screen" | "world";
}

/** Fan a single session out to several device bindings (keyboard + pointer …). */
export class CompositeInputBinding implements InputBinding {
  constructor(private readonly bindings: readonly InputBinding[]) {}
  bind(input: InputManager, session: DialogueSession): void {
    for (const b of this.bindings) b.bind(input, session);
  }
  poll(): void {
    for (const b of this.bindings) b.poll();
  }
  dispose(): void {
    for (const b of this.bindings) b.dispose?.();
  }
  /** Union of every child binding's polled action names (de-duplicated). */
  actionNames(): readonly string[] {
    const names = new Set<string>();
    for (const b of this.bindings) {
      for (const a of b.actionNames?.() ?? []) names.add(a);
    }
    return [...names];
  }
}

/** Keyboard/gamepad action-map binding (the default). */
export class KeyboardInputBinding implements InputBinding {
  private input?: InputManager;
  private session?: DialogueSession;
  /** Latch so a held skip fires once per hold, not every frame past threshold. */
  private skipFired = false;

  /**
   * @param skipHold Hold the `skip` action this many seconds before it fires
   *   (the classic "hold to skip" confirm). `0` (default) fires on press.
   */
  constructor(
    private readonly actions: DialogueActions = DEFAULT_DIALOGUE_ACTIONS,
    private readonly skipHold = 0,
  ) {}

  bind(input: InputManager, session: DialogueSession): void {
    this.input = input;
    this.session = session;
  }

  /** Every action name this binding polls, across all slots (de-duplicated). */
  actionNames(): readonly string[] {
    const { advance, speed, up, down, skip } = this.actions;
    return [...new Set([...advance, ...speed, ...up, ...down, ...(skip ?? [])])];
  }

  poll(): void {
    const { input, session } = this;
    if (!input || !session) return;
    session.setFastForward(held(input, this.actions.speed));
    this.pollSkip(input, session);
    if (justPressed(input, this.actions.advance)) session.advance();
    if (justPressed(input, this.actions.up)) session.moveSelection(-1);
    else if (justPressed(input, this.actions.down)) session.moveSelection(1);
  }

  /** Fire skip once the action has been held `skipHold` seconds
   *  (hold-to-confirm), re-arming only after it's released. */
  private pollSkip(input: InputManager, session: DialogueSession): void {
    const skip = this.actions.skip;
    if (!skip) return;
    // `isHeldFor` takes milliseconds.
    const ready = skip.some(
      (a) => input.isPressed(a) && input.isHeldFor(a, this.skipHold * 1000),
    );
    if (ready) {
      if (!this.skipFired) {
        session.skip();
        this.skipFired = true;
      }
    } else if (!held(input, skip)) {
      this.skipFired = false;
    }
  }
}

function justPressed(input: InputManager, actions: readonly string[]): boolean {
  return actions.some((a) => input.isJustPressed(a));
}

function held(input: InputManager, actions: readonly string[]): boolean {
  return actions.some((a) => input.isPressed(a));
}

/**
 * Mouse/touch binding. A tap during a line advances (reveal-all, then next);
 * a tap on a choice row picks it, and hover highlights it — provided a
 * {@link PointerChoiceTarget} is supplied so the binding can hit-test rows.
 * Works for both mouse and touch since it rides the unified pointer stream.
 */
export class PointerInputBinding implements InputBinding {
  private input?: InputManager;
  private session?: DialogueSession;
  // Explicit `| undefined` so `dispose()` can null it (exactOptionalPropertyTypes).
  private unsub: (() => void) | undefined;
  /** Pointer id of the primary-button press since the last poll, if any.
   *  Cleared by poll(), which drops it when the pointer is marked consumed. */
  private clickedPointer: number | undefined;

  // Explicit `| undefined` (not `?:`) so the ctor can assign the possibly-
  // undefined argument under `exactOptionalPropertyTypes`.
  private readonly choices: PointerChoiceTarget | undefined;

  /** Pointer position at the last hover hit-test, so an unmoved pointer
   *  doesn't re-run the hit-test every frame. */
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  /** Whether the previous poll saw a choice up (a fresh choice set must be
   *  hit-tested even under a stationary pointer). */
  private wasChoosing = false;

  constructor(choices?: PointerChoiceTarget) {
    this.choices = choices;
  }

  bind(input: InputManager, session: DialogueSession): void {
    // Self-heal a re-bind (component re-add, or a binding instance reused by a
    // second controller): release the previous pointer subscription, which
    // would otherwise leak past dispose() and keep driving the old session.
    this.unsub?.();
    this.input = input;
    this.session = session;
    this.unsub = input.onPointerDown((info) => {
      if (info.button === 0) this.clickedPointer = info.id; // primary button / touch only
    });
  }

  /** Pointer position in the choice presenter's coordinate space. */
  private pointer(input: InputManager): { x: number; y: number } {
    return this.choices?.pointerSpace === "world"
      ? input.getPointerPosition()
      : input.getPointerScreenPosition();
  }

  poll(): void {
    const { input, session } = this;
    if (!input || !session) return;

    // Hover-highlight the choice under the pointer. Hit-test only when the
    // result could have changed: the pointer moved (world coords also move
    // with the camera), or a choice set just came up under a still pointer.
    const choosing = session.isChoosing();
    if (choosing && this.choices?.choiceAtPoint) {
      const p = this.pointer(input);
      if (!this.wasChoosing || p.x !== this.lastX || p.y !== this.lastY) {
        this.lastX = p.x;
        this.lastY = p.y;
        const hovered = this.choices.choiceAtPoint(p.x, p.y);
        if (hovered !== undefined) session.selectAt(hovered);
      }
    }
    this.wasChoosing = choosing;

    const clicked = this.clickedPointer;
    this.clickedPointer = undefined;
    if (clicked === undefined) return;
    // A pointer claimed elsewhere (`consumePointer` — e.g. a touch overlay
    // that owns the tap) must not also advance the conversation. The consume
    // mark persists until the pointer releases, so reading it at poll time
    // is safe whatever order the down-listeners ran in.
    if (input.isPointerConsumed(clicked)) return;
    if (choosing) {
      const p = this.pointer(input);
      const hit = this.choices?.choiceAtPoint?.(p.x, p.y);
      // confirmAt commits the tapped row and refuses a disabled one — using
      // selectAt + confirm would refuse to move onto a disabled row, then
      // wrongly commit whatever was highlighted before.
      if (hit !== undefined) session.confirmAt(hit);
      // Tap off the list does nothing (keyboard nav still available).
    } else {
      session.advance();
    }
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = undefined;
  }
}

/**
 * The full control set in one binding: keyboard/gamepad (advance / fast-forward
 * hold / choice nav / skip) **and** mouse/touch (tap to advance, tap/hover
 * choices). Pass a scene's choice presenter so the pointer can hit-test rows;
 * `skipHold` (seconds) adds the classic "hold to skip" confirm.
 */
export function dialogueControls(
  choices?: PointerChoiceTarget,
  options: { actions?: DialogueActions; skipHold?: number } = {},
): InputBinding {
  const { actions = FULL_DIALOGUE_ACTIONS, skipHold = 0 } = options;
  return new CompositeInputBinding([
    new KeyboardInputBinding(actions, skipHold),
    new PointerInputBinding(choices),
  ]);
}
