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

export const DEFAULT_ACTIONS: DialogueActions = {
  advance: ["interact"],
  speed: ["attack"],
  up: ["move-up"],
  down: ["move-down"],
};

/** Keyboard actions with skip bound (the game maps `skip` → KeyX in main.ts). */
export const FULL_ACTIONS: DialogueActions = { ...DEFAULT_ACTIONS, skip: ["skip"] };

export interface InputBinding {
  /** Wire a device to a session. Called by the host once both exist. */
  bind(input: InputManager, session: DialogueSession): void;
  /** Poll the device and drive the session. Called once per frame by the host. */
  poll(): void;
  /** Optional teardown (e.g. unsubscribe pointer listeners). */
  dispose?(): void;
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

/**
 * A presenter that can resolve a pointer point to a glossary `[term=id]` span —
 * the term analogue of {@link PointerChoiceTarget}. Lets a pointer binding
 * hover/tap interactable words without owning their geometry. The text view's
 * `DialogueTextView` satisfies this via `termAtPoint`.
 *
 * The system only *emits* the term id (+ the screen position the activation
 * happened at, for tooltip placement); the game owns the id→definition mapping
 * and renders any tooltip itself. Coords are in `termSpace` ("screen" default;
 * a world bubble uses "world").
 */
export interface TermTarget {
  /** Term id under this point, or undefined. Omit for no term hit-testing. */
  termAtPoint?(x: number, y: number): string | undefined;
  readonly termSpace?: "screen" | "world";
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
}

/** Keyboard/gamepad action-map binding (the default). */
export class KeyboardInputBinding implements InputBinding {
  private input?: InputManager;
  private session?: DialogueSession;

  constructor(private readonly actions: DialogueActions = DEFAULT_ACTIONS) {}

  bind(input: InputManager, session: DialogueSession): void {
    this.input = input;
    this.session = session;
  }

  poll(): void {
    const { input, session } = this;
    if (!input || !session) return;
    session.setFastForward(this.held(this.actions.speed));
    if (this.actions.skip && this.justPressed(this.actions.skip)) session.skip();
    if (this.justPressed(this.actions.advance)) session.advance();
    if (this.justPressed(this.actions.up)) session.moveSelection(-1);
    else if (this.justPressed(this.actions.down)) session.moveSelection(1);
  }

  private justPressed(actions: readonly string[]): boolean {
    return actions.some((a) => this.input!.isJustPressed(a));
  }

  private held(actions: readonly string[]): boolean {
    return actions.some((a) => this.input!.isPressed(a));
  }
}

export interface PointerInputBindingOptions {
  /** Choice-row hit-test target (a choice presenter). */
  readonly choices?: PointerChoiceTarget;
  /** Glossary-term hit-test target (the text view). */
  readonly terms?: TermTarget;
  /**
   * Fired when a `[term=id]` span is hovered or tapped. The game owns the
   * id→definition mapping and renders any tooltip; the binding only reports the
   * id and the screen position the pointer was at (for tooltip placement).
   * `screen` is the raw screen-space pointer position regardless of `termSpace`.
   */
  readonly onTermActivate?: (id: string, screen: { x: number; y: number }) => void;
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
  /** A primary-button press happened since the last poll (consumed in poll). */
  private clicked = false;

  // Explicit `| undefined` (not `?:`) so the ctor can assign the possibly-
  // undefined parsed options under `exactOptionalPropertyTypes`.
  private readonly choices: PointerChoiceTarget | undefined;
  private readonly terms: TermTarget | undefined;
  private readonly onTermActivate:
    | ((id: string, screen: { x: number; y: number }) => void)
    | undefined;
  /** Last term emitted as a hover, so we don't refire every frame it sits there. */
  private hoveredTerm: string | undefined;

  /**
   * Accepts either a bare {@link PointerChoiceTarget} (back-compat — choices
   * only) or an options bag with `choices` / `terms` / `onTermActivate`.
   */
  constructor(opts?: PointerChoiceTarget | PointerInputBindingOptions) {
    if (opts && ("choices" in opts || "terms" in opts || "onTermActivate" in opts)) {
      const o = opts as PointerInputBindingOptions;
      this.choices = o.choices;
      this.terms = o.terms;
      this.onTermActivate = o.onTermActivate;
    } else {
      this.choices = opts as PointerChoiceTarget | undefined;
    }
  }

  bind(input: InputManager, session: DialogueSession): void {
    this.input = input;
    this.session = session;
    this.unsub = input.onPointerDown((info) => {
      if (info.button === 0) this.clicked = true; // primary button / touch only
    });
  }

  /** Pointer position in the choice presenter's coordinate space. */
  private pointer(): { x: number; y: number } {
    return this.choices?.pointerSpace === "world"
      ? this.input!.getPointerPosition()
      : this.input!.getPointerScreenPosition();
  }

  /** Pointer position in the term target's coordinate space. */
  private termPointer(): { x: number; y: number } {
    return this.terms?.termSpace === "world"
      ? this.input!.getPointerPosition()
      : this.input!.getPointerScreenPosition();
  }

  poll(): void {
    const { input, session } = this;
    if (!input || !session) return;

    // Term hover: emit once per entry into a span (works outside `choosing`,
    // independent of advance/choices). Re-emits on a fresh tap (see below).
    if (this.terms?.termAtPoint && this.onTermActivate) {
      const tp = this.termPointer();
      const id = this.terms.termAtPoint(tp.x, tp.y);
      if (id !== undefined && id !== this.hoveredTerm) {
        this.hoveredTerm = id;
        this.onTermActivate(id, this.input!.getPointerScreenPosition());
      } else if (id === undefined) {
        this.hoveredTerm = undefined;
      }
    }

    // Hover-highlight the choice under the pointer.
    if (session.isChoosing() && this.choices?.choiceAtPoint) {
      const p = this.pointer();
      const hovered = this.choices.choiceAtPoint(p.x, p.y);
      if (hovered !== undefined) session.selectAt(hovered);
    }

    const clicked = this.clicked;
    this.clicked = false;
    if (!clicked) return;
    if (session.isChoosing()) {
      const p = this.pointer();
      const hit = this.choices?.choiceAtPoint?.(p.x, p.y);
      if (hit !== undefined) {
        session.selectAt(hit);
        session.confirm();
      }
      // Tap off the list does nothing (keyboard nav still available).
    } else {
      // A tap on a term activates it (tooltip on touch), independent of advance.
      if (this.terms?.termAtPoint && this.onTermActivate) {
        const tp = this.termPointer();
        const id = this.terms.termAtPoint(tp.x, tp.y);
        if (id !== undefined) {
          this.onTermActivate(id, this.input!.getPointerScreenPosition());
          return; // a term tap shouldn't also advance the line
        }
      }
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
 * choices, hover/tap glossary terms). Pass a scene's choice presenter so the
 * pointer can hit-test rows, and optionally a {@link TermTarget} +
 * `onTermActivate` so interactable `[term=id]` words emit their id.
 *
 * Accepts either a bare {@link PointerChoiceTarget} (back-compat — choices
 * only) or a {@link PointerInputBindingOptions} bag to add term wiring.
 */
export function fullControls(
  pointer?: PointerChoiceTarget | PointerInputBindingOptions,
  actions: DialogueActions = FULL_ACTIONS,
): InputBinding {
  return new CompositeInputBinding([
    new KeyboardInputBinding(actions),
    new PointerInputBinding(pointer),
  ]);
}
