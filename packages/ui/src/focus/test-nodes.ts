/**
 * Element doubles the focus test files share: a laid-out node, a scroll view,
 * an element that captures its scope's input, and a scripted input source.
 */
import type { Node as YogaNode } from "yoga-layout";
import type { DisplayContainer } from "@yagejs/renderer";
import { MockContainer } from "../test-helpers.js";
import type {
  FocusDirection,
  FocusProps,
  UIContainerElement,
  UIElement,
  UIFocusScopeOptions,
  UIScrollIntoViewOptions,
} from "../types.js";
import { FocusState } from "./FocusState.js";
import type { FocusBehavior } from "./FocusState.js";
import { markScrollView } from "./scroll-registry.js";
import { captureFocusInput } from "./input-capture.js";
import type { UIInputCaptureElement } from "./input-capture.js";
import { UIFocusScope } from "./UIFocusScope.js";
import type { UIFocusInputSource, UIFocusScopeHost } from "./UIFocusScope.js";

export interface NodeOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** A Pixi container, a laid-out Yoga box, and optionally a focus state. */
export class TestNode implements UIContainerElement {
  readonly container = new MockContainer();
  readonly children: UIElement[] = [];
  width: number;
  height: number;
  /** Where the laid-out box sits inside its parent's, as Yoga reports it. */
  left: number;
  top: number;
  yogaParent: TestNode | null = null;
  state: FocusState | undefined;
  paints: boolean[] = [];
  presses: boolean[] = [];
  activations = 0;
  disabled = false;

  // One stable object: the scroll follow compares Yoga nodes by identity.
  private readonly _yoga: YogaNode;

  constructor(options: NodeOptions = {}) {
    this.width = options.width ?? 100;
    this.height = options.height ?? 20;
    this.left = options.x ?? 0;
    this.top = options.y ?? 0;
    this.container.position.set(this.left, this.top);
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

/**
 * A node the scope treats as a scroll view. The rows hang in `content`, a
 * Yoga box between the view and every row and the container the scroll offset
 * moves, while `children` reaches the rows directly.
 */
export class TestScrollView extends TestNode {
  readonly scrolled: UIElement[] = [];
  readonly paddings: (number | undefined)[] = [];
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

/** A node that takes its scope's input, as a field with the caret does. */
export class TestHolder extends TestNode implements UIInputCaptureElement {
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

  stop(): void {
    captureFocusInput(this, false);
  }
}

export function hostOf(root: TestNode): UIFocusScopeHost {
  return {
    displayObject: root.displayObject,
    roots: () => root.children,
  };
}

/** A scope over `root`'s children. */
export function scopeOver(
  root: TestNode,
  options: UIFocusScopeOptions = {},
): UIFocusScope {
  return new UIFocusScope(hostOf(root), options);
}

/** A column of `count` focusable rows, 100×20 each, 30px apart. */
export function column(
  count: number,
  ids?: readonly string[],
): { root: TestNode; rows: TestNode[] } {
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

const DEFAULT_ACTIONS = [
  "move-up",
  "move-down",
  "move-left",
  "move-right",
  "interact",
  "cancel",
];

/** What a scope asks `isJustPressed` for, as recorded by the stub. */
export type PressQuery =
  | { repeat?: boolean; repeatDelay?: number; repeatInterval?: number }
  | undefined;

export class StubInput implements UIFocusInputSource {
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

  /** Held state the engine drops while the player still holds the key. */
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
