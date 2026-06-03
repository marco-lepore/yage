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
export const FULL_ACTIONS: DialogueActions = {
  ...DEFAULT_ACTIONS,
  skip: ["skip"],
};

export interface InputBinding {
  /** Wire a device to a session. Called by the host once both exist. */
  bind(input: InputManager, session: DialogueSession): void;
  /** Poll the device and drive the session. Called once per frame by the host. */
  poll(): void;
  /**
   * Wire glossary-term hover/tap onto `target` (the text view), surfacing each
   * activation through `onActivate`. The host (`DialogueController`) calls this
   * after {@link bind}, so terms "just work" with any pointer-capable binding.
   * Only pointer bindings act on it (keyboard ignores it); a composite fans it
   * out to its children. This is the single term seam — it gates the line
   * advance (a tap on a term doesn't advance) which a host-side poll cannot.
   */
  setTermSink?(
    target: TermTarget,
    onActivate: (e: TermActivation) => void,
  ): void;
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
 * and renders any tooltip itself. Coords are in `pointerSpace` ("screen"
 * default; a world bubble uses "world").
 */
export interface TermTarget {
  /** Term id under this point, or undefined. Omit for no term hit-testing. */
  termAtPoint?(x: number, y: number): string | undefined;
  readonly pointerSpace?: "screen" | "world";
  /** Highlight the hovered term (or clear it) so it reads as interactable. */
  setHoveredTerm?(id: string | undefined): void;
}

/** A glossary term activation surfaced by a pointer binding to the host. */
export interface TermActivation {
  readonly id: string;
  /** Raw screen-space pointer position (for tooltip placement). */
  readonly screen: { readonly x: number; readonly y: number };
  /** "hover" while the pointer rests over the span; "tap" on a primary click. */
  readonly kind: "hover" | "tap";
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
  setTermSink(
    target: TermTarget,
    onActivate: (e: TermActivation) => void,
  ): void {
    for (const b of this.bindings) b.setTermSink?.(target, onActivate);
  }
  dispose(): void {
    for (const b of this.bindings) b.dispose?.();
  }
}

/** Keyboard/gamepad action-map binding (the default). */
export class KeyboardInputBinding implements InputBinding {
  private input?: InputManager;
  private session?: DialogueSession;
  /** Latch so a held skip fires once per hold, not every frame past threshold. */
  private skipFired = false;

  /**
   * @param skipHoldMs Hold the `skip` action this long before it fires (the
   *   classic "hold to skip" confirm). `0` (default) fires on press.
   */
  constructor(
    private readonly actions: DialogueActions = DEFAULT_ACTIONS,
    private readonly skipHoldMs = 0,
  ) {}

  bind(input: InputManager, session: DialogueSession): void {
    this.input = input;
    this.session = session;
  }

  poll(): void {
    const { input, session } = this;
    if (!input || !session) return;
    session.setFastForward(this.held(this.actions.speed));
    this.pollSkip(session);
    if (this.justPressed(this.actions.advance)) session.advance();
    if (this.justPressed(this.actions.up)) session.moveSelection(-1);
    else if (this.justPressed(this.actions.down)) session.moveSelection(1);
  }

  /** Fire skip once the action has been held `skipHoldMs` (hold-to-confirm),
   *  re-arming only after it's released. */
  private pollSkip(session: DialogueSession): void {
    const skip = this.actions.skip;
    if (!skip) return;
    const ready = skip.some(
      (a) => this.input!.isPressed(a) && this.input!.isHeldFor(a, this.skipHoldMs),
    );
    if (ready) {
      if (!this.skipFired) {
        session.skip();
        this.skipFired = true;
      }
    } else if (!this.held(skip)) {
      this.skipFired = false;
    }
  }

  private justPressed(actions: readonly string[]): boolean {
    return actions.some((a) => this.input!.isJustPressed(a));
  }

  private held(actions: readonly string[]): boolean {
    return actions.some((a) => this.input!.isPressed(a));
  }
}

/**
 * Mouse/touch binding. A tap during a line advances (reveal-all, then next);
 * a tap on a choice row picks it, and hover highlights it — provided a
 * {@link PointerChoiceTarget} is supplied so the binding can hit-test rows.
 * Works for both mouse and touch since it rides the unified pointer stream.
 *
 * Glossary terms are wired separately via {@link setTermSink} (the host does
 * this automatically), so hover over a `[term=id]` span highlights it and a tap
 * activates it — and a tap on a term suppresses the line advance.
 */
export class PointerInputBinding implements InputBinding {
  private input?: InputManager;
  private session?: DialogueSession;
  // Explicit `| undefined` so `dispose()` can null it (exactOptionalPropertyTypes).
  private unsub: (() => void) | undefined;
  /** A primary-button press happened since the last poll (consumed in poll). */
  private clicked = false;

  // Explicit `| undefined` (not `?:`) so the ctor can assign the possibly-
  // undefined argument under `exactOptionalPropertyTypes`.
  private readonly choices: PointerChoiceTarget | undefined;
  /** Term hover/tap target + activation sink, wired by the host (setTermSink). */
  private termTarget: TermTarget | undefined;
  private termActivate: ((e: TermActivation) => void) | undefined;
  /** Last hovered term, so we fire hover once per entry (not every frame). */
  private hoveredTerm: string | undefined;

  constructor(choices?: PointerChoiceTarget) {
    this.choices = choices;
  }

  bind(input: InputManager, session: DialogueSession): void {
    this.input = input;
    this.session = session;
    this.unsub = input.onPointerDown((info) => {
      if (info.button === 0) this.clicked = true; // primary button / touch only
    });
  }

  setTermSink(
    target: TermTarget,
    onActivate: (e: TermActivation) => void,
  ): void {
    this.termTarget = target;
    this.termActivate = onActivate;
  }

  /** Pointer position in the choice presenter's coordinate space. */
  private pointer(): { x: number; y: number } {
    return this.choices?.pointerSpace === "world"
      ? this.input!.getPointerPosition()
      : this.input!.getPointerScreenPosition();
  }

  /** Term id under the pointer right now (in the term target's space), or none. */
  private termAtPointer(): string | undefined {
    const t = this.termTarget;
    if (!t?.termAtPoint) return undefined;
    const p =
      t.pointerSpace === "world"
        ? this.input!.getPointerPosition()
        : this.input!.getPointerScreenPosition();
    return t.termAtPoint(p.x, p.y);
  }

  poll(): void {
    const { input, session } = this;
    if (!input || !session) return;

    // Term hover: highlight the span under the pointer + emit once per entry
    // (independent of choosing/advance). Re-emits on a fresh tap (below).
    if (this.termTarget?.termAtPoint) {
      const id = this.termAtPointer();
      if (id !== this.hoveredTerm) {
        this.hoveredTerm = id;
        this.termTarget.setHoveredTerm?.(id);
        if (id !== undefined) {
          this.termActivate?.({
            id,
            screen: input.getPointerScreenPosition(),
            kind: "hover",
          });
        }
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
      // A tap on a term activates it (tooltip on touch) and does NOT advance.
      const id = this.termAtPointer();
      if (id !== undefined) {
        this.termActivate?.({
          id,
          screen: input.getPointerScreenPosition(),
          kind: "tap",
        });
        return; // a term tap shouldn't also advance the line
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
 * choices). Pass a scene's choice presenter so the pointer can hit-test rows;
 * `skipHoldMs` adds the classic "hold to skip" confirm.
 *
 * Glossary terms need no wiring here — the {@link DialogueController} wires the
 * text view onto the pointer binding via {@link InputBinding.setTermSink} so
 * hover/tap on a `[term=id]` span just works (and a tap won't advance the line).
 */
export function fullControls(
  choices?: PointerChoiceTarget,
  options: { actions?: DialogueActions; skipHoldMs?: number } = {},
): InputBinding {
  const { actions = FULL_ACTIONS, skipHoldMs = 0 } = options;
  return new CompositeInputBinding([
    new KeyboardInputBinding(actions, skipHoldMs),
    new PointerInputBinding(choices),
  ]);
}
