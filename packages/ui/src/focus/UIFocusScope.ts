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
 * The slice of an input manager a scope reads.
 *
 * Declared structurally so `@yagejs/ui` names no type from `@yagejs/input`:
 * the input package stays an optional peer, and a handful of methods on a
 * stub object drive a scope in a unit test.
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
   * Whether the player let go of the action in this window, as opposed to the
   * engine dropping the hold — the window losing focus, the action's group
   * being disabled, any other forced clear of physical state. A confirm press
   * runs its element's action on this and on nothing else.
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

/** What `isJustPressed` is asked for on a direction role. */
interface RepeatQuery {
  repeat: true;
  repeatDelay?: number;
  repeatInterval?: number;
}

/** The action names and repeat cadence a scope polls with. */
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
 * one, so a confirm dialog's rows belong to the dialog and never to the menu
 * around it, and a pointer request finds the scope whose subtree it landed
 * in.
 */
const scopeHosts = new WeakMap<DisplayContainer, UIFocusScope>();

/**
 * The scope `element` belongs to: the innermost one whose host container the
 * element hangs under, which is the scope whose candidate walk reaches it.
 */
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
 * Whether this container narrows the hit test of everything beneath it.
 *
 * Pixi asks a container's mask whether it holds the point before it looks at
 * any child (`EventBoundary.hitPruneFn`), and a mask that says no prunes the
 * container together with its whole subtree. A clipped container is therefore
 * hittable only where it draws, whatever hit area its children carry.
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

/** The element's children, or `undefined` for a leaf. */
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

/** Whether `node` is the box of one of the scroll views around a candidate. */
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
 * Write into `out` the two facts a scroll follow turns on, read from the
 * boxes between `element` and the outermost scroll view around it: where the
 * element sits inside the scrolled content — every box's position inside its
 * parent, plus the element's own size — and how large each viewport around it
 * is.
 *
 * The size of the panel a view holds its rows in is read from none of those
 * boxes. It answers to every row, so a row appended or removed below the
 * focused one grows or shrinks it while the focused row stays where it was,
 * and following that would pull the list away from the offset the player
 * wheeled or dragged to.
 *
 * Yoga carries none of a view's scroll offset — that lives on the content
 * container's position — so this reading changes when a layout pass moved the
 * element or resized a viewport, and stands still while the player scrolls a
 * list by hand.
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

/** Whether two geometry readings hold the same numbers in the same order. */
function sameGeometry(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    // `Object.is`, so a box that has no number yet reads as unchanged rather
    // than as a reason to scroll on every frame.
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
 * engine attached, which is what `input: null`, a cutscene script and a unit
 * test drive.
 *
 * The scope reading input owns the pointer as well as the keys: everything
 * drawn under it stops answering the mouse for as long as it holds them, so
 * a dialog cannot be clicked through. `modal: false` leaves the pointer to
 * whatever is behind.
 *
 * Candidates are rebuilt from the live tree on every read. There is no cache:
 * `visible` and `setDisabled` are plain setters no shared helper observes, so
 * a cache would go stale in exactly the cases navigation depends on.
 */
export class UIFocusScope {
  private readonly host: UIFocusScopeHost;

  private _wrap = true;
  private _autoFocus = true;
  private _pointerFocus: PointerFocusMode = "press";
  private _modal = true;
  /** The container swallowing the pointer around this scope, once built. */
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
  /** The element a confirm press is being held on, or `null`. */
  private _pressed: UIElement | null = null;
  /** The action name whose hold that press follows. */
  private _pressName = "";
  /** Tree index the focused element had, so a lost row resumes beside it. */
  private _focusedIndex = -1;
  /** Tree index a torn-down element held, or `-1` when nothing is owed. */
  private _lostIndex = -1;
  /** Set by `focus(null)`, so a menu the game unlit stays unlit. */
  private _clearedByGame = false;
  private _hasInput = false;

  // Rebuilt by one walk per read, reusing the entries it already holds, so
  // navigating a list whose length is steady allocates nothing.
  private readonly _candidates: Candidate[] = [];
  private _count = 0;
  private readonly _scrollStack: FocusScrollView[] = [];
  /** The element under this scope holding its input, or `null`. */
  private _capture: UIInputCaptureElement | null = null;
  private _wasCapturing = false;
  private readonly _seenIds = new Set<string>();

  // The boxes the last scroll follow read, and this frame's reading of them.
  private readonly _followedGeometry: number[] = [];
  private readonly _currentGeometry: number[] = [];

  // Geometry, read only on a move.
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
   * {@link hasInput} is true, so a menu behind a dialog keeps its row without
   * lighting it up.
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
   * `null` clears focus.
   *
   * @throws when `element` is not inside this scope — a programming error
   * knowable at the call. A descendant that is hidden, disabled or not
   * focusable returns `false` with a development warning instead, because
   * that is a layout race the caller could not have known about.
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
   * element and focus stays where it is. One it has no use for is still
   * consumed, so a direction never reaches the menu behind an open list.
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
   * Run the focused element's own action — the one a click runs — and then
   * `onActivate`. A disabled or unfocused scope does nothing. While an
   * element under this scope holds its input, this confirms that element
   * instead, keeping what it produced.
   *
   * This runs at once and paints no press: a press is the picture of a held
   * confirm action, and a call from game code holds nothing. The pressed look
   * belongs to the scope's own polling, which shows it for as long as the
   * player keeps the action down.
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
   * cancels that element instead — an open list closes on the value it had,
   * and the menu around it stays open.
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
   * default. A host calls this with the `focus` value it was handed, so a
   * callback a React render stopped passing is dropped rather than kept.
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
   * Drop a focused element that is being torn down: no callback and no
   * repaint, because painting from here reaches a freed Yoga node and a
   * destroyed container. The tree index it held is kept, so the next
   * validation lands beside it rather than back at the first row.
   * @internal
   */
  _clearFocusedOnDestroy(element: UIElement): void {
    if (this._focused !== element) return;
    this._focused = null;
    this._lostIndex = this._focusedIndex;
  }

  /**
   * Whether this scope's host is on screen: visible itself and under visible
   * ancestors all the way up. Hiding a surface, disabling its component and
   * deactivating its entity all write the same flag, so all three hand input
   * back, and a dialog inside a hidden surface holds no keys.
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

  /**
   * Whether `scope` sits inside this one's subtree — a confirm dialog's scope
   * inside the menu's. A stack reads it to give input to the innermost shown
   * scope, so which one the player drives follows the shape of the tree
   * rather than the order the two scopes happened to register in.
   * @internal
   */
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

  /**
   * Start reading input: latch whatever is already held, then light up the
   * remembered element or the first candidate.
   * @internal
   */
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
    // One auto-focus rule for every way a scope arrives with nothing lit, so
    // a menu the game unlit with `focus(null)` stays unlit when a dialog over
    // it closes, exactly as it does across the frames in between.
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
    // A scope that has stopped reading input will never see the release that
    // would end a press it is holding, so the press ends here and its action
    // does not run — a menu that hid itself lights nothing.
    this._cancelPress();
    // The keys this scope handed to an element are not this scope's to hand
    // out any more, so a field gives back the caret and an open list closes.
    this._releaseCapture(this._capture);
    if (this._focused !== null)
      getFocusState(this._focused)?._setFocused(false);
  }

  /** One frame of this scope: validate, pointer, poll. @internal */
  _tick(input: UIFocusInputSource | null): void {
    // The seat is read again here, so a panel that starts clipping its
    // overflow while the dialog is up, or a subtree that is moved, does not
    // leave the blocker somewhere a clip reaches it.
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
   * Put the pointer blocker in place, or take it away, to match what this
   * scope owns: a modal scope reading input swallows the pointer everywhere
   * around itself, and anything else leaves the pointer alone.
   *
   * The blocker goes directly under the branch the scope is drawn in, so
   * everything the scope draws sits above it and answers the pointer as it
   * always does, while every point around the scope reaches the blocker
   * first. A scope nested inside another therefore blocks the menu around it
   * and not its own rows.
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
    // Out of wherever it sat before, so the index below is read against the
    // children the seat is measured in.
    blocker.removeFromParent();
    parent.addChildAt(
      blocker,
      below === null ? 0 : parent.children.indexOf(below),
    );
  }

  /**
   * Where this scope's blocker hangs: the bottom of its own host, or the far
   * side of the host when the host clips its own hit test.
   *
   * Both seats put the blocker directly beneath everything the scope draws
   * and above everything else around it, which is the whole of what a modal
   * scope owns. A clip anywhere above the host bounds the scope's siblings
   * exactly as it bounds the scope, so the region that clip prunes holds
   * nothing left to block, and the blocker stays inside it answering for the
   * rows a dialog is there to cover. A clip on the host bounds the scope
   * alone: a blocker inside one covers the single region a scope needs no
   * blocker for and leaves every point around the dialog live. Giving the
   * blocker a hit area of its own buys it nothing there, because the clip is
   * read above it and prunes it before that hit area is asked.
   *
   * Staying inside the host wherever it clips nothing keeps what that
   * placement is worth: a hidden host is pruned from the hit test with the
   * blocker inside it, and a destroyed host destroys it. A blocker beside the
   * host leans on the stack instead, which releases a scope on the frame it
   * sees its host stop being shown, and on `_destroy`, which takes the
   * blocker down itself. A clipping host with nothing above it keeps its
   * blocker inside, because there is no outside of the tree to hang from.
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
    // Nothing is kept past the live count: an entry the walk did not reuse
    // still points at an element the tree has dropped, and would keep that
    // row's container and Yoga node reachable for as long as the scope lives.
    this._candidates.length = this._count;
  }

  private _walk(elements: readonly UIElement[]): void {
    for (const element of elements) {
      const container = element.displayObject;
      // A hidden subtree costs one check: nothing in it is reachable, and
      // nothing in it is measured.
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
    // The walk stacks them outermost first; a candidate wants them the other
    // way round, because an inner list has to move before the outer one
    // measures.
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
   * nearest survivor: the candidate that took its place in tree order, or the
   * last one when the list ends before it. A player forty rows into a list is
   * not thrown back to row one.
   */
  private _validate(): void {
    // An element that took the input on a path focus did not follow — a field
    // clicked in a scope the pointer moves no focus in — takes focus with it,
    // so the presses handed to it go to the row the scope reports.
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
   * Land beside an element torn down while it held focus, on the candidate
   * that took its place in tree order. Destroying a focused row and hiding
   * one therefore leave focus in the same place. An empty list keeps the
   * index owed, so a list that repopulates resumes where the player was.
   */
  private _resumeAfterDestroy(): void {
    const lost = this._lostIndex;
    if (lost === -1 || this._count === 0) return;
    const next = Math.max(0, Math.min(lost, this._count - 1));
    this._commitFocus(this._candidates[next]!.element, next);
  }

  /**
   * Light the first candidate for a scope holding input with nothing
   * focused — a menu whose rows arrive a frame after it opens, or one whose
   * every row was disabled when it did. A game that cleared focus itself
   * keeps an unlit menu until it moves.
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
      // The candidate array outlives the walk that filled it, so the live
      // count is what says whether there is anything to focus.
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
   * Fill `_moveRects` with this frame's candidate boxes in the host's space
   * and return the focused element's index into it.
   *
   * A candidate inside a scroll view is clipped to that view's viewport, and
   * one clipped away entirely drops out, so Up from a footer lands on the
   * nearest row a player can see rather than teleporting into the middle of
   * a list. Candidates sharing the focused element's innermost view keep
   * their full box, which is what makes the next row below the fold
   * reachable.
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
    // that element ends the press and runs nothing — the rule the pointer
    // follows when it is dragged off a button it pressed.
    this._cancelPress();
    // The field is committed before anything is painted and before any game
    // callback runs, so a throwing handler cannot leave `focused` and the
    // painted element disagreeing.
    this._focused = next;
    // An element answers the player on its own only while focus is on it, so
    // focus moving away hands its keys back: an open list closes on the value
    // it had, and a field being typed into gives back the caret.
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
   * first, so an inner list has already moved when the outer one measures.
   *
   * Runs where focus lands — a move, a pointer, a game's `focus()` call, the
   * frame the scope takes input — and where the boxes it reads have moved
   * since the last follow. A tick on its own runs nothing, so a list the
   * player wheels or drags keeps the offset they scrolled it to.
   */
  private _followScroll(element: UIElement, index: number): void {
    const candidate = this._candidates[index];
    if (candidate === undefined || candidate.element !== element) return;
    readFollowGeometry(element, candidate.scrollViews, this._followedGeometry);
    for (const view of candidate.scrollViews) {
      view.scrollIntoView(element, this._followOptions);
    }
  }

  /**
   * Follow the focused element again once a layout pass has moved it inside
   * the scrolled content or resized a viewport around it — a row arriving
   * above it, a viewport that shrank — so a row pushed out of sight by
   * something other than the player comes back. A row appended or removed
   * below it leaves both of those readings where they were, as does a
   * player's wheel or drag, so neither starts a follow.
   */
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
   * Take this tick's pointer request and hand it to the scope whose subtree
   * the element sits in, which is not always this one: only the driven scope
   * ticks, so a menu behind a dialog would otherwise never hear that the
   * pointer reached one of its rows. Each scope answers for itself, so a
   * console-style submenu can follow the pointer while the menu around it
   * leaves focus to the keyboard.
   *
   * A modal scope answers for the pointer everywhere, so a request from
   * outside its subtree is dropped. Pixi carries an event from the blocker up
   * through the containers the scope hangs under, and a focusable panel among
   * them would otherwise read a press on the blocked area as a press on
   * itself.
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
   * Move focus to an element of this scope the pointer reached, where this
   * scope's `pointerFocus` acts on that kind of pointer input. A scope that
   * is not reading input remembers the element and paints nothing, so
   * returning to that scope resumes where the pointer left it.
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
   * Latch every name already held, and name a role nothing in the live map
   * answers to. Taken on every transition into reading input, so a direction
   * held while a submenu closes runs away in no parent menu.
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
    // A confirm press owns every tick between the edge that starts it and
    // the release that ends it, so a held confirm neither runs its action
    // twice nor walks the menu underneath it.
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
      // A press and its release inside one query window — a quick tap, a
      // scripted key press — is the whole press, so it ends in the tick that
      // saw it rather than waiting for a release that has already gone by.
      if (this._pressed !== null) this._resolvePress(input);
      return;
    }
    if (this._edge(input, roles.names.cancel, undefined)) this.cancel();
  }

  /**
   * One frame of a scope whose input an element holds: the same six roles,
   * every one of them handed to that element.
   *
   * At most one press is resolved. Confirm and cancel come before the
   * directions, so an end lands on what the element is showing at the start
   * of the tick and a direction held all the while — a movement key under
   * the fingers of a player typing a name — cannot swallow it. A direction
   * left over once the element has ended reaches nobody: ending re-latches
   * every held name, so navigation restarts from a fresh press.
   *
   * Confirm acts on the edge and paints no press. A press is the picture of
   * an element being activated, and the element holding the input activates
   * nothing.
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
   * Take the input back from the element holding it, where `element` is that
   * one and still holds it. Read from the record rather than from the last
   * walk, so an element that gave the input back on its own — a list a mouse
   * click closed — is not asked to end again.
   */
  private _releaseCapture(element: UIElement | null): void {
    if (element === null) return;
    capturedInput(element)?.releaseCapture();
  }

  /**
   * Take a confirm press onto `element` and paint it. The press lands only on
   * the element that still holds focus, so a direction resolved earlier in
   * this same tick takes the confirm with it rather than pressing the row the
   * player has already left.
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
   * Carry a press through one tick: keep it while the player holds the
   * action, and run the element's own action on the release the player made.
   *
   * A hold ends for reasons the player had no part in — the window losing
   * focus and the engine dropping every held key, the action's group being
   * disabled, any other forced clear of physical state. None of those may run
   * a row's action, so the press is dropped instead, which is what the
   * pointer path does when a release lands outside the button it started on.
   *
   * A press that no longer belongs to anyone never reaches here, because
   * every move of focus cancels it — and an element hidden, disabled or torn
   * down under a press has handed focus on by the time this runs.
   */
  private _resolvePress(input: UIFocusInputSource): void {
    const name = this._pressName;
    if (input.isPressed(name)) return;
    const element = this._pressed;
    const released = input.isJustReleasedByPlayer(name);
    this._cancelPress();
    if (released) this._activate(element);
  }

  /**
   * Drop a press and unpaint it, leaving the element's action unrun. The
   * element is reached through its live focus state, so a press held on an
   * element that has since been torn down ends with no repaint of a freed
   * Yoga node and a destroyed container.
   */
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

  /**
   * The first name of this role that reports an edge, which a press then
   * follows through `isPressed` for as long as the player holds it.
   */
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
