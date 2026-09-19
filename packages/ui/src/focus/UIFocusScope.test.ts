import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Node as YogaNode } from "yoga-layout";
import { isPointerConsumeContainer } from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";
import { MockContainer } from "../test-helpers.js";
import type {
  FocusDirection,
  FocusProps,
  UIContainerElement,
  UIElement,
  UIScrollIntoViewOptions,
} from "../types.js";
import { FocusState } from "./FocusState.js";
import type { FocusBehavior } from "./FocusState.js";
import {
  requestHoverFocus,
  requestPressFocus,
  takePointerRequest,
} from "./pointer-request.js";
import { markScrollView } from "./scroll-registry.js";
import { captureFocusInput } from "./input-capture.js";
import type { UIInputCaptureElement } from "./input-capture.js";
import { UIFocusScope } from "./UIFocusScope.js";
import type { UIFocusInputSource, UIFocusScopeHost } from "./UIFocusScope.js";

// ---------------------------------------------------------------------------
// A tree of stand-in elements: a Pixi container each, a laid-out Yoga box, and
// optionally the focus state a real primitive builds for itself.
// ---------------------------------------------------------------------------

interface NodeOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * The node drawing into each container, so a pointer walk over the container
 * tree can ask what box answers there. A blocker is in no entry: it carries a
 * hit area of its own and answers wherever it is reached.
 */
const nodesByContainer = new WeakMap<MockContainer, TestNode>();

class TestNode implements UIContainerElement {
  readonly container = new MockContainer();
  readonly children: UIElement[] = [];
  width: number;
  height: number;
  /** Where the laid-out box sits inside its parent's, as Yoga reports it. */
  left: number;
  top: number;
  /** The node above this one in the Yoga tree, set as a child is added. */
  yogaParent: TestNode | null = null;
  state: FocusState | undefined;
  paints: boolean[] = [];
  /** Every press paint the scope asked for, in order. */
  presses: boolean[] = [];
  activations = 0;
  disabled = false;

  private readonly _yoga: YogaNode;

  constructor(options: NodeOptions = {}) {
    this.width = options.width ?? 100;
    this.height = options.height ?? 20;
    this.left = options.x ?? 0;
    this.top = options.y ?? 0;
    this.container.position.set(this.left, this.top);
    nodesByContainer.set(this.container, this);
    // One stable object, because the follow compares Yoga nodes by identity
    // to find where a subtree meets its scroll view.
    this._yoga = {
      getComputedWidth: () => this.width,
      getComputedHeight: () => this.height,
      getComputedLeft: () => this.left,
      getComputedTop: () => this.top,
      getParent: () => this.yogaParent?.yogaNode ?? null,
    } as unknown as YogaNode;
  }

  get displayObject(): DisplayContainer {
    return this.container as unknown as DisplayContainer;
  }

  get yogaNode(): YogaNode {
    return this._yoga;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(value: boolean) {
    this.container.visible = value;
  }

  /** Put the laid-out box somewhere else, as a layout pass does. */
  layoutAt(left: number, top: number): void {
    this.left = left;
    this.top = top;
    this.container.position.set(left, top);
  }

  /** Make this node take part in focus, the way a primitive's own does. */
  focusable(props: FocusProps = {}, behavior?: Partial<FocusBehavior>): this {
    this.state = new FocusState(this, props, {
      focusableByDefault: true,
      isDisabled: () => this.disabled,
      paint: (focused) => this.paints.push(focused),
      setPressed: (pressed) => this.presses.push(pressed),
      activate: () => {
        this.activations += 1;
      },
      ...behavior,
    });
    return this;
  }

  add<T extends TestNode>(child: T): T {
    this.children.push(child);
    child.yogaParent = this;
    this.container.addChild(child.container);
    return child;
  }

  addElement(child: UIElement): void {
    this.children.push(child);
  }

  removeElement(child: UIElement): void {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
  }

  insertElementBefore(child: UIElement, before: UIElement): void {
    this.children.splice(this.children.indexOf(before), 0, child);
  }

  update(): void {}

  destroy(): void {
    this.state?.destroy();
  }
}

/** A node the scope treats as a scroll view: a viewport box that clips. */
class TestScrollView extends TestNode {
  readonly scrolled: UIElement[] = [];
  readonly paddings: (number | undefined)[] = [];
  /**
   * The panel the rows hang in: a Yoga box of its own between the view and
   * every row, as tall as all of them together, and the container the scroll
   * offset moves. It is not one of the view's children — `children` reaches
   * the rows directly, the way a real view delegates to its content panel.
   */
  readonly content: TestNode;

  constructor(options: NodeOptions = {}) {
    super(options);
    this.content = new TestNode({ width: this.width, height: 0 });
    this.content.yogaParent = this;
    this.container.addChild(this.content.container);
    markScrollView(this);
  }

  override add<T extends TestNode>(child: T): T {
    this.children.push(child);
    child.yogaParent = this.content;
    this.content.container.addChild(child.container);
    this.relayout();
    return child;
  }

  override insertElementBefore(child: UIElement, before: UIElement): void {
    super.insertElementBefore(child, before);
    const row = child as TestNode;
    row.yogaParent = this.content;
    this.content.container.addChild(row.container);
    this.relayout();
  }

  override removeElement(child: UIElement): void {
    super.removeElement(child);
    this.relayout();
  }

  /** Size the content panel to the rows it holds, as a layout pass does. */
  relayout(): void {
    let extent = 0;
    for (const child of this.children) {
      const row = child as TestNode;
      extent = Math.max(extent, row.top + row.height);
    }
    this.content.width = this.width;
    this.content.height = extent;
  }

  scrollIntoView(element: UIElement, opts?: UIScrollIntoViewOptions): void {
    this.scrolled.push(element);
    this.paddings.push(opts?.padding);
  }

  /** Pan the rows, the way a real view moves its content container. */
  scrollTo(offset: number): void {
    this.content.container.position.set(0, -offset);
  }
}

/**
 * A node that takes its scope's input, the way a field with the caret and an
 * open list do. `moves` records every direction the scope handed it,
 * including the ones it has no use for.
 */
class TestHolder extends TestNode implements UIInputCaptureElement {
  confirms = 0;
  cancels = 0;
  releases = 0;
  readonly moves: FocusDirection[] = [];
  /** Left out for a holder that has no use for a direction, as a field has. */
  readonly moveCapture?: (direction: FocusDirection) => void;

  constructor(options: NodeOptions & { takesDirections?: boolean } = {}) {
    super(options);
    if (options.takesDirections === false) return;
    this.moveCapture = (direction): void => {
      this.moves.push(direction);
    };
  }

  confirmCapture(): void {
    this.confirms += 1;
    this.stop();
  }

  cancelCapture(): void {
    this.cancels += 1;
    this.stop();
  }

  releaseCapture(): void {
    this.releases += 1;
    this.stop();
  }

  /** Take the scope's input, as opening a list or starting an edit does. */
  start(): void {
    captureFocusInput(this, true);
  }

  /** Give it back, as every way of ending does. */
  stop(): void {
    captureFocusInput(this, false);
  }
}

function hostOf(root: TestNode): UIFocusScopeHost {
  return {
    displayObject: root.displayObject,
    roots: () => root.children,
  };
}

/**
 * The entries the candidate walk fills. It reuses them rather than building
 * one per element per frame, so the array behind the live count is what a
 * dropped row stays reachable through.
 */
function pooledCandidates(scope: UIFocusScope): readonly unknown[] {
  return (scope as unknown as { readonly _candidates: readonly unknown[] })
    ._candidates;
}

const DEFAULT_ACTIONS = [
  "move-up",
  "move-down",
  "move-left",
  "move-right",
  "interact",
  "cancel",
];

/** What a scope asks `isJustPressed` for, as recorded by the stub. */
type PressQuery =
  | { repeat?: boolean; repeatDelay?: number; repeatInterval?: number }
  | undefined;

class StubInput implements UIFocusInputSource {
  private readonly held = new Set<string>();
  private readonly edges = new Set<string>();
  private readonly playerReleases = new Set<string>();
  /** Names whose group is switched off: every query on them answers false. */
  private readonly silenced = new Set<string>();
  readonly actions = new Set<string>(DEFAULT_ACTIONS);
  /** The options behind every query that found an edge, in order. */
  readonly queries: PressQuery[] = [];

  isPressed(action: string): boolean {
    return !this.silenced.has(action) && this.held.has(action);
  }

  isJustPressed(action: string, options?: PressQuery): boolean {
    if (this.silenced.has(action)) return false;
    if (this.edges.has(action)) {
      this.queries.push(options === undefined ? undefined : { ...options });
    }
    return this.edges.has(action);
  }

  isJustReleasedByPlayer(action: string): boolean {
    return !this.silenced.has(action) && this.playerReleases.has(action);
  }

  hasAction(name: string): boolean {
    return this.actions.has(name);
  }

  /** A fresh press: held and reporting an edge. */
  press(...names: string[]): void {
    for (const name of names) {
      this.held.add(name);
      this.edges.add(name);
      this.playerReleases.delete(name);
    }
  }

  /** A press and a release inside one frame: both edges, nothing held. */
  tap(name: string): void {
    this.edges.add(name);
    this.held.delete(name);
    this.playerReleases.add(name);
  }

  /** A later frame of a hold: still down, with the press edge gone by. */
  settle(): void {
    this.edges.clear();
  }

  /** The player letting go. */
  release(...names: string[]): void {
    for (const name of names) {
      this.held.delete(name);
      this.playerReleases.add(name);
    }
    this.edges.clear();
  }

  /**
   * Held state the engine drops while the player is still holding it: the
   * window losing focus, the page hiding.
   */
  forceRelease(...names: string[]): void {
    for (const name of names) this.held.delete(name);
    this.edges.clear();
  }

  /** A hard reset of every name, the way `InputManager.clearAll()` is. */
  clearAll(): void {
    this.held.clear();
    this.edges.clear();
    this.playerReleases.clear();
  }

  /** Switch off the group `names` belong to. */
  silence(...names: string[]): void {
    for (const name of names) this.silenced.add(name);
  }
}

/** A scope reading input, its latch already armed and cleared. */
function driven(
  scope: UIFocusScope,
  input: UIFocusInputSource = new StubInput(),
): void {
  scope._takeInput(input);
}

beforeEach(() => {
  // The pointer request cell is module-level; a request left by one test is
  // not the next one's.
  takePointerRequest();
  vi.restoreAllMocks();
});

/** A column of `count` rows, 100×20 each, 30px apart. */
function column(
  count: number,
  ids?: readonly string[],
): {
  root: TestNode;
  rows: TestNode[];
} {
  const root = new TestNode();
  const rows: TestNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = ids?.[i];
    const row = root.add(new TestNode({ y: i * 30 }));
    row.focusable(id === undefined ? {} : { focusId: id });
    rows.push(row);
  }
  return { root, rows };
}

describe("UIFocusScope candidates", () => {
  it("collects the focusable, enabled, visible, laid-out elements", () => {
    const root = new TestNode();
    const taken = root.add(new TestNode({ y: 0 })).focusable();
    root.add(new TestNode({ y: 30 })); // no focus state at all
    root.add(new TestNode({ y: 60 })).focusable({ focusable: false });
    const off = root.add(new TestNode({ y: 90 })).focusable();
    off.disabled = true;
    const hidden = root.add(new TestNode({ y: 120 })).focusable();
    hidden.visible = false;
    const unlaid = root.add(new TestNode({ y: 150 })).focusable();
    unlaid.width = Number.NaN;
    const nested = root.add(new TestNode({ y: 180 })).focusable();

    const scope = new UIFocusScope(hostOf(root), {});

    expect(scope.candidates).toEqual([taken, nested]);
  });

  it("holds no entry for a row the walk no longer reaches", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    expect(scope.candidates).toHaveLength(3);

    root.removeElement(rows[1]!);
    root.removeElement(rows[2]!);

    expect(scope.candidates).toHaveLength(1);
    expect(pooledCandidates(scope)).toHaveLength(1);
  });

  it("walks through a scroll view to the rows inside it", () => {
    const root = new TestNode();
    const list = root.add(new TestScrollView({ height: 140 }));
    const first = list.add(new TestNode({ y: 0 })).focusable();
    const second = list.add(new TestNode({ y: 30 })).focusable();

    const scope = new UIFocusScope(hostOf(root), {});

    expect(scope.candidates).toEqual([first, second]);
  });

  it("skips a hidden panel and everything under it", () => {
    const root = new TestNode();
    const group = root.add(new TestNode());
    group.add(new TestNode()).focusable();
    group.visible = false;
    const after = root.add(new TestNode({ y: 60 })).focusable();

    expect(new UIFocusScope(hostOf(root), {}).candidates).toEqual([after]);
  });

  it("stops at an element that owns its own scope", () => {
    const root = new TestNode();
    const outer = root.add(new TestNode({ y: 0 })).focusable();
    const dialog = root.add(new TestNode({ y: 60 }));
    const inner = dialog.add(new TestNode()).focusable();
    new UIFocusScope(hostOf(dialog), {});

    const parent = new UIFocusScope(hostOf(root), {});

    expect(parent.candidates).toEqual([outer]);
    expect(parent.candidates).not.toContain(inner);
  });
});

describe("UIFocusScope.move", () => {
  it("takes the first candidate in tree order when nothing is focused", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});

    expect(scope.move("up")).toBe(true);
    expect(scope.focused).toBe(rows[0]);
  });

  it("refuses to move with no candidates and still runs onCancel", () => {
    const root = new TestNode();
    const onCancel = vi.fn();
    const onMoveBlocked = vi.fn();
    const scope = new UIFocusScope(hostOf(root), { onCancel, onMoveBlocked });

    expect(scope.move("down")).toBe(false);
    expect(onMoveBlocked).toHaveBeenCalledWith("down");
    scope.cancel();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("refuses to move once every row it had has gone", () => {
    const { root, rows } = column(2);
    const onMoveBlocked = vi.fn();
    const scope = new UIFocusScope(hostOf(root), { onMoveBlocked });
    driven(scope);
    expect(scope.focused).toBe(rows[0]);

    // What a filter emptying a list does. The scope walked a full list once,
    // so a stale row is within reach of anything reading past the count.
    for (const row of rows) row.visible = false;
    scope._tick(null);
    expect(scope.focused).toBeNull();

    expect(scope.move("down")).toBe(false);
    expect(scope.focused).toBeNull();
    expect(onMoveBlocked).toHaveBeenCalledWith("down");

    scope.activate();
    expect(rows[0]!.activations).toBe(0);
  });

  it("walks a column down and back up", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(rows[0]!);

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(rows[1]);
    scope.move("down");
    expect(scope.focused).toBe(rows[2]);
    scope.move("up");
    expect(scope.focused).toBe(rows[1]);
  });

  it("walks a row left and right", () => {
    const root = new TestNode();
    const a = root.add(new TestNode({ x: 0, width: 40 })).focusable();
    const b = root.add(new TestNode({ x: 60, width: 40 })).focusable();
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(a);

    expect(scope.move("right")).toBe(true);
    expect(scope.focused).toBe(b);
    expect(scope.move("left")).toBe(true);
    expect(scope.focused).toBe(a);
  });

  it("wraps past the last row by default and refuses when wrap is off", () => {
    const { root, rows } = column(3);
    const wrapping = new UIFocusScope(hostOf(root), {});
    wrapping.focus(rows[2]!);
    expect(wrapping.move("down")).toBe(true);
    expect(wrapping.focused).toBe(rows[0]);

    const onMoveBlocked = vi.fn();
    const fixed = new UIFocusScope(hostOf(root), {
      wrap: false,
      onMoveBlocked,
    });
    fixed.focus(rows[2]!);
    expect(fixed.move("down")).toBe(false);
    expect(fixed.focused).toBe(rows[2]);
    expect(onMoveBlocked).toHaveBeenCalledWith("down");
  });

  it("breaks a tie by tree order", () => {
    const root = new TestNode();
    const from = root.add(new TestNode({ x: 0, y: 0, width: 40 })).focusable();
    const first = root
      .add(new TestNode({ x: 0, y: 40, width: 40 }))
      .focusable();
    root.add(new TestNode({ x: 0, y: 40, width: 40 })).focusable();
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(from);

    scope.move("down");

    expect(scope.focused).toBe(first);
  });
});

describe("UIFocusScope explicit neighbours", () => {
  it("jumps to the candidate a focusId names", () => {
    const root = new TestNode();
    const from = root
      .add(new TestNode({ y: 0 }))
      .focusable({ focusNeighbors: { down: "last" } });
    root.add(new TestNode({ y: 30 })).focusable();
    const target = root
      .add(new TestNode({ y: 60 }))
      .focusable({ focusId: "last" });
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(from);

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(target);
  });

  it("stops movement on a null neighbour without wrapping", () => {
    const root = new TestNode();
    const from = root
      .add(new TestNode({ y: 0 }))
      .focusable({ focusNeighbors: { left: null } });
    root.add(new TestNode({ x: -60 })).focusable();
    const onMoveBlocked = vi.fn();
    const scope = new UIFocusScope(hostOf(root), { onMoveBlocked });
    scope.focus(from);

    expect(scope.move("left")).toBe(false);
    expect(scope.focused).toBe(from);
    expect(onMoveBlocked).toHaveBeenCalledWith("left");
  });

  it("falls back to position when the named id is not on screen", () => {
    const root = new TestNode();
    const from = root
      .add(new TestNode({ y: 0 }))
      .focusable({ focusNeighbors: { down: "filtered-out" } });
    const below = root.add(new TestNode({ y: 30 })).focusable();
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(from);

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(below);
  });

  it("warns once when two candidates answer to one id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root, rows } = column(3, ["row", "row", "third"]);
    const scope = new UIFocusScope(hostOf(root), {});

    scope.focus(rows[2]!);
    scope.move("up");
    scope.move("down");

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('focusId "row"');
  });
});

describe("UIFocusScope adjustment", () => {
  it("gives left and right to onAdjust and keeps focus", () => {
    const onAdjust = vi.fn();
    const root = new TestNode();
    const row = root.add(new TestNode({ y: 0 })).focusable({ onAdjust });
    const below = root.add(new TestNode({ y: 30 })).focusable();
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(row);

    expect(scope.move("left")).toBe(true);
    expect(scope.move("right")).toBe(true);
    expect(scope.focused).toBe(row);
    expect(onAdjust.mock.calls).toEqual([[-1], [1]]);

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(below);
  });

  it("lets a stepper release the press at its end so focus can leave", () => {
    const root = new TestNode();
    let value = 0;
    const slider = root.add(new TestNode({ y: 0 })).focusable(
      {},
      {
        adjust: (direction) => {
          if (direction !== "right") return false;
          if (value === 1) return false;
          value = 1;
          return true;
        },
      },
    );
    const right = root.add(new TestNode({ x: 200, y: 0 })).focusable();
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(slider);

    expect(scope.move("right")).toBe(true);
    expect(scope.focused).toBe(slider);
    expect(value).toBe(1);

    expect(scope.move("right")).toBe(true);
    expect(scope.focused).toBe(right);
  });
});

describe("UIFocusScope.focus", () => {
  it("throws for an element outside the scope", () => {
    const { root, rows } = column(1);
    const stranger = new TestNode().focusable();
    const scope = new UIFocusScope(hostOf(root), {});

    expect(() => scope.focus(stranger)).toThrowError(
      "UIFocusScope.focus: the element must be inside this scope, got " +
        "TestNode.",
    );
    expect(scope.focused).toBeNull();
    expect(scope.focus(rows[0]!)).toBe(true);
  });

  it("refuses a hidden, a disabled and an unfocusable descendant", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = new TestNode();
    const hidden = root.add(new TestNode({ y: 0 })).focusable();
    hidden.visible = false;
    const off = root.add(new TestNode({ y: 30 })).focusable();
    off.disabled = true;
    const skipped = root
      .add(new TestNode({ y: 60 }))
      .focusable({ focusable: false });
    const scope = new UIFocusScope(hostOf(root), {});

    for (const row of [hidden, off, skipped]) {
      expect(scope.focus(row)).toBe(false);
      expect(scope.focused).toBeNull();
    }
    expect(warn).toHaveBeenCalledOnce();
  });

  it("clears focus when handed null", () => {
    const { root, rows } = column(2);
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(rows[0]!);

    expect(scope.focus(null)).toBe(true);
    expect(scope.focused).toBeNull();
  });
});

describe("UIFocusScope.activate", () => {
  it("runs the element's action and then onActivate", () => {
    const order: string[] = [];
    const { root, rows } = column(1);
    const row = rows[0]!;
    const scope = new UIFocusScope(hostOf(root), {
      onActivate: () => order.push("scope"),
    });
    scope.focus(row);

    scope.activate();

    expect(row.activations).toBe(1);
    expect(order).toEqual(["scope"]);
  });

  it("does nothing on a disabled element", () => {
    const onActivate = vi.fn();
    const { root, rows } = column(1);
    const row = rows[0]!;
    const scope = new UIFocusScope(hostOf(root), { onActivate });
    scope.focus(row);
    row.disabled = true;

    scope.activate();

    expect(row.activations).toBe(0);
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("UIFocusScope validation", () => {
  it("leaves no callback and no repaint for a destroyed element", () => {
    const onFocusChange = vi.fn();
    const root = new TestNode();
    const row = root.add(new TestNode()).focusable({ onFocusChange });
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(row);
    onFocusChange.mockClear();
    row.paints.length = 0;

    row.destroy();

    expect(scope.focused).toBeNull();
    expect(onFocusChange).not.toHaveBeenCalled();
    expect(row.paints).toEqual([]);
  });

  it("lands on the nearest survivor when the focused row is hidden", () => {
    const { root, rows } = column(6);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(rows[4]!);

    rows[4]!.visible = false;
    scope._tick(null);

    expect(scope.focused).toBe(rows[5]);
    expect(rows[4]!.paints.at(-1)).toBe(false);
  });

  it("falls back to the row before it when the list ends there", () => {
    const { root, rows } = column(4);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(rows[3]!);

    rows[3]!.disabled = true;
    scope._tick(null);

    expect(scope.focused).toBe(rows[2]);
  });

  it("lands beside a focused row that was destroyed", () => {
    const onFocusMove = vi.fn();
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), { onFocusMove });
    driven(scope);
    scope.focus(rows[1]!);
    onFocusMove.mockClear();

    // The order a React unmount produces: the element tears itself down and
    // then leaves its parent's child list.
    rows[1]!.destroy();
    root.removeElement(rows[1]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[2]);
    expect(onFocusMove).toHaveBeenCalledWith(rows[2], null);
  });

  it("lights the first row to arrive after the scope took input", () => {
    const root = new TestNode();
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    expect(scope.focused).toBeNull();

    const row = root.add(new TestNode()).focusable();
    scope._tick(null);

    expect(scope.focused).toBe(row);
    expect(row.paints).toEqual([true]);
  });

  it("keeps a menu unlit after the game cleared focus itself", () => {
    const { root, rows } = column(2);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    expect(scope.focused).toBe(rows[0]);

    scope.focus(null);
    scope._tick(null);
    expect(scope.focused).toBeNull();

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(rows[0]);
  });

  it("keeps it unlit when a dialog over it gives the input back", () => {
    const { root, rows } = column(2);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);

    scope.focus(null);
    // A dialog opens over the menu and closes again.
    scope._releaseInput();
    scope._takeInput(null);

    expect(scope.focused).toBeNull();
    expect(rows[0]!.paints).toEqual([true, false]);

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(rows[0]);
  });
});

describe("UIFocusScope autoFocus", () => {
  it("lights nothing on taking input when it is off", () => {
    const { root, rows } = column(2);
    const scope = new UIFocusScope(hostOf(root), { autoFocus: false });
    driven(scope);

    expect(scope.focused).toBeNull();
    expect(rows[0]!.paints).toEqual([]);
    scope._tick(null);
    expect(scope.focused).toBeNull();

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(rows[0]);
  });

  it("still repaints an element it already remembers", () => {
    const { root, rows } = column(2);
    const scope = new UIFocusScope(hostOf(root), { autoFocus: false });
    scope.focus(rows[1]!);

    driven(scope);

    expect(scope.focused).toBe(rows[1]);
    expect(rows[1]!.paints).toEqual([true]);
  });
});

describe("UIFocusScope pointer focus", () => {
  it("leaves the keyboard's row alone when the pointer passes over another", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(rows[0]!);

    requestHoverFocus(rows[2]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[0]);
  });

  it("moves focus to the row the pointer pressed", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(rows[0]!);

    requestPressFocus(rows[2]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[2]);
  });

  it("follows the pointer over a row where the game asked it to", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), { pointerFocus: "hover" });
    driven(scope);
    scope.focus(rows[0]!);

    requestHoverFocus(rows[2]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[2]);
  });

  it("presses a row into focus in a scope that follows the pointer", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), { pointerFocus: "hover" });
    driven(scope);
    scope.focus(rows[0]!);

    requestPressFocus(rows[2]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[2]);
  });

  it("leaves focus to the keyboard where the game asked for none", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), { pointerFocus: "none" });
    driven(scope);
    scope.focus(rows[0]!);

    requestPressFocus(rows[2]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[0]);
  });

  it("takes the setting a later setOptions carries", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(rows[0]!);

    scope.setOptions({ pointerFocus: "hover" });
    requestHoverFocus(rows[2]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[2]);
  });

  it("keeps the setting through a setOptions that leaves it out", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), { pointerFocus: "none" });
    driven(scope);
    scope.focus(rows[0]!);

    scope.setOptions({ wrap: false });
    requestPressFocus(rows[2]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[0]);
  });

  it("consumes the request once, so the keyboard keeps the cursor", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);

    requestPressFocus(rows[0]!);
    scope._tick(null);
    scope.move("down");
    scope._tick(null);

    expect(scope.focused).toBe(rows[1]);
  });

  it("gives the request to the scope the pressed element belongs to", () => {
    const stage = new TestNode();
    const menu = stage.add(new TestNode());
    const behind = menu.add(new TestNode({ y: 0 })).focusable();
    const dialog = stage.add(new TestNode({ y: 200 }));
    dialog.add(new TestNode()).focusable();
    const menuScope = new UIFocusScope(hostOf(menu), {});
    // The panel holding the keys leaves the pointer alone, so a press really
    // did land on the menu behind it.
    const dialogScope = new UIFocusScope(hostOf(dialog), { modal: false });
    driven(dialogScope);

    // The dialog holds input, so it is the only scope that ticks; the pointer
    // pressed a row of the menu behind it.
    requestPressFocus(behind);
    dialogScope._tick(null);

    expect(menuScope.focused).toBe(behind);
    // Remembered, not lit: the menu reads no input while the dialog is up.
    expect(behind.paints).toEqual([]);
    expect(dialogScope.focused).not.toBe(behind);
  });

  it("answers for its own setting, not the driven scope's", () => {
    const stage = new TestNode();
    const menu = stage.add(new TestNode());
    const behind = menu.add(new TestNode({ y: 0 })).focusable();
    const dialog = stage.add(new TestNode({ y: 200 }));
    dialog.add(new TestNode()).focusable();
    const menuScope = new UIFocusScope(hostOf(menu), { pointerFocus: "none" });
    const dialogScope = new UIFocusScope(hostOf(dialog), { modal: false });
    driven(dialogScope);

    requestPressFocus(behind);
    dialogScope._tick(null);

    expect(menuScope.focused).toBeNull();
  });
});

describe("UIFocusScope pointer ownership", () => {
  /** The pointer blockers a scope put under `node`, in draw order. */
  function blockersUnder(node: TestNode): readonly MockContainer[] {
    return node.container.children.filter((child) =>
      isPointerConsumeContainer(child),
    );
  }

  /**
   * Clip a node's subtree, the way an `overflow: hidden` panel's mask does.
   * Pixi reads the mask on the container itself and prunes everything under
   * it for a point the mask does not hold.
   */
  function clip(node: TestNode): void {
    node.container.mask = new MockContainer();
  }

  /** Every pointer blocker anywhere under `node`, in tree order. */
  function blockersIn(node: TestNode): MockContainer[] {
    const found: MockContainer[] = [];
    const walk = (container: MockContainer): void => {
      for (const child of container.children) {
        if (isPointerConsumeContainer(child)) found.push(child);
        walk(child);
      }
    };
    walk(node.container);
    return found;
  }

  /** A point, in the local space of whichever container is being asked. */
  interface Point {
    x: number;
    y: number;
  }

  /** A hit area Pixi asks about before it looks at a container's children. */
  interface HitArea {
    contains(x: number, y: number): boolean;
  }

  function hitAreaOf(container: MockContainer): HitArea | undefined {
    const area = (container as unknown as { hitArea?: HitArea | null }).hitArea;
    return area ?? undefined;
  }

  /**
   * Give a node the hit area a scroll view's viewport carries over its whole
   * box, which Pixi asks about exactly as it asks a mask.
   */
  function coverWithHitArea(node: TestNode): void {
    (node.container as unknown as { hitArea: HitArea }).hitArea = {
      contains: (x, y) =>
        x >= 0 && y >= 0 && x <= node.width && y <= node.height,
    };
  }

  /** Whether `container` clips its subtree to the box its node draws. */
  function clipsToBox(container: MockContainer): boolean {
    const mask: MockContainer | null | undefined = container.mask;
    return mask !== null && mask !== undefined;
  }

  /** Whether `local` is inside the box the node at `container` draws. */
  function insideBox(container: MockContainer, local: Point): boolean {
    const node = nodesByContainer.get(container);
    if (node === undefined) return false;
    return (
      local.x >= 0 &&
      local.y >= 0 &&
      local.x <= node.width &&
      local.y <= node.height
    );
  }

  /**
   * The container a pointer at `local` reaches, walked the way Pixi walks a
   * tree: a container whose mask or hit area refuses the point is pruned
   * together with its whole subtree, and the children that survive answer
   * from the top of the z-order down. A node answers inside its own box, the
   * way a panel's hit surface does, and a blocker answers wherever it is
   * reached at all.
   */
  function hitTest(
    container: MockContainer,
    local: Point,
  ): MockContainer | null {
    if (clipsToBox(container) && !insideBox(container, local)) return null;
    const hitArea = hitAreaOf(container);
    if (hitArea !== undefined && !hitArea.contains(local.x, local.y)) {
      return null;
    }
    const children = container.children;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i]!;
      const found = hitTest(child, {
        x: local.x - child.position.x,
        y: local.y - child.position.y,
      });
      if (found !== null) return found;
    }
    if (hitArea !== undefined) return container;
    return insideBox(container, local) ? container : null;
  }

  /** The middle of `target`'s box, in `root`'s own space. */
  function middleOf(root: TestNode, target: TestNode): Point {
    const point = { x: target.width / 2, y: target.height / 2 };
    let container: MockContainer | null = target.container;
    while (container !== null && container !== root.container) {
      point.x += container.position.x;
      point.y += container.position.y;
      container = container.parent;
    }
    return point;
  }

  /** The container a pointer over the middle of `target` reaches. */
  function pointerOver(root: TestNode, target: TestNode): MockContainer | null {
    return hitTest(root.container, middleOf(root, target));
  }

  it("swallows the pointer around itself while it reads input", () => {
    const { root } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});

    driven(scope);

    // Under everything the scope draws, so its own rows answer the pointer
    // where they paint and every point around them reaches the blocker.
    expect(blockersUnder(root)).toEqual([root.container.children[0]]);
    expect(root.container.children).toHaveLength(4);
  });

  it("hands the pointer back when it stops reading input", () => {
    const { root } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);

    scope._releaseInput();

    expect(blockersUnder(root)).toEqual([]);
  });

  it("leaves the pointer alone where the game asked it to", () => {
    const { root } = column(3);
    const scope = new UIFocusScope(hostOf(root), { modal: false });

    driven(scope);

    expect(blockersUnder(root)).toEqual([]);
  });

  it("takes the setting a later setOptions carries, in both directions", () => {
    const { root } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);

    scope.setOptions({ modal: false });
    expect(blockersUnder(root)).toEqual([]);

    scope.setOptions({ modal: true });
    expect(blockersUnder(root)).toHaveLength(1);
  });

  it("keeps the setting through a setOptions that leaves it out", () => {
    const { root } = column(3);
    const scope = new UIFocusScope(hostOf(root), { modal: false });
    driven(scope);

    scope.setOptions({ wrap: false });

    expect(blockersUnder(root)).toEqual([]);
  });

  it("builds nothing for a scope that never reads input", () => {
    const { root } = column(3);
    new UIFocusScope(hostOf(root), { modal: true });

    expect(blockersUnder(root)).toEqual([]);
  });

  it("takes the blocker down with the scope", () => {
    const { root } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    const blocker = root.container.children[0]!;

    scope._destroy();

    expect(blockersUnder(root)).toEqual([]);
    expect(blocker.destroyed).toBe(true);
  });

  /** A menu row, and over it a dialog holding a row of its own. */
  function dialogInMenu(): {
    stage: TestNode;
    menu: TestNode;
    row: TestNode;
    dialog: TestNode;
    dialogRow: TestNode;
  } {
    const stage = new TestNode({ width: 400, height: 400 });
    const menu = stage.add(new TestNode({ width: 200, height: 300 }));
    const row = menu.add(new TestNode({ y: 0 })).focusable();
    const dialog = menu.add(new TestNode({ y: 200 }));
    const dialogRow = dialog.add(new TestNode()).focusable();
    return { stage, menu, row, dialog, dialogRow };
  }

  it("swallows a row behind a dialog that clips its own overflow", () => {
    const { stage, row, dialog, dialogRow } = dialogInMenu();
    clip(dialog);
    const scope = new UIFocusScope(hostOf(dialog), {});

    driven(scope);

    // A blocker inside the clip would answer only where the dialog draws —
    // the one region a modal scope needs no blocker for — because the clip is
    // read above it and prunes the whole subtree everywhere else.
    const blocker = blockersIn(stage)[0];
    expect(pointerOver(stage, row)).toBe(blocker);
    // The dialog's own rows sit above the blocker and answer first.
    expect(pointerOver(stage, dialogRow)).toBe(dialogRow.container);
  });

  it("swallows a row behind a clipping dialog inside a clipping panel", () => {
    const { stage, menu, row, dialog, dialogRow } = dialogInMenu();
    clip(dialog);
    clip(menu);
    const scope = new UIFocusScope(hostOf(dialog), {});

    driven(scope);

    // The menu's clip bounds its rows exactly as it bounds the dialog, so
    // the region it prunes holds nothing left to block and the blocker stays
    // inside it, answering for the rows the dialog is there to cover.
    const blocker = blockersIn(stage)[0];
    expect(pointerOver(stage, row)).toBe(blocker);
    expect(pointerOver(stage, dialogRow)).toBe(dialogRow.container);
  });

  it("swallows a row behind a dialog inside a clipping panel", () => {
    const { stage, menu, row, dialog, dialogRow } = dialogInMenu();
    // The panel around the dialog clips it without being its host.
    clip(menu);
    const scope = new UIFocusScope(hostOf(dialog), {});

    driven(scope);

    const blocker = blockersIn(stage)[0];
    expect(pointerOver(stage, row)).toBe(blocker);
    expect(pointerOver(stage, dialogRow)).toBe(dialogRow.container);
  });

  it("swallows a row behind a dialog inside a scroll view", () => {
    const stage = new TestNode({ width: 400, height: 400 });
    const list = stage.add(new TestScrollView({ width: 200, height: 100 }));
    // A viewport carries a hit area as well as its clip, and Pixi asks both
    // of them before it looks at anything the view holds.
    clip(list);
    coverWithHitArea(list);
    const row = list.add(new TestNode({ y: 0 })).focusable();
    const dialog = list.add(new TestNode({ y: 40, width: 80, height: 30 }));
    const dialogRow = dialog
      .add(new TestNode({ width: 80, height: 30 }))
      .focusable();
    const scope = new UIFocusScope(hostOf(dialog), {});

    driven(scope);

    const blocker = blockersIn(stage)[0];
    expect(pointerOver(stage, row)).toBe(blocker);
    expect(pointerOver(stage, dialogRow)).toBe(dialogRow.container);
  });

  it("re-seats a blocker whose host starts clipping while it is up", () => {
    const { menu, dialog } = dialogInMenu();
    const scope = new UIFocusScope(hostOf(dialog), {});
    driven(scope);
    expect(blockersUnder(dialog)).toHaveLength(1);

    clip(dialog);
    scope._tick(null);

    expect(blockersUnder(dialog)).toEqual([]);
    expect(blockersUnder(menu)).toHaveLength(1);
  });

  it("takes a blocker seated beside its host away when input is released", () => {
    const { stage, menu, dialog } = dialogInMenu();
    clip(dialog);
    const scope = new UIFocusScope(hostOf(dialog), {});
    driven(scope);

    scope._releaseInput();

    expect(blockersUnder(menu)).toEqual([]);
    expect(blockersUnder(stage)).toEqual([]);
  });

  it("takes a blocker seated beside its host down with the scope", () => {
    const { menu, dialog } = dialogInMenu();
    clip(dialog);
    const scope = new UIFocusScope(hostOf(dialog), {});
    driven(scope);
    const blocker = blockersUnder(menu)[0]!;

    scope._destroy();

    expect(blockersUnder(menu)).toEqual([]);
    expect(blocker.destroyed).toBe(true);
  });

  it("keeps a clipping host's blocker inside it when the host has no parent", () => {
    const { stage } = dialogInMenu();
    // Nothing to hang from outside the tree, so the blocker stays where it
    // can at least be taken down with the scope.
    clip(stage);
    const scope = new UIFocusScope(hostOf(stage), {});

    driven(scope);

    expect(blockersUnder(stage)).toHaveLength(1);
  });

  it("blocks only what is outside a nested scope", () => {
    const stage = new TestNode();
    const menu = stage.add(new TestNode());
    menu.add(new TestNode({ y: 0 })).focusable();
    const dialog = menu.add(new TestNode({ y: 200 }));
    dialog.add(new TestNode()).focusable();
    new UIFocusScope(hostOf(menu), {});
    const dialogScope = new UIFocusScope(hostOf(dialog), {});

    driven(dialogScope);

    expect(blockersUnder(dialog)).toHaveLength(1);
    expect(blockersUnder(menu)).toEqual([]);
  });

  it("drops a pointer request from outside the scope that owns the pointer", () => {
    const stage = new TestNode();
    const menu = stage.add(new TestNode());
    const behind = menu.add(new TestNode({ y: 0 })).focusable();
    const dialog = stage.add(new TestNode({ y: 200 }));
    dialog.add(new TestNode()).focusable();
    const menuScope = new UIFocusScope(hostOf(menu), {});
    const dialogScope = new UIFocusScope(hostOf(dialog), {});
    driven(dialogScope);

    // Pixi carries the event up from the blocker through the containers the
    // dialog hangs under, so a request can still arrive from outside.
    requestPressFocus(behind);
    dialogScope._tick(null);

    expect(menuScope.focused).toBeNull();
  });

  it("keeps a pointer request from one of its own rows", () => {
    const { root, rows } = column(3);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(rows[0]!);

    requestPressFocus(rows[2]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[2]);
  });
});

describe("UIFocusScope scroll follow", () => {
  it("scrolls the enclosing views innermost first", () => {
    const root = new TestNode();
    const outer = root.add(new TestScrollView({ height: 200 }));
    const inner = outer.add(new TestScrollView({ height: 100 }));
    const row = inner.add(new TestNode()).focusable();
    const order: string[] = [];
    vi.spyOn(inner, "scrollIntoView").mockImplementation(() =>
      order.push("inner"),
    );
    vi.spyOn(outer, "scrollIntoView").mockImplementation(() =>
      order.push("outer"),
    );
    const scope = new UIFocusScope(hostOf(root), { scrollPadding: 12 });

    scope.focus(row);

    expect(order).toEqual(["inner", "outer"]);
  });

  it("passes the scope's scroll padding", () => {
    const root = new TestNode();
    const list = root.add(new TestScrollView({ height: 100 }));
    const row = list.add(new TestNode()).focusable();
    const scope = new UIFocusScope(hostOf(root), { scrollPadding: 12 });

    scope.focus(row);

    expect(list.scrolled).toEqual([row]);
    expect(list.paddings).toEqual([12]);
  });

  it("keeps the player's offset when a row below the focused one comes or goes", () => {
    const root = new TestNode();
    const list = root.add(new TestScrollView({ height: 100 }));
    const row = list.add(new TestNode({ y: 0 })).focusable();
    list.add(new TestNode({ y: 200 })).focusable();
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(row);
    list.scrolled.length = 0;

    // A wheel or a drag pans the rows; the scope ticks afterwards, in the
    // same frame, and must not pull the list back to the focused row.
    list.scrollTo(60);
    scope._tick(null);
    expect(list.scrolled).toEqual([]);

    // A row appended below the focused one makes the content panel taller
    // and leaves the focused row and the viewport where they were.
    const appended = list.add(new TestNode({ y: 240 })).focusable();
    scope._tick(null);
    expect(list.scrolled).toEqual([]);

    // Taking that row away again makes the panel shorter, and moves the
    // focused row just as little.
    list.removeElement(appended);
    scope._tick(null);
    expect(list.scrolled).toEqual([]);
  });

  it("brings a focused row back after the viewport shrinks around it", () => {
    const root = new TestNode();
    const list = root.add(new TestScrollView({ height: 100 }));
    list.add(new TestNode({ y: 0 })).focusable();
    const row = list.add(new TestNode({ y: 80 })).focusable();
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(row);
    list.scrolled.length = 0;

    scope._tick(null);
    expect(list.scrolled).toEqual([]);

    // The viewport is resized under a row that was inside it.
    list.height = 40;
    scope._tick(null);

    expect(list.scrolled).toEqual([row]);
  });

  it("brings a focused row back after a row arrives above it", () => {
    const root = new TestNode();
    const list = root.add(new TestScrollView({ height: 100 }));
    const row = list.add(new TestNode({ y: 0 })).focusable();
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);
    scope.focus(row);
    list.scrolled.length = 0;

    scope._tick(null);
    expect(list.scrolled).toEqual([]);

    // A row arrives above the focused one, and the layout pass that follows
    // lays the focused row out past the fold.
    const above = new TestNode({ y: 0, height: 120 }).focusable();
    list.insertElementBefore(above, row);
    row.layoutAt(0, 120);
    list.relayout();
    scope._tick(null);

    expect(list.scrolled).toEqual([row]);
  });

  it("scrolls a row that takes focus below the fold into view", () => {
    const root = new TestNode();
    const list = root.add(new TestScrollView({ height: 100 }));
    const first = list.add(new TestNode({ y: 0 })).focusable();
    const below = list.add(new TestNode({ y: 120 })).focusable();
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(first);
    list.scrolled.length = 0;

    expect(scope.move("down")).toBe(true);

    expect(scope.focused).toBe(below);
    expect(list.scrolled).toEqual([below]);
  });

  it("throws on a non-finite scroll padding, naming the value", () => {
    const root = new TestNode();

    expect(() => new UIFocusScope(hostOf(root), { scrollPadding: -4 })).toThrow(
      "UIFocusScope: scrollPadding must be a finite number of pixels at or " +
        "above 0, got -4.",
    );
    const scope = new UIFocusScope(hostOf(root), {});
    expect(() => scope.setOptions({ scrollPadding: Number.NaN })).toThrow(
      "UIFocusScope.setOptions: scrollPadding must be a finite number of " +
        "pixels at or above 0, got NaN.",
    );
  });
});

describe("UIFocusScope scroll clipping", () => {
  /** A 140px list of 30px rows below a footer button. */
  function listAndFooter(): {
    root: TestNode;
    list: TestScrollView;
    rows: TestNode[];
    footer: TestNode;
  } {
    const root = new TestNode();
    const list = root.add(new TestScrollView({ y: 0, height: 140 }));
    const rows: TestNode[] = [];
    for (let i = 0; i < 8; i += 1) {
      rows.push(list.add(new TestNode({ y: i * 30 })).focusable());
    }
    const footer = root.add(new TestNode({ y: 300 })).focusable();
    return { root, list, rows, footer };
  }

  it("enters a list at the nearest row that is actually visible", () => {
    const { root, rows, footer } = listAndFooter();
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(footer);

    scope.move("up");

    // Rows sit at 0, 30, 60, 90, 120; the one at 120 is clipped to 120..140
    // and is the lowest a player can see. Rows at 150 and beyond are gone.
    expect(scope.focused).toBe(rows[4]);
  });

  it("reaches the next row below the fold from inside the list", () => {
    const { root, rows } = listAndFooter();
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(rows[4]!);

    scope.move("down");

    expect(scope.focused).toBe(rows[5]);
  });

  it("drops a row the offset has scrolled out of sight", () => {
    const { root, list, rows, footer } = listAndFooter();
    list.scrollTo(90);
    const scope = new UIFocusScope(hostOf(root), {});
    scope.focus(footer);

    scope.move("up");

    // With 90px panned away, rows 3..7 span the viewport; row 7 sits at
    // 210 - 90 = 120 and is the lowest visible one.
    expect(scope.focused).toBe(rows[7]);
  });
});

describe("UIFocusScope input", () => {
  it("polls the default action names", () => {
    const { root, rows } = column(3);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);
    expect(scope.focused).toBe(rows[0]);

    input.press("move-down");
    scope._tick(input);

    expect(scope.focused).toBe(rows[1]);
  });

  it("asks for repeats on a direction and never on confirm", () => {
    const { root } = column(2);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("move-down");
    scope._tick(input);
    expect(input.queries).toEqual([{ repeat: true }]);

    input.release("move-down");
    input.press("interact");
    scope._tick(input);
    expect(input.queries).toEqual([{ repeat: true }, undefined]);
  });

  it("carries the repeat cadence a game asked for", () => {
    const { root } = column(2);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {
      input: { repeat: { delay: 0.6, interval: 0.04 } },
    });
    scope._takeInput(input);

    input.press("move-down");
    scope._tick(input);

    expect(input.queries).toEqual([
      { repeat: true, repeatDelay: 0.6, repeatInterval: 0.04 },
    ]);
  });

  it("leaves the interval out when only a delay is named", () => {
    const { root } = column(2);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {
      input: { repeat: { delay: 0.6 } },
    });
    scope._takeInput(input);

    input.press("move-down");
    scope._tick(input);

    expect(input.queries).toEqual([{ repeat: true, repeatDelay: 0.6 }]);
  });

  it("asks for no repeat at all when the game turned it off", () => {
    const { root, rows } = column(2);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), { input: { repeat: false } });
    scope._takeInput(input);

    input.press("move-down");
    scope._tick(input);

    expect(input.queries).toEqual([undefined]);
    expect(scope.focused).toBe(rows[1]);
  });

  it("reads the renamed roles a game supplies, one name or a list", () => {
    const { root, rows } = column(2);
    const input = new StubInput();
    input.actions.add("attack").add("menu-down");
    const scope = new UIFocusScope(hostOf(root), {
      input: { down: "menu-down", confirm: ["interact", "attack"] },
    });
    scope._takeInput(input);

    input.press("menu-down");
    scope._tick(input);
    expect(scope.focused).toBe(rows[1]);

    input.release("menu-down");
    input.press("attack");
    scope._tick(input);
    // The press follows the name that opened it, so holding that name keeps
    // the action from running.
    scope._tick(input);
    expect(rows[1]!.activations).toBe(0);

    input.release("attack");
    scope._tick(input);
    expect(rows[1]!.activations).toBe(1);
  });

  it("resolves one direction per tick on a diagonal", () => {
    const root = new TestNode();
    const origin = root
      .add(new TestNode({ x: 0, y: 0, width: 40 }))
      .focusable();
    const below = root
      .add(new TestNode({ x: 0, y: 40, width: 40 }))
      .focusable();
    root.add(new TestNode({ x: 60, y: 0, width: 40 })).focusable();
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);
    scope.focus(origin);

    input.press("move-down", "move-right");
    scope._tick(input);

    expect(scope.focused).toBe(below);
  });

  it("presses no row when the same tick moved focus off the one confirm aimed at", () => {
    const { root, rows } = column(3);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);
    scope.focus(rows[0]!);

    input.press("move-down", "interact");
    scope._tick(input);
    input.release("move-down", "interact");
    scope._tick(input);

    expect(scope.focused).toBe(rows[1]);
    expect(rows[0]!.activations).toBe(0);
    expect(rows[1]!.activations).toBe(0);
  });

  it("gives confirm the frame when cancel lands with it", () => {
    const onCancel = vi.fn();
    const { root, rows } = column(1);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), { onCancel });
    scope._takeInput(input);

    input.press("interact", "cancel");
    scope._tick(input);
    input.release("interact", "cancel");
    scope._tick(input);

    expect(rows[0]!.activations).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("warns once for a role no action in the map answers to", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = column(1);
    const input = new StubInput();
    input.actions.delete("move-up");
    const scope = new UIFocusScope(hostOf(root), {});

    scope._takeInput(input);
    scope._releaseInput();
    scope._takeInput(input);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('"move-up"');
    expect(warn.mock.calls[0]?.[0]).toContain("focus.input.up");
  });
});

describe("UIFocusScope press latch", () => {
  it("ignores the held press that opened the menu", () => {
    const { root, rows } = column(2);
    const input = new StubInput();
    input.press("interact");
    const scope = new UIFocusScope(hostOf(root), {});

    scope._takeInput(input);
    scope._tick(input);

    expect(rows[0]!.activations).toBe(0);

    input.release("interact");
    scope._tick(input);
    input.press("interact");
    scope._tick(input);
    input.release("interact");
    scope._tick(input);

    expect(rows[0]!.activations).toBe(1);
  });

  it("ignores a press that arrived and released inside one frame", () => {
    const { root, rows } = column(2);
    const input = new StubInput();
    input.tap("interact");
    const scope = new UIFocusScope(hostOf(root), {});

    scope._takeInput(input);
    scope._tick(input);

    expect(rows[0]!.activations).toBe(0);
  });

  it("latches again every time the scope takes input back", () => {
    const { root, rows } = column(3);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);
    scope.focus(rows[0]!);

    scope._releaseInput();
    input.press("move-down");
    scope._takeInput(input);
    scope._tick(input);

    expect(scope.focused).toBe(rows[0]);
  });
});

describe("UIFocusScope confirm press", () => {
  it("paints the press while confirm is held and acts on the release", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    expect(row.presses).toEqual([true]);
    expect(row.activations).toBe(0);

    // Held for two more frames: the press stays painted and nothing runs.
    scope._tick(input);
    scope._tick(input);
    expect(row.presses).toEqual([true]);
    expect(row.activations).toBe(0);

    input.release("interact");
    scope._tick(input);
    expect(row.presses).toEqual([true, false]);
    expect(row.activations).toBe(1);
  });

  it("keeps a confirm press when the pointer presses the focused row", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    input.settle();
    // The pointer lands on the row the confirm is already held on, so there
    // is nothing for the press phase to fight over.
    requestPressFocus(row);
    scope._tick(input);
    expect(row.presses).toEqual([true]);

    input.release("interact");
    scope._tick(input);
    expect(row.presses).toEqual([true, false]);
    expect(row.activations).toBe(1);
  });

  it("drops a confirm press when the pointer presses another row", () => {
    const { root, rows } = column(2);
    const held = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    input.settle();
    requestPressFocus(rows[1]!);
    scope._tick(input);
    expect(scope.focused).toBe(rows[1]);
    expect(held.presses).toEqual([true, false]);

    // The row the confirm left runs nothing, the way a pointer release
    // outside the button it pressed runs nothing.
    input.release("interact");
    scope._tick(input);
    expect(held.activations).toBe(0);
    expect(rows[1]!.activations).toBe(0);
  });

  it("runs the action once however long confirm is held", () => {
    const onActivate = vi.fn();
    const { root, rows } = column(2);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), { onActivate });
    scope._takeInput(input);

    input.press("interact");
    for (let i = 0; i < 5; i += 1) scope._tick(input);
    input.release("interact");
    scope._tick(input);
    scope._tick(input);

    expect(rows[0]!.activations).toBe(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("walks no menu underneath a held confirm", () => {
    const { root, rows } = column(3);
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    input.press("move-down");
    scope._tick(input);

    expect(scope.focused).toBe(rows[0]);
  });

  it("runs the action when the press and its release land in one window", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    // A quick tap, or a scripted key press: one drain carries both edges.
    input.tap("interact");
    scope._tick(input);

    expect(row.activations).toBe(1);
    expect(row.presses).toEqual([true, false]);
  });

  it("runs nothing when the window loses focus under a held confirm", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    expect(row.presses).toEqual([true]);

    // The window lost focus, so every held key was dropped with the player
    // still holding this one.
    input.forceRelease("interact");
    scope._tick(input);

    expect(row.presses).toEqual([true, false]);
    expect(row.activations).toBe(0);
  });

  it("runs nothing when the confirm action's group is switched off", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);

    input.silence("interact");
    scope._tick(input);

    expect(row.presses).toEqual([true, false]);
    expect(row.activations).toBe(0);
  });

  it("runs nothing when physical state is cleared under the press", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);

    input.clearAll();
    scope._tick(input);

    expect(row.presses).toEqual([true, false]);
    expect(row.activations).toBe(0);
  });

  it("drops the press and runs nothing when focus leaves the element", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    scope.focus(rows[1]!);
    expect(row.presses).toEqual([true, false]);

    input.release("interact");
    scope._tick(input);
    expect(row.activations).toBe(0);
    expect(rows[1]!.activations).toBe(0);
  });

  it("drops the press when the element is hidden under it", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    row.visible = false;
    scope._tick(input);
    expect(row.presses).toEqual([true, false]);

    input.release("interact");
    scope._tick(input);
    expect(row.activations).toBe(0);
  });

  it("drops the press with no repaint when the element is destroyed", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    row.destroy();
    root.removeElement(row);
    scope._tick(input);

    input.release("interact");
    scope._tick(input);
    expect(row.presses).toEqual([true]);
    expect(row.activations).toBe(0);
  });

  it("drops the press when the scope stops reading input", () => {
    const { root, rows } = column(2);
    const row = rows[0]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    scope._releaseInput();
    expect(row.presses).toEqual([true, false]);

    input.release("interact");
    scope._takeInput(input);
    scope._tick(input);
    expect(row.activations).toBe(0);
  });

  it("acts on the release for an element that paints no press", () => {
    const root = new TestNode();
    const row = root
      .add(new TestNode())
      .focusable({}, { setPressed: undefined });
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    expect(row.presses).toEqual([]);

    input.release("interact");
    scope._tick(input);
    expect(row.activations).toBe(1);
  });

  it("presses nothing on a row a focus callback disabled", () => {
    const { root, rows } = column(2);
    const row = rows[1]!;
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {
      onFocusMove: (element) => {
        if (element === row) row.disabled = true;
      },
    });
    scope._takeInput(input);

    // The pointer press moves focus onto the row inside this tick, and the
    // game's own handler takes the row out of reach before confirm is read.
    requestPressFocus(row);
    input.press("interact");
    scope._tick(input);
    expect(row.presses).toEqual([]);

    input.release("interact");
    scope._tick(input);
    expect(row.activations).toBe(0);
  });

  it("paints nothing for a scope activated from game code", () => {
    const { root, rows } = column(1);
    const scope = new UIFocusScope(hostOf(root), {});
    driven(scope);

    scope.activate();

    expect(rows[0]!.presses).toEqual([]);
    expect(rows[0]!.activations).toBe(1);
  });
});

describe("UIFocusScope captured input", () => {
  /** A holder and one plain row under it, with the scope already driven. */
  function held(options: { takesDirections?: boolean } = {}): {
    holder: TestHolder;
    row: TestNode;
    input: StubInput;
    scope: UIFocusScope;
  } {
    const root = new TestNode();
    const holder = root.add(new TestHolder({ y: 0, ...options }));
    holder.focusable();
    const row = root.add(new TestNode({ y: 30 })).focusable();
    const input = new StubInput();
    const scope = new UIFocusScope(hostOf(root), {});
    scope._takeInput(input);
    scope.focus(holder);
    holder.start();
    return { holder, row, input, scope };
  }

  it("hands every direction to the holder instead of walking the menu", () => {
    const { holder, scope, input } = held();

    input.press("move-down");
    scope._tick(input);
    expect(holder.moves).toEqual(["down"]);
    expect(scope.focused).toBe(holder);

    input.release("move-down");
    input.press("move-left");
    scope._tick(input);
    expect(holder.moves).toEqual(["down", "left"]);
    expect(scope.focused).toBe(holder);
  });

  it("moves focus to a holder that took the input while another row held it", () => {
    const { holder, row, scope, input } = held();
    holder.stop();
    scope.focus(row);

    holder.start();
    scope._tick(input);

    expect(scope.focused).toBe(holder);
    input.press("interact");
    scope._tick(input);
    expect(holder.confirms).toBe(1);
  });

  it("keeps a direction a holder that takes none was handed", () => {
    const { holder, scope, input } = held({ takesDirections: false });

    input.press("move-down");
    scope._tick(input);
    expect(scope.focused).toBe(holder);
    expect(holder.moves).toEqual([]);
  });

  it("sends confirm and cancel to the holder, not to the menu", () => {
    const onCancel = vi.fn();
    const { holder, scope, input } = held();
    scope.setOptions({ onCancel });

    input.press("cancel");
    scope._tick(input);
    expect(holder.cancels).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();

    input.release("cancel");
    holder.start();
    input.press("interact");
    scope._tick(input);
    expect(holder.confirms).toBe(1);
    expect(holder.activations).toBe(0);
  });

  it("paints no press on the holder a confirm reaches", () => {
    const { holder, scope, input } = held();

    input.press("interact");
    scope._tick(input);
    expect(holder.confirms).toBe(1);
    expect(holder.presses).toEqual([]);

    // The release finds no press to resolve, so nothing is activated.
    input.release("interact");
    scope._tick(input);
    expect(holder.activations).toBe(0);
  });

  it("re-latches when the hold ends, so a held key does not move focus", () => {
    const { holder, row, scope, input } = held();

    // A direction held while confirm ends the capture. The end wins, and the
    // direction reaches neither the holder nor the menu.
    input.press("move-down", "interact");
    scope._tick(input);
    expect(holder.confirms).toBe(1);
    expect(holder.moves).toEqual([]);
    expect(scope.focused).toBe(holder);

    // The hold keeps producing edges, the way a repeat does.
    input.press("move-down");
    scope._tick(input);
    expect(scope.focused).toBe(holder);

    input.release("move-down");
    scope._tick(input);
    input.press("move-down");
    scope._tick(input);
    expect(scope.focused).toBe(row);
  });

  it("takes its input back when focus leaves the holder", () => {
    const { holder, row, scope } = held();

    scope.focus(row);
    expect(holder.releases).toBe(1);
    expect(holder.cancels).toBe(0);
    expect(scope.focused).toBe(row);
  });

  it("takes its input back when the holder is hidden under it", () => {
    const { holder, scope, input } = held();

    holder.visible = false;
    scope._tick(input);
    expect(holder.releases).toBe(1);
  });

  it("takes its input back when the scope stops reading input", () => {
    const { holder, scope } = held();

    scope._releaseInput();
    expect(holder.releases).toBe(1);
  });

  it("takes its input back when the game clears focus", () => {
    const { holder, scope, input } = held();
    scope._tick(input);

    scope.focus(null);
    expect(holder.releases).toBe(1);
  });

  it("asks nothing of a holder that gave the input back on its own", () => {
    const { holder, scope, input } = held();
    scope._tick(input);

    // A mouse click closed the list, or ended the edit, between two frames.
    holder.stop();
    scope.focus(null);
    expect(holder.releases).toBe(0);
  });

  it("routes move, activate and cancel through the holder with no device", () => {
    const onCancel = vi.fn();
    const root = new TestNode();
    const holder = root.add(new TestHolder({ y: 0 }));
    holder.focusable();
    root.add(new TestNode({ y: 30 })).focusable();
    const scope = new UIFocusScope(hostOf(root), { input: null, onCancel });
    scope._takeInput(null);
    scope.focus(holder);
    holder.start();

    expect(scope.move("down")).toBe(true);
    expect(holder.moves).toEqual(["down"]);
    expect(scope.focused).toBe(holder);

    scope.activate();
    expect(holder.confirms).toBe(1);
    expect(holder.activations).toBe(0);

    holder.start();
    scope.cancel();
    expect(holder.cancels).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("UIFocusScope with no device", () => {
  it("drives through move, activate and cancel with input null", () => {
    const onCancel = vi.fn();
    const { root, rows } = column(2);
    const scope = new UIFocusScope(hostOf(root), { input: null, onCancel });
    scope._takeInput(null);

    expect(scope.focused).toBe(rows[0]);
    scope.move("down");
    expect(scope.focused).toBe(rows[1]);
    scope.activate();
    expect(rows[1]!.activations).toBe(1);
    scope.cancel();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(scope._pollsDevice).toBe(false);
  });

  it("warns about nothing, since it asked for no action map", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = column(1);
    const scope = new UIFocusScope(hostOf(root), { input: null });

    scope._takeInput(null);
    scope._tick(null);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("UIFocusScope input handover", () => {
  it("paints and announces only while it holds input", () => {
    const onFocusChange = vi.fn();
    const root = new TestNode();
    const row = root.add(new TestNode()).focusable({ onFocusChange });
    const scope = new UIFocusScope(hostOf(root), {});

    scope.focus(row);
    expect(row.paints).toEqual([]);
    expect(onFocusChange).not.toHaveBeenCalled();

    scope._takeInput(null);
    expect(row.paints).toEqual([true]);
    expect(onFocusChange).toHaveBeenCalledWith(true);

    scope._releaseInput();
    expect(row.paints).toEqual([true, false]);
    expect(onFocusChange).toHaveBeenLastCalledWith(false);
    expect(scope.focused).toBe(row);
  });

  it("reports whether its host is on screen", () => {
    const stage = new TestNode();
    const root = stage.add(new TestNode());
    const scope = new UIFocusScope(hostOf(root), {});

    expect(scope._isShown()).toBe(true);
    stage.visible = false;
    expect(scope._isShown()).toBe(false);
    stage.visible = true;
    root.visible = false;
    expect(scope._isShown()).toBe(false);
  });

  it("announces the move with both elements", () => {
    const onFocusMove = vi.fn();
    const { root, rows } = column(2);
    const scope = new UIFocusScope(hostOf(root), { onFocusMove });

    scope.focus(rows[0]!);
    scope.move("down");

    expect(onFocusMove.mock.calls).toEqual([
      [rows[0], null],
      [rows[1], rows[0]],
    ]);
  });
});

describe("UIFocusScope.setOptions", () => {
  it("applies each key by presence and keeps the focused element", () => {
    const { root, rows } = column(3);
    const onMoveBlocked = vi.fn();
    const scope = new UIFocusScope(hostOf(root), { onMoveBlocked });
    scope.focus(rows[2]!);

    scope.setOptions({ wrap: false });

    expect(scope.focused).toBe(rows[2]);
    expect(scope.move("down")).toBe(false);
    expect(onMoveBlocked).toHaveBeenCalledWith("down");
  });

  it("rejects a repeat cadence that cannot produce edges", () => {
    const { root } = column(1);
    const scope = new UIFocusScope(hostOf(root), {});

    expect(() =>
      scope.setOptions({ input: { repeat: { interval: 0 } } }),
    ).toThrow(
      "UIFocusScope.setOptions: input.repeat.interval must be a finite " +
        "number of seconds above 0, got 0.",
    );
    expect(() =>
      scope.setOptions({ input: { repeat: { delay: -1 } } }),
    ).toThrow(
      "UIFocusScope.setOptions: input.repeat.delay must be a finite number " +
        "of seconds at or above 0, got -1.",
    );
  });
});
