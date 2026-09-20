import { devWarn } from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";
import type { Node as YogaNode } from "yoga-layout";
import { clearConsumeInput, createPointerBlocker } from "../consume-input.js";
import { runUICallback } from "../error-boundary.js";
import type { Rect } from "../positioning.js";
import type {
  FocusDirection,
  PointerFocusMode,
  UIContainerElement,
  UIElement,
  UIFocusInputOptions,
  UIFocusScopeOptions,
  UIScrollIntoViewOptions,
} from "../types.js";
import { readElementRect } from "./element-rect.js";
import { getFocusState } from "./FocusState.js";
import type { FocusState } from "./FocusState.js";
import { pickNeighbor } from "./focus-nav.js";
import { takePointerRequest } from "./pointer-request.js";
import type { PointerFocusTrigger } from "./pointer-request.js";
import { asScrollView } from "./scroll-registry.js";
import type { FocusScrollView } from "./scroll-registry.js";
import { capturedInput } from "./input-capture.js";
import type { UIInputCaptureElement } from "./input-capture.js";

/** What a scope is measured and searched against. */
export interface UIFocusScopeHost {
  /** The space candidate rectangles are read in. */
  readonly displayObject: DisplayContainer;
  /** The elements the candidate walk starts from, in tree order. */
  roots(): readonly UIElement[];
}

/**
 * The slice of an input manager a scope reads. Structural, so `@yagejs/ui`
 * names no type from the optional peer `@yagejs/input`.
 */
export interface UIFocusInputSource {
  isPressed(action: string): boolean;
  isJustPressed(
    action: string,
    options?: {
      repeat?: boolean;
      repeatDelay?: number;
      repeatInterval?: number;
    },
  ): boolean;
  /**
   * Whether the player let go of the action, as opposed to the engine
   * dropping the hold (window blur, disabled action group). A confirm press
   * runs its element's action only on this.
   */
  isJustReleasedByPlayer(action: string): boolean;
  hasAction(name: string): boolean;
}

/** The six roles a scope polls, in the order a tick resolves them. */
const ROLES = ["up", "down", "left", "right", "confirm", "cancel"] as const;

type FocusRole = (typeof ROLES)[number];

/** The four roles that move focus, resolved in this order — one per tick. */
const DIRECTIONS: readonly FocusDirection[] = ["up", "down", "left", "right"];

/** Action name per role when the game renames none of them. */
const DEFAULT_ACTIONS: Record<FocusRole, string> = {
  up: "move-up",
  down: "move-down",
  left: "move-left",
  right: "move-right",
  confirm: "interact",
  cancel: "cancel",
};

const DEFAULT_SCROLL_PADDING = 8;

interface RepeatQuery {
  repeat: true;
  repeatDelay?: number;
  repeatInterval?: number;
}

interface ResolvedInput {
  readonly names: Record<FocusRole, readonly string[]>;
  readonly repeat: RepeatQuery | undefined;
}

/** One element the scope can move focus to, and where it sits in the tree. */
interface Candidate {
  element: UIElement;
  state: FocusState;
  id: string | undefined;
  /** Scroll views enclosing the element, innermost first. */
  readonly scrollViews: FocusScrollView[];
}

/**
 * Every scope by the container it is hosted on. The candidate walk stops at
 * one, and a pointer request finds the scope whose subtree it landed in.
 */
const scopeHosts = new WeakMap<DisplayContainer, UIFocusScope>();

/** The innermost scope whose host container `element` hangs under. */
function scopeOf(element: UIElement): UIFocusScope | undefined {
  let container: DisplayContainer | null = element.displayObject;
  while (container !== null) {
    const scope = scopeHosts.get(container);
    if (scope !== undefined) return scope;
    container = container.parent;
  }
  return undefined;
}

function emptyRect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Whether this container narrows the hit test of everything beneath it. Pixi
 * asks a container's mask before any child (`EventBoundary.hitPruneFn`), so a
 * masked container is hittable only where it draws.
 */
function clipsHitTest(container: DisplayContainer): boolean {
  const mask = container.mask;
  return mask !== undefined && mask !== null;
}

/** Where a pointer blocker hangs: inside `parent`, directly under `below`. */
interface BlockerSeat {
  readonly parent: DisplayContainer;
  /** The child it goes under, or `null` for the bottom of `parent` itself. */
  readonly below: DisplayContainer | null;
}

function childrenOf(element: UIElement): readonly UIElement[] | undefined {
  return (element as Partial<UIContainerElement>).children;
}

/** Whether a layout pass has given the element a size to search against. */
function isLaidOut(element: UIElement): boolean {
  return (
    Number.isFinite(element.yogaNode.getComputedWidth()) &&
    Number.isFinite(element.yogaNode.getComputedHeight())
  );
}

function namesFor(
  role: FocusRole,
  option: string | readonly string[] | undefined,
): readonly string[] {
  if (option === undefined) return [DEFAULT_ACTIONS[role]];
  return typeof option === "string" ? [option] : option;
}

function resolveInput(
  option: UIFocusInputOptions | null | undefined,
): ResolvedInput | null {
  if (option === null) return null;
  const names = {} as Record<FocusRole, readonly string[]>;
  for (const role of ROLES) names[role] = namesFor(role, option?.[role]);
  return { names, repeat: resolveRepeat(option?.repeat) };
}

function resolveRepeat(
  option: UIFocusInputOptions["repeat"],
): RepeatQuery | undefined {
  if (option === false) return undefined;
  if (option === undefined || option === true) return { repeat: true };
  const query: RepeatQuery = { repeat: true };
  if (option.delay !== undefined) query.repeatDelay = option.delay;
  if (option.interval !== undefined) query.repeatInterval = option.interval;
  return query;
}

function assertRepeatTiming(
  context: string,
  option: UIFocusInputOptions["repeat"],
): void {
  if (option === undefined || typeof option === "boolean") return;
  const { delay, interval } = option;
  if (delay !== undefined && (!Number.isFinite(delay) || delay < 0)) {
    throw new Error(
      `${context}: input.repeat.delay must be a finite number of seconds ` +
        `at or above 0, got ${delay}.`,
    );
  }
  if (interval !== undefined && (!Number.isFinite(interval) || interval <= 0)) {
    throw new Error(
      `${context}: input.repeat.interval must be a finite number of ` +
        `seconds above 0, got ${interval}.`,
    );
  }
}

function isViewportNode(
  node: YogaNode,
  views: readonly FocusScrollView[],
): boolean {
  for (const view of views) {
    if (view.yogaNode === node) return true;
  }
  return false;
}

/**
 * Write into `out` what a scroll follow depends on: the position of every box
 * between `element` and the outermost scroll view, plus the size of the
 * element and of each viewport.
 *
 * The content panel's size is left out: a row added or removed below the
 * focused one changes it without moving the focused row. Yoga carries no
 * scroll offset, so the reading stays still while the player scrolls by hand.
 */
function readFollowGeometry(
  element: UIElement,
  views: readonly FocusScrollView[],
  out: number[],
): void {
  out.length = 0;
  const outermost = views[views.length - 1];
  if (outermost === undefined) return;
  const stop = outermost.yogaNode.getParent();
  const self = element.yogaNode;
  let node: YogaNode | null = self;
  while (node !== null && node !== stop) {
    out.push(node.getComputedLeft(), node.getComputedTop());
    if (node === self || isViewportNode(node, views)) {
      out.push(node.getComputedWidth(), node.getComputedHeight());
    }
    node = node.getParent();
  }
}

function sameGeometry(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    // `Object.is`, so a box that is still NaN reads as unchanged.
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

function assertScrollPadding(context: string, padding: number): void {
  if (!Number.isFinite(padding) || padding < 0) {
    throw new Error(
      `${context}: scrollPadding must be a finite number of pixels at or ` +
        `above 0, got ${padding}.`,
    );
  }
}

/**
 * Keyboard and gamepad focus over one subtree.
 *
 * A game reaches its scope through `surface.focusScope`, `panel.focusScope`
 * or `root.focusScope` and never builds one. Every method works with no
 * engine attached, so a cutscene script or a unit test can drive it.
 *
 * The scope reading input owns the pointer too: everything drawn under it
 * stops answering the mouse, so a dialog cannot be clicked through.
 * `modal: false` leaves the pointer to whatever is behind.
 */
export class UIFocusScope {
  private readonly host: UIFocusScopeHost;

  private _wrap = true;
  private _autoFocus = true;
  private _pointerFocus: PointerFocusMode = "press";
  private _modal = true;
  private _blocker: DisplayContainer | null = null;
  private _roles: ResolvedInput | null = resolveInput(undefined);
  private readonly _followOptions: UIScrollIntoViewOptions = {
    padding: DEFAULT_SCROLL_PADDING,
  };
  private _onFocusMove:
    | ((element: UIElement | null, previous: UIElement | null) => void)
    | undefined;
  private _onActivate: ((element: UIElement) => void) | undefined;
  private _onMoveBlocked: ((direction: FocusDirection) => void) | undefined;
  private _onCancel: (() => void) | undefined;

  private _focused: UIElement | null = null;
  private _pressed: UIElement | null = null;
  /** The action name whose hold the confirm press follows. */
  private _pressName = "";
  /** Tree index the focused element had, so a lost row resumes beside it. */
  private _focusedIndex = -1;
  /** Tree index a torn-down element held, or `-1` when nothing is owed. */
  private _lostIndex = -1;
  /** Set by `focus(null)`, so a menu the game unlit stays unlit. */
  private _clearedByGame = false;
  private _hasInput = false;

  // Rebuilt from the live tree on every read, reusing its entries. Not cached:
  // `visible` and `setDisabled` are plain setters that nothing observes.
  private readonly _candidates: Candidate[] = [];
  private _count = 0;
  private readonly _scrollStack: FocusScrollView[] = [];
  private _capture: UIInputCaptureElement | null = null;
  private _wasCapturing = false;
  private readonly _seenIds = new Set<string>();

  // The boxes the last scroll follow read, and this frame's reading of them.
  private readonly _followedGeometry: number[] = [];
  private readonly _currentGeometry: number[] = [];

  private readonly _rectPool: Rect[] = [];
  private readonly _moveRects: Rect[] = [];
  private readonly _rectOf: number[] = [];
  private readonly _viewRects = new Map<FocusScrollView, Rect | null>();

  /** Names held down when this scope took input, skipped until released. */
  private readonly _latched = new Set<string>();

  private readonly _warnedRoles = new Set<FocusRole>();
  private readonly _warnedIds = new Set<string>();
  private _refusedFocusWarned = false;

  /** @internal */
  constructor(host: UIFocusScopeHost, options: UIFocusScopeOptions) {
    this.host = host;
    this._apply("UIFocusScope", options, true);
    scopeHosts.set(host.displayObject, this);
  }

  /**
   * The element this scope remembers. It is painted and acted on only while
   * {@link hasInput} is true.
   */
  get focused(): UIElement | null {
    return this._focused;
  }

  /** Whether this scope is the one reading input right now. */
  get hasInput(): boolean {
    return this._hasInput;
  }

  /** Every element focus can reach right now, in tree order. */
  get candidates(): readonly UIElement[] {
    this._collect();
    const elements: UIElement[] = [];
    for (let i = 0; i < this._count; i += 1) {
      elements.push(this._candidates[i]!.element);
    }
    return elements;
  }

  /**
   * Move focus to one element of this scope, reporting whether it landed.
   * `null` clears focus. A hidden, disabled or non-focusable element returns
   * `false` with a development warning.
   *
   * @throws when `element` is not inside this scope.
   */
  focus(element: UIElement | null): boolean {
    if (element === null) {
      this._commitFocus(null, -1);
      this._clearedByGame = true;
      return true;
    }
    if (!this._contains(element)) {
      throw new Error(
        "UIFocusScope.focus: the element must be inside this scope, got " +
          `${element.constructor.name}.`,
      );
    }
    this._collect();
    const index = this._indexOf(element);
    if (index === -1) {
      if (!this._refusedFocusWarned) {
        this._refusedFocusWarned = true;
        devWarn(
          "UIFocusScope.focus: the element is hidden, disabled or not " +
            "focusable, so focus stayed where it was.",
        );
      }
      return false;
    }
    this._commitFocus(element, index);
    return true;
  }

  /**
   * Move focus one step, reporting whether the press did anything: focus
   * changed, or the focused element consumed the step as an adjustment.
   *
   * While an element under this scope holds its input, the step goes to that
   * element, focus stays, and the result is `true`.
   */
  move(direction: FocusDirection): boolean {
    this._collect();
    this._validate();
    const capture = this._capture;
    if (capture !== null) {
      capture.moveCapture?.(direction);
      return true;
    }
    return this._move(direction);
  }

  /**
   * Run the focused element's own action (the one a click runs), then
   * `onActivate`. A disabled or unfocused scope does nothing. While an
   * element under this scope holds its input, this confirms that element.
   * Paints no pressed look; that belongs to a held confirm action.
   */
  activate(): void {
    this._collect();
    const capture = this._capture;
    if (capture !== null) {
      capture.confirmCapture();
      return;
    }
    this._activate(this._focused);
  }

  /**
   * Run `onCancel`. While an element under this scope holds its input, this
   * cancels that element and `onCancel` does not run.
   */
  cancel(): void {
    this._collect();
    const capture = this._capture;
    if (capture !== null) {
      capture.cancelCapture();
      return;
    }
    const onCancel = this._onCancel;
    if (onCancel === undefined) return;
    runUICallback(this.host.displayObject, "UI onCancel", onCancel);
  }

  /**
   * Replace the options this scope was built with, key by key. A key the
   * caller left out keeps its value.
   */
  setOptions(options: UIFocusScopeOptions): void {
    this._apply("UIFocusScope.setOptions", options, false);
  }

  /**
   * Take `options` as the whole declaration: a key left out goes back to its
   * default, so a callback a React render stopped passing is dropped.
   * @internal
   */
  _replaceOptions(options: UIFocusScopeOptions): void {
    this._apply("UIFocusScope", options, true);
  }

  /** Leave every element and stop reading input. @internal */
  _destroy(): void {
    this._releaseInput();
    if (this._focused !== null) getFocusState(this._focused)?._setScope(null);
    this._focused = null;
    this._focusedIndex = -1;
    this._count = 0;
    this._candidates.length = 0;
    const blocker = this._blocker;
    if (blocker !== null) {
      this._blocker = null;
      clearConsumeInput(blocker);
      blocker.destroy();
    }
    scopeHosts.delete(this.host.displayObject);
  }

  /**
   * Drop a focused element that is being torn down, with no callback and no
   * repaint: painting here reaches a freed Yoga node. The tree index is kept
   * so the next validation lands beside it.
   * @internal
   */
  _clearFocusedOnDestroy(element: UIElement): void {
    if (this._focused !== element) return;
    this._focused = null;
    this._lostIndex = this._focusedIndex;
  }

  /**
   * Whether this scope's host and all its ancestors are visible. Hiding a
   * surface, disabling its component and deactivating its entity all write
   * that flag.
   * @internal
   */
  _isShown(): boolean {
    let container: DisplayContainer | null = this.host.displayObject;
    while (container !== null) {
      if (!container.visible) return false;
      container = container.parent;
    }
    return true;
  }

  /** Whether `scope` sits inside this one's subtree. @internal */
  _containsScope(scope: UIFocusScope): boolean {
    const root = this.host.displayObject;
    // From the parent up: a scope does not contain itself.
    let container: DisplayContainer | null = scope.host.displayObject.parent;
    while (container !== null) {
      if (container === root) return true;
      container = container.parent;
    }
    return false;
  }

  /** Whether this scope reads a device at all. @internal */
  get _pollsDevice(): boolean {
    return this._roles !== null;
  }

  /** Start reading input: latch held names, light an element. @internal */
  _takeInput(input: UIFocusInputSource | null): void {
    if (this._hasInput) return;
    this._hasInput = true;
    this._syncBlocker();
    this._collect();
    this._validate();
    this._arm(input);
    this._wasCapturing = this._capture !== null;
    const focused = this._focused;
    if (focused !== null) {
      getFocusState(focused)?._setFocused(true);
      this._followScroll(focused, this._focusedIndex);
      return;
    }
    this._autoFocusFirst();
  }

  /** Stop reading input, keeping the remembered element. @internal */
  _releaseInput(): void {
    if (!this._hasInput) return;
    this._hasInput = false;
    this._syncBlocker();
    this._latched.clear();
    // One walk on the way out, because the element holding this scope's
    // input may have taken it since the last tick.
    this._collect();
    // This scope will never see the release that ends a held press, so the
    // press ends here without running its action.
    this._cancelPress();
    this._releaseCapture(this._capture);
    if (this._focused !== null)
      getFocusState(this._focused)?._setFocused(false);
  }

  /** One frame of this scope: validate, pointer, poll. @internal */
  _tick(input: UIFocusInputSource | null): void {
    // Read the seat again: the host may have started clipping or moved.
    this._syncBlocker();
    this._collect();
    this._validate();
    this._autoFocusFirst();
    this._followChangedGeometry();
    const capturing = this._capture !== null;
    // Taking the input back re-latches, so the key that ended an edit or
    // closed a list does not also move focus.
    if (this._wasCapturing && !capturing) this._arm(input);
    this._wasCapturing = capturing;
    this._consumePointerFocus();
    const roles = this._roles;
    if (input !== null && roles !== null) this._poll(input, roles);
  }

  // -- Options --------------------------------------------------------------

  private _apply(
    context: string,
    options: UIFocusScopeOptions,
    replace: boolean,
  ): void {
    const has = (key: keyof UIFocusScopeOptions): boolean =>
      replace || key in options;
    // Validate everything before writing anything, so a bad number leaves the
    // scope on the options it was working with.
    const padding = options.scrollPadding ?? DEFAULT_SCROLL_PADDING;
    if (has("scrollPadding")) assertScrollPadding(context, padding);
    if (has("input")) assertRepeatTiming(context, options.input?.repeat);

    if (has("scrollPadding")) this._followOptions.padding = padding;
    if (has("input")) {
      this._roles = resolveInput(options.input);
      this._warnedRoles.clear();
    }
    if (has("wrap")) this._wrap = options.wrap ?? true;
    if (has("autoFocus")) this._autoFocus = options.autoFocus ?? true;
    if (has("pointerFocus"))
      this._pointerFocus = options.pointerFocus ?? "press";
    if (has("modal")) {
      this._modal = options.modal ?? true;
      this._syncBlocker();
    }
    if (has("onFocusMove")) this._onFocusMove = options.onFocusMove;
    if (has("onActivate")) this._onActivate = options.onActivate;
    if (has("onMoveBlocked")) this._onMoveBlocked = options.onMoveBlocked;
    if (has("onCancel")) this._onCancel = options.onCancel;
  }

  // -- Pointer ownership ----------------------------------------------------

  /**
   * Seat or remove the pointer blocker: a modal scope reading input swallows
   * the pointer everywhere around itself. The blocker sits directly under
   * what the scope draws, so the scope's own rows still answer the pointer.
   */
  private _syncBlocker(): void {
    if (!this._modal || !this._hasInput) {
      this._blocker?.removeFromParent();
      return;
    }
    const blocker = this._blocker ?? createPointerBlocker();
    this._blocker = blocker;
    const { parent, below } = this._blockerSeat();
    const children = parent.children;
    const seated =
      below === null
        ? children[0] === blocker
        : children[children.indexOf(below) - 1] === blocker;
    if (seated) return;
    // Remove first, so the index below is read without the blocker in it.
    blocker.removeFromParent();
    parent.addChildAt(
      blocker,
      below === null ? 0 : parent.children.indexOf(below),
    );
  }

  /**
   * Where the blocker hangs: the bottom of the host, or directly under the
   * host in its parent when the host clips its own hit test.
   *
   * A clip on the host prunes a blocker inside it everywhere outside the
   * clip, which is the area the blocker exists to cover. A host that clips
   * nothing keeps the blocker inside, so hiding or destroying the host takes
   * the blocker with it. Seated beside the host, the blocker relies on the
   * stack releasing a hidden scope and on `_destroy`.
   */
  private _blockerSeat(): BlockerSeat {
    const host = this.host.displayObject;
    const parent: DisplayContainer | null = host.parent;
    if (parent !== null && clipsHitTest(host)) return { parent, below: host };
    return { parent: host, below: null };
  }

  // -- Candidates -----------------------------------------------------------

  private _collect(): void {
    this._count = 0;
    this._capture = null;
    this._scrollStack.length = 0;
    this._seenIds.clear();
    this._walk(this.host.roots());
    // Truncate to the live count: a stale entry would keep a dropped
    // element's container and Yoga node reachable.
    this._candidates.length = this._count;
  }

  private _walk(elements: readonly UIElement[]): void {
    for (const element of elements) {
      const container = element.displayObject;
      if (!container.visible) continue;
      // An element owning its own scope takes its whole subtree with it.
      if (scopeHosts.has(container)) continue;
      const capture = capturedInput(element);
      if (capture !== undefined) this._capture = capture;
      const state = getFocusState(element);
      if (
        state !== undefined &&
        state.focusable &&
        !state.disabled &&
        isLaidOut(element)
      ) {
        this._push(element, state);
      }
      const children = childrenOf(element);
      if (children === undefined) continue;
      const view = asScrollView(element);
      if (view !== undefined) this._scrollStack.push(view);
      this._walk(children);
      if (view !== undefined) this._scrollStack.pop();
    }
  }

  private _push(element: UIElement, state: FocusState): void {
    const id = state.id;
    if (id !== undefined) {
      if (this._seenIds.has(id) && !this._warnedIds.has(id)) {
        this._warnedIds.add(id);
        devWarn(
          `UIFocusScope: two elements in one scope answer to focusId "${id}"; ` +
            "the first in tree order is the one a neighbour reaches.",
        );
      }
      this._seenIds.add(id);
    }
    let entry = this._candidates[this._count];
    if (entry === undefined) {
      entry = { element, state, id, scrollViews: [] };
      this._candidates.push(entry);
    } else {
      entry.element = element;
      entry.state = state;
      entry.id = id;
      entry.scrollViews.length = 0;
    }
    // The walk stacks views outermost first; a candidate wants innermost
    // first, because an inner list has to scroll before the outer measures.
    for (let i = this._scrollStack.length - 1; i >= 0; i -= 1) {
      entry.scrollViews.push(this._scrollStack[i]!);
    }
    this._count += 1;
  }

  private _indexOf(element: UIElement): number {
    for (let i = 0; i < this._count; i += 1) {
      if (this._candidates[i]!.element === element) return i;
    }
    return -1;
  }

  private _indexOfId(id: string): number {
    for (let i = 0; i < this._count; i += 1) {
      if (this._candidates[i]!.id === id) return i;
    }
    return -1;
  }

  private _contains(element: UIElement): boolean {
    const root = this.host.displayObject;
    let container: DisplayContainer | null = element.displayObject;
    while (container !== null) {
      if (container === root) return true;
      container = container.parent;
    }
    return false;
  }

  /**
   * Drop a focused element that is gone, hidden or disabled, and land on the
   * candidate that took its place in tree order, or the last one.
   */
  private _validate(): void {
    // An element that took the input without focus following (a field clicked
    // under `pointerFocus: "none"`) takes focus with it.
    const capture = this._capture;
    if (capture !== null && capture !== this._focused) {
      const index = this._indexOf(capture);
      if (index !== -1) {
        this._commitFocus(capture, index);
        return;
      }
    }
    const focused = this._focused;
    if (focused === null) {
      this._resumeAfterDestroy();
      return;
    }
    const index = this._indexOf(focused);
    if (index !== -1) {
      this._focusedIndex = index;
      return;
    }
    if (this._count === 0) {
      this._commitFocus(null, -1);
      return;
    }
    const next = Math.max(0, Math.min(this._focusedIndex, this._count - 1));
    this._commitFocus(this._candidates[next]!.element, next);
  }

  /**
   * Land beside an element torn down while it held focus. An empty list
   * keeps the index owed, so a list that repopulates resumes at it.
   */
  private _resumeAfterDestroy(): void {
    const lost = this._lostIndex;
    if (lost === -1 || this._count === 0) return;
    const next = Math.max(0, Math.min(lost, this._count - 1));
    this._commitFocus(this._candidates[next]!.element, next);
  }

  /**
   * Light the first candidate for a scope holding input with nothing focused,
   * on any tick. Skipped after the game cleared focus with `focus(null)`.
   */
  private _autoFocusFirst(): void {
    if (!this._autoFocus || this._clearedByGame) return;
    if (this._focused !== null || this._count === 0) return;
    this._commitFocus(this._candidates[0]!.element, 0);
  }

  // -- Movement -------------------------------------------------------------

  private _move(direction: FocusDirection): boolean {
    const focused = this._focused;
    if (focused === null) {
      if (this._count === 0) {
        this._blocked(direction);
        return false;
      }
      this._commitFocus(this._candidates[0]!.element, 0);
      return true;
    }

    const state = getFocusState(focused);
    const neighbor = state?.neighbors?.[direction];
    if (neighbor === null) {
      this._blocked(direction);
      return false;
    }
    if (neighbor !== undefined) {
      const named = this._indexOfId(neighbor);
      if (named !== -1) {
        this._commitFocus(this._candidates[named]!.element, named);
        return true;
      }
    }
    if (state !== undefined && state._adjust(direction)) return true;

    const from = this._measure(this._focusedIndex);
    const to = pickNeighbor(this._moveRects, from, direction, this._wrap);
    if (to === -1) {
      this._blocked(direction);
      return false;
    }
    const index = this._rectOf[to]!;
    this._commitFocus(this._candidates[index]!.element, index);
    return true;
  }

  /**
   * Fill `_moveRects` with the candidate boxes in the host's space and return
   * the focused element's index into it.
   *
   * A candidate inside a scroll view is clipped to the viewport and drops out
   * when nothing is left, so a move lands on a visible row. Candidates
   * sharing the focused element's innermost view keep their full box, which
   * keeps the next row below the fold reachable.
   */
  private _measure(focusedIndex: number): number {
    this._moveRects.length = 0;
    this._rectOf.length = 0;
    this._viewRects.clear();
    const focusedView =
      focusedIndex === -1
        ? undefined
        : this._candidates[focusedIndex]?.scrollViews[0];
    let from = -1;
    for (let i = 0; i < this._count; i += 1) {
      const candidate = this._candidates[i]!;
      const rect = this._rectAt(this._moveRects.length);
      if (!readElementRect(this.host.displayObject, candidate.element, rect)) {
        continue;
      }
      const shares =
        focusedView !== undefined && candidate.scrollViews[0] === focusedView;
      if (!shares && !this._clamp(candidate.scrollViews, rect)) continue;
      if (i === focusedIndex) from = this._moveRects.length;
      this._rectOf.push(i);
      this._moveRects.push(rect);
    }
    return from;
  }

  private _rectAt(index: number): Rect {
    let rect = this._rectPool[index];
    if (rect === undefined) {
      rect = emptyRect();
      this._rectPool.push(rect);
    }
    return rect;
  }

  /** Intersect `rect` with every enclosing viewport; `false` when nothing is left. */
  private _clamp(views: readonly FocusScrollView[], rect: Rect): boolean {
    for (const view of views) {
      const viewport = this._viewRect(view);
      if (viewport === null) continue;
      const left = Math.max(rect.x, viewport.x);
      const top = Math.max(rect.y, viewport.y);
      const right = Math.min(rect.x + rect.width, viewport.x + viewport.width);
      const bottom = Math.min(
        rect.y + rect.height,
        viewport.y + viewport.height,
      );
      if (right <= left || bottom <= top) return false;
      rect.x = left;
      rect.y = top;
      rect.width = right - left;
      rect.height = bottom - top;
    }
    return true;
  }

  private _viewRect(view: FocusScrollView): Rect | null {
    const cached = this._viewRects.get(view);
    if (cached !== undefined) return cached;
    const rect = emptyRect();
    const read = readElementRect(this.host.displayObject, view, rect)
      ? rect
      : null;
    this._viewRects.set(view, read);
    return read;
  }

  private _commitFocus(next: UIElement | null, index: number): void {
    const previous = this._focused;
    this._focusedIndex = index;
    this._lostIndex = -1;
    if (next !== null) this._clearedByGame = false;
    if (next === previous) return;
    // A confirm press belongs to the element it started on, so focus leaving
    // it ends the press and runs nothing.
    this._cancelPress();
    // Commit the field before painting and before any game callback, so a
    // throwing handler cannot leave `focused` and the painted element apart.
    this._focused = next;
    // Focus moving away hands the element's keys back: an open list closes
    // and a field gives back the caret.
    this._releaseCapture(previous);
    const previousState =
      previous === null ? undefined : getFocusState(previous);
    previousState?._setScope(null);
    const nextState = next === null ? undefined : getFocusState(next);
    nextState?._setScope(this);
    if (next !== null) this._followScroll(next, index);
    if (this._hasInput) {
      previousState?._setFocused(false);
      nextState?._setFocused(true);
    }
    const onFocusMove = this._onFocusMove;
    if (onFocusMove !== undefined) {
      runUICallback(this.host.displayObject, "UI onFocusMove", () =>
        onFocusMove(next, previous),
      );
    }
  }

  private _blocked(direction: FocusDirection): void {
    const onMoveBlocked = this._onMoveBlocked;
    if (onMoveBlocked === undefined) return;
    runUICallback(this.host.displayObject, "UI onMoveBlocked", () =>
      onMoveBlocked(direction),
    );
  }

  private _activate(element: UIElement | null): void {
    if (element === null) return;
    const state = getFocusState(element);
    if (state === undefined || state.disabled) return;
    state.behavior.activate?.();
    const onActivate = this._onActivate;
    if (onActivate === undefined) return;
    runUICallback(this.host.displayObject, "UI onActivate", () =>
      onActivate(element),
    );
  }

  /**
   * Bring the focused element inside every viewport around it, innermost
   * first. Runs where focus lands and where the followed boxes moved. A plain
   * tick runs nothing, so a list the player scrolls keeps its offset.
   */
  private _followScroll(element: UIElement, index: number): void {
    const candidate = this._candidates[index];
    if (candidate === undefined || candidate.element !== element) return;
    readFollowGeometry(element, candidate.scrollViews, this._followedGeometry);
    for (const view of candidate.scrollViews) {
      view.scrollIntoView(element, this._followOptions);
    }
  }

  /** Follow again when {@link readFollowGeometry} reads a change. */
  private _followChangedGeometry(): void {
    const element = this._focused;
    if (element === null) return;
    const candidate = this._candidates[this._focusedIndex];
    if (candidate === undefined || candidate.element !== element) return;
    if (candidate.scrollViews.length === 0) return;
    readFollowGeometry(element, candidate.scrollViews, this._currentGeometry);
    if (sameGeometry(this._currentGeometry, this._followedGeometry)) return;
    this._followScroll(element, this._focusedIndex);
  }

  // -- Input ----------------------------------------------------------------

  /**
   * Hand this tick's pointer request to the scope whose subtree the element
   * sits in. That is not always this one: only the driven scope ticks.
   *
   * A modal scope reading input drops a request from outside its subtree.
   * Pixi bubbles an event from the blocker up through the scope's ancestors,
   * and a focusable panel among them would read it as a press on itself.
   */
  private _consumePointerFocus(): void {
    const request = takePointerRequest();
    if (request === null) return;
    if (this._modal && this._hasInput && !this._contains(request.element)) {
      return;
    }
    scopeOf(request.element)?._focusFromPointer(
      request.element,
      request.trigger,
    );
  }

  /**
   * Move focus to an element the pointer reached, where `pointerFocus` acts
   * on that trigger. A scope not reading input remembers the element and
   * paints nothing.
   */
  private _focusFromPointer(
    element: UIElement,
    trigger: PointerFocusTrigger,
  ): void {
    const mode = this._pointerFocus;
    if (mode === "none") return;
    if (mode === "press" && trigger !== "press") return;
    this._collect();
    const index = this._indexOf(element);
    if (index === -1) return;
    this._commitFocus(element, index);
  }

  /**
   * Latch every name already held, and warn about a role no mapped action
   * answers to. Runs on every transition into reading input, so a direction
   * held while a submenu closes does not move the parent menu.
   */
  private _arm(input: UIFocusInputSource | null): void {
    this._latched.clear();
    const roles = this._roles;
    if (input === null || roles === null) return;
    for (const role of ROLES) {
      const names = roles.names[role];
      let mapped = false;
      for (const name of names) {
        if (input.hasAction(name)) mapped = true;
        // Both reads: a press and a release drained in the same frame leave
        // `isPressed` false while `isJustPressed` is true, and that is
        // precisely the press that opened the menu.
        if (input.isPressed(name) || input.isJustPressed(name)) {
          this._latched.add(name);
        }
      }
      if (mapped || this._warnedRoles.has(role)) continue;
      this._warnedRoles.add(role);
      const listed = names.map((name) => `"${name}"`).join(" or ");
      devWarn(
        `UIFocusScope: no action named ${listed} is mapped, so the ${role} ` +
          `role does nothing. Rename it with focus.input.${role}.`,
      );
    }
  }

  private _poll(input: UIFocusInputSource, roles: ResolvedInput): void {
    this._unlatch(input);
    // A held confirm press owns every tick until its release, so it neither
    // runs its action twice nor moves the menu.
    if (this._pressed !== null) {
      this._resolvePress(input);
      return;
    }
    const capture = this._capture;
    if (capture !== null) {
      this._pollCapture(input, roles, capture);
      return;
    }
    // Confirm aims at the element focused when the tick began, so a repeat
    // edge and a confirm edge in one frame cannot press the row the repeat
    // just moved to.
    const target = this._focused;
    for (const direction of DIRECTIONS) {
      if (!this._edge(input, roles.names[direction], roles.repeat)) continue;
      this._move(direction);
      break;
    }
    const confirm = this._edgeName(input, roles.names.confirm, undefined);
    if (confirm !== undefined) {
      this._beginPress(target, confirm);
      // A press and its release inside one query window is the whole
      // press, so it resolves in this tick.
      if (this._pressed !== null) this._resolvePress(input);
      return;
    }
    if (this._edge(input, roles.names.cancel, undefined)) this.cancel();
  }

  /**
   * One frame of a scope whose input an element holds: every role goes to
   * that element, and at most one press is resolved.
   *
   * Confirm and cancel come before the directions, so a direction key held
   * while typing cannot swallow them. Confirm acts on the edge and paints no
   * press.
   */
  private _pollCapture(
    input: UIFocusInputSource,
    roles: ResolvedInput,
    capture: UIInputCaptureElement,
  ): void {
    if (this._edge(input, roles.names.confirm, undefined)) {
      capture.confirmCapture();
      return;
    }
    if (this._edge(input, roles.names.cancel, undefined)) {
      capture.cancelCapture();
      return;
    }
    for (const direction of DIRECTIONS) {
      if (!this._edge(input, roles.names[direction], roles.repeat)) continue;
      capture.moveCapture?.(direction);
      return;
    }
  }

  /**
   * Take the input back from `element` if it still holds it. Read from the
   * live record, so an element that already gave the input back is not asked
   * to end again.
   */
  private _releaseCapture(element: UIElement | null): void {
    if (element === null) return;
    capturedInput(element)?.releaseCapture();
  }

  /**
   * Take a confirm press onto `element` and paint it. Only the element that
   * still holds focus takes it, so a direction resolved earlier in the tick
   * drops the confirm.
   */
  private _beginPress(element: UIElement | null, name: string): void {
    if (element === null || element !== this._focused) return;
    const state = getFocusState(element);
    if (state === undefined || state.disabled) return;
    this._pressed = element;
    this._pressName = name;
    state.behavior.setPressed?.(true);
  }

  /**
   * Keep a press while the player holds the action, and run the element's
   * action on a release the player made. A hold the engine dropped (window
   * blur, disabled action group) drops the press and runs nothing.
   */
  private _resolvePress(input: UIFocusInputSource): void {
    const name = this._pressName;
    if (input.isPressed(name)) return;
    const element = this._pressed;
    const released = input.isJustReleasedByPlayer(name);
    this._cancelPress();
    if (released) this._activate(element);
  }

  /** Drop a press and unpaint it, leaving the action unrun. */
  private _cancelPress(): void {
    const element = this._pressed;
    this._pressed = null;
    this._pressName = "";
    if (element === null) return;
    getFocusState(element)?.behavior.setPressed?.(false);
  }

  private _unlatch(input: UIFocusInputSource): void {
    for (const name of this._latched) {
      if (input.isPressed(name) || input.isJustPressed(name)) continue;
      this._latched.delete(name);
    }
  }

  private _edge(
    input: UIFocusInputSource,
    names: readonly string[],
    repeat: RepeatQuery | undefined,
  ): boolean {
    return this._edgeName(input, names, repeat) !== undefined;
  }

  /** The first unlatched name of this role that reports an edge. */
  private _edgeName(
    input: UIFocusInputSource,
    names: readonly string[],
    repeat: RepeatQuery | undefined,
  ): string | undefined {
    for (const name of names) {
      if (this._latched.has(name)) continue;
      if (input.isJustPressed(name, repeat)) return name;
    }
    return undefined;
  }
}
