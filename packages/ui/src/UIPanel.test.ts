import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    eventMode = "auto";
    cursor = "default";
    mask: MockContainer | null = null;

    setMask(opts: { mask: MockContainer | null }): void {
      this.mask = opts.mask;
    }

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }

    addChildAt(child: MockContainer, index: number): MockContainer {
      this.children.splice(index, 0, child);
      child.parent = this;
      return child;
    }

    removeChild(child: MockContainer): MockContainer {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parent = null;
      }
      return child;
    }

    removeFromParent(): void {
      this.parent?.removeChild(this);
    }

    private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    on(event: string, fn: (...args: unknown[]) => void): this {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      const listeners = this._listeners.get(event);
      if (!listeners) return;
      for (const fn of listeners) fn(...args);
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rect(...args: unknown[]): MockGraphics {
      return this;
    }
    /** The corner radius of the most recent rounded draw. */
    lastRadius: number | undefined;
    /** The rectangle of the most recent rounded draw. */
    lastRect:
      | { x: number; y: number; width: number; height: number; radius?: number }
      | undefined;
    roundRect(
      x: number,
      y: number,
      width: number,
      height: number,
      radius?: number,
    ): MockGraphics {
      this.lastRadius = radius;
      this.lastRect = {
        x,
        y,
        width,
        height,
        ...(radius === undefined ? {} : { radius }),
      };
      return this;
    }
    /** The style passed to the most recent `fill`. */
    lastFill: { color?: number; alpha?: number } | undefined;
    fill(style?: { color?: number; alpha?: number }): MockGraphics {
      this.lastFill = style;
      return this;
    }
    /** The style passed to the most recent `stroke`. */
    lastStroke: { color?: number; width?: number } | undefined;
    stroke(style?: { color?: number; width?: number }): MockGraphics {
      this.lastStroke = style;
      return this;
    }
  }

  class MockRectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  }

  return { mocks: { MockContainer, MockGraphics, MockRectangle } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Rectangle: mocks.MockRectangle,
}));

import Yoga, { Direction } from "yoga-layout";
import type { Node as YogaNode } from "yoga-layout";
import { Container } from "pixi.js";
import { isPointerConsumeContainer } from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";
import { createYogaNode, setYoga } from "./yoga-helpers.js";
import { UIPanel } from "./UIPanel.js";
import type { FocusProps, UIElement } from "./types.js";
import type { UITreeContext } from "./internal/tree-context.js";
import { FocusState, getFocusState } from "./focus/FocusState.js";
import { setUIFocusStyle } from "./internal/focus-outline.js";
import { takePointerRequest } from "./focus/pointer-request.js";
import { UIFocusStack } from "./focus/UIFocusStack.js";

beforeAll(() => {
  setYoga(Yoga);
});

/** A leaf that records whether it currently holds a tree context. */
class TreeContextProbe implements UIElement {
  readonly displayObject: DisplayContainer;
  readonly yogaNode: YogaNode;
  attached = false;
  /** How many times the tree has taken the context away. */
  detachments = 0;

  constructor() {
    this.displayObject = new Container();
    this.yogaNode = createYogaNode();
  }

  get visible(): boolean {
    return this.displayObject.visible;
  }

  set visible(v: boolean) {
    this.displayObject.visible = v;
  }

  update(): void {}

  destroy(): void {
    this.yogaNode.free();
    this.displayObject.destroy();
  }

  _attachToTree(): void {
    this.attached = true;
  }

  _detachFromTree(): void {
    this.attached = false;
    this.detachments += 1;
  }
}

/** A focusable leaf, the way an interactive primitive builds one. */
class FocusProbe implements UIElement {
  readonly displayObject: DisplayContainer;
  readonly yogaNode: YogaNode;
  readonly focus: FocusState;

  constructor(props: FocusProps = {}) {
    this.displayObject = new Container();
    this.yogaNode = createYogaNode();
    this.yogaNode.setWidth(100);
    this.yogaNode.setHeight(20);
    this.focus = new FocusState(this, props, { focusableByDefault: true });
  }

  get visible(): boolean {
    return this.displayObject.visible;
  }

  set visible(v: boolean) {
    this.displayObject.visible = v;
  }

  update(): void {}

  destroy(): void {
    this.focus.destroy();
    this.yogaNode.free();
    this.displayObject.destroy();
  }
}

/** The context a mounted tree would hand the panel under test. */
function mountedContext(focusStack: UIFocusStack | null = null): UITreeContext {
  return { label: "Hud", focusStack };
}

describe("UIPanel tree context", () => {
  it("attaches a child added after the panel joined a tree", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext());
    const probe = new TreeContextProbe();

    panel.addElement(probe);

    expect(probe.attached).toBe(true);
  });

  it("attaches the children a panel already held", () => {
    const panel = new UIPanel({});
    const probe = new TreeContextProbe();
    panel.addElement(probe);
    expect(probe.attached).toBe(false);

    panel._attachToTree(mountedContext());

    expect(probe.attached).toBe(true);
  });

  it("detaches a child removed from the panel", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext());
    const probe = new TreeContextProbe();
    panel.addElement(probe);

    panel.removeElement(probe);

    expect(probe.attached).toBe(false);
  });

  it("leaves an element that was never a child alone", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext());
    const other = new UIPanel({});
    const probe = new TreeContextProbe();
    other._attachToTree(mountedContext());
    other.addElement(probe);

    panel.removeElement(probe);

    expect(probe.attached).toBe(true);
  });

  it("stops attaching children once the panel leaves the tree", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext());
    panel._detachFromTree();
    const probe = new TreeContextProbe();

    panel.addElement(probe);

    expect(probe.attached).toBe(false);
  });

  it("detaches the whole subtree when the panel is destroyed", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext());
    const nested = panel.panel();
    const probe = new TreeContextProbe();
    nested.addElement(probe);
    expect(probe.attached).toBe(true);

    panel.destroy();

    expect(probe.attached).toBe(false);
  });

  it("visits each element once while the tree is destroyed", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext());
    const nested = panel.panel();
    const probe = new TreeContextProbe();
    nested.addElement(probe);

    panel.destroy();

    expect(probe.detachments).toBe(1);
  });
});

describe("UIPanel focus scope", () => {
  /** A panel holding one focusable child, laid out and ready to navigate. */
  function mountedPanel(stack: UIFocusStack): {
    panel: UIPanel;
    probe: FocusProbe;
  } {
    const panel = new UIPanel({ focus: true, width: 200, height: 100 });
    const probe = new FocusProbe();
    panel.addElement(probe);
    panel._attachToTree(mountedContext(stack));
    panel.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    return { panel, probe };
  }

  it("carries no scope without the option", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext(new UIFocusStack()));

    expect(panel.focusScope).toBeNull();
  });

  it("builds the scope when the tree context arrives after the option", () => {
    const stack = new UIFocusStack();
    const panel = new UIPanel({ focus: true });
    expect(panel.focusScope).toBeNull();

    panel._attachToTree(mountedContext(stack));

    expect(panel.focusScope).not.toBeNull();
    expect(stack._observe()).toBe(true);
  });

  it("builds the scope when the option arrives after the tree context", () => {
    const stack = new UIFocusStack();
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext(stack));

    panel.update({ focus: { wrap: false } });

    expect(panel.focusScope).not.toBeNull();
    expect(stack._observe()).toBe(true);
  });

  it("moves the scope when the tree hands it a different stack", () => {
    const first = new UIFocusStack();
    const second = new UIFocusStack();
    const panel = new UIPanel({ focus: true });
    panel._attachToTree(mountedContext(first));
    const scope = panel.focusScope;

    panel._attachToTree(mountedContext(second));

    expect(panel.focusScope).toBe(scope);
    expect(first._observe()).toBe(false);
    expect(second._observe()).toBe(true);
  });

  it("refreshes a fresh options object without rebuilding the scope", () => {
    const stack = new UIFocusStack();
    const { panel, probe } = mountedPanel(stack);
    const scope = panel.focusScope!;
    scope.focus(probe);
    const onCancel = vi.fn();

    panel.update({ focus: { wrap: true, onCancel } });

    expect(panel.focusScope).toBe(scope);
    expect(scope.focused).toBe(probe);
    scope.cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("drops a callback a later options object leaves out", () => {
    const stack = new UIFocusStack();
    const { panel } = mountedPanel(stack);
    const onCancel = vi.fn();
    panel.update({ focus: { onCancel } });

    panel.update({ focus: {} });

    panel.focusScope!.cancel();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("disposes the scope when the option is removed", () => {
    const stack = new UIFocusStack();
    const { panel } = mountedPanel(stack);

    panel.update({ focus: undefined });

    expect(panel.focusScope).toBeNull();
    expect(stack._observe()).toBe(false);
  });

  it("disposes the scope when the option turns false", () => {
    const stack = new UIFocusStack();
    const { panel } = mountedPanel(stack);

    panel.update({ focus: false });

    expect(panel.focusScope).toBeNull();
    expect(stack._observe()).toBe(false);
  });

  it("unregisters the scope of a panel removed from its parent", () => {
    const stack = new UIFocusStack();
    const parent = new UIPanel({});
    parent._attachToTree(mountedContext(stack));
    const child = parent.panel({ focus: true });
    expect(stack._observe()).toBe(true);

    parent.removeElement(child);

    expect(child.focusScope).toBeNull();
    expect(stack._observe()).toBe(false);
  });

  it("unregisters the scope of a destroyed panel", () => {
    const stack = new UIFocusStack();
    const { panel } = mountedPanel(stack);

    panel.destroy();

    expect(panel.focusScope).toBeNull();
    expect(stack._observe()).toBe(false);
  });

  it("reports the scope's input state to the Inspector", () => {
    const stack = new UIFocusStack();
    const { panel } = mountedPanel(stack);
    const inspect = (): unknown =>
      (panel as unknown as { _inspectState(): unknown })._inspectState();

    expect(inspect()).toEqual({
      focusScope: { hasInput: false },
      focused: false,
      focusable: false,
    });

    stack._observe();
    stack._drive(null);

    expect(inspect()).toEqual({
      focusScope: { hasInput: true },
      focused: false,
      focusable: false,
    });
  });

  it("reports itself focused only once the scope it sits in focuses it", () => {
    const stack = new UIFocusStack();
    const panel = new UIPanel({
      focus: { autoFocus: false },
      width: 200,
      height: 100,
    });
    const row = panel.panel({ focusable: true, width: 200, height: 30 });
    panel._attachToTree(mountedContext(stack));
    panel.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    const scope = panel.focusScope!;
    stack._observe();
    stack._drive(null);
    const inspect = (): unknown =>
      (row as unknown as { _inspectState(): unknown })._inspectState();

    expect(inspect()).toEqual({
      focusScope: null,
      focused: false,
      focusable: true,
    });

    scope.focus(row);

    expect(inspect()).toEqual({
      focusScope: null,
      focused: true,
      focusable: true,
    });
  });

  it("warns when the tree it joins has no focus stack", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const panel = new UIPanel({ focus: true });

    panel._attachToTree(mountedContext(null));

    expect(panel.focusScope).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('the "Hud" UI tree');
    warn.mockRestore();
  });
});

describe("UIPanel pointer ownership", () => {
  /** A panel with a background, a row of its own, and a scope driving it. */
  function scopedPanel(props: FocusProps & { focus?: unknown } = {}): {
    panel: UIPanel;
    stack: UIFocusStack;
    row: FocusProbe;
    children: InstanceType<typeof mocks.MockContainer>[];
  } {
    const stack = new UIFocusStack();
    const panel = new UIPanel({
      focus: true,
      background: { color: 0x101018 },
      width: 200,
      height: 100,
      ...props,
    });
    const row = new FocusProbe();
    panel.addElement(row);
    panel._attachToTree(mountedContext(stack));
    panel.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    stack._observe();
    stack._drive(null);
    const children = (
      panel.container as unknown as InstanceType<typeof mocks.MockContainer>
    ).children;
    return { panel, stack, row, children };
  }

  it("puts the blocker below everything the panel draws", () => {
    const { row, children } = scopedPanel();

    const blockers = children.filter((child) =>
      isPointerConsumeContainer(child),
    );
    expect(blockers).toHaveLength(1);
    // Pixi asks the last child first, so the panel's own row and its hit
    // surface answer the pointer before the blocker does.
    expect(children[0]).toBe(blockers[0]);
    expect(children.indexOf(row.displayObject as never)).toBe(
      children.length - 1,
    );
  });

  it("leaves the pointer alone where the panel asked it to", () => {
    const { children } = scopedPanel({ focus: { modal: false } });

    expect(
      children.filter((child) => isPointerConsumeContainer(child)),
    ).toEqual([]);
  });

  it("takes the blocker down with the panel", () => {
    const { panel, children } = scopedPanel();
    const blocker = children.find((child) => isPointerConsumeContainer(child))!;

    panel.destroy();

    expect(blocker.destroyed).toBe(true);
    expect(isPointerConsumeContainer(blocker)).toBe(false);
  });

  it("hands the pointer back once the panel stops holding the keys", () => {
    const { panel, stack, children } = scopedPanel();

    panel.visible = false;
    stack._observe();
    stack._drive(null);

    expect(
      children.filter((child) => isPointerConsumeContainer(child)),
    ).toEqual([]);
  });

  /** A clipping panel drawn on a stage, with a scope already driving it. */
  function clippedPanel(): {
    panel: UIPanel;
    stack: UIFocusStack;
    stage: InstanceType<typeof mocks.MockContainer>;
  } {
    const stage = new Container() as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    const stack = new UIFocusStack();
    const panel = new UIPanel({
      focus: true,
      overflow: "hidden",
      width: 200,
      height: 100,
    });
    panel.addElement(new FocusProbe());
    stage.addChild(panel.container as never);
    panel._attachToTree(mountedContext(stack));
    panel.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    stack._observe();
    stack._drive(null);
    return { panel, stack, stage };
  }

  /**
   * The blockers a scope seated beside the panel, in draw order. The panel's
   * own container carries the consume mark as well — that is what keeps a
   * click on a menu out of the game's action map — so it is left out here.
   */
  function blockersBeside(
    stage: InstanceType<typeof mocks.MockContainer>,
    panel: UIPanel,
  ): InstanceType<typeof mocks.MockContainer>[] {
    return stage.children.filter(
      (child) =>
        child !== (panel.container as never) &&
        isPointerConsumeContainer(child),
    );
  }

  it("seats the blocker outside a panel that clips its overflow", () => {
    const { panel, stage } = clippedPanel();

    // The panel's mask is read above its children and prunes the whole
    // subtree for every point outside the panel's box, so a blocker in there
    // would leave everything around the panel answering the pointer.
    const inside = (
      panel.container as unknown as InstanceType<typeof mocks.MockContainer>
    ).children.filter((child) => isPointerConsumeContainer(child));
    expect(inside).toEqual([]);
    // Directly under the panel, so the panel's own rows answer first.
    const blocker = blockersBeside(stage, panel)[0];
    expect(stage.children.indexOf(blocker!)).toBe(
      stage.children.indexOf(panel.container as never) - 1,
    );
  });

  it("keeps a dialog's blocker inside the panel that clips it", () => {
    const stage = new Container() as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    const stack = new UIFocusStack();
    const menu = new UIPanel({
      focus: true,
      overflow: "hidden",
      width: 200,
      height: 200,
    });
    menu.addElement(new FocusProbe());
    const dialog = menu.panel({ focus: true, width: 100, height: 50 });
    dialog.addElement(new FocusProbe());
    stage.addChild(menu.container as never);
    menu._attachToTree(mountedContext(stack));
    menu.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    stack._observe();
    stack._drive(null);

    // The menu's mask bounds its rows exactly as it bounds the dialog, so a
    // blocker outside the menu would leave every row the menu holds answering
    // the pointer.
    expect(blockersBeside(stage, menu)).toEqual([]);
    const children = (
      dialog.container as unknown as InstanceType<typeof mocks.MockContainer>
    ).children;
    const blockers = children.filter((child) =>
      isPointerConsumeContainer(child),
    );
    expect(blockers).toHaveLength(1);
    // Below everything the dialog draws, so its own rows answer first.
    expect(children[0]).toBe(blockers[0]);
  });

  it("hands the pointer back when a clipping panel is hidden", () => {
    const { panel, stack, stage } = clippedPanel();

    panel.visible = false;
    stack._observe();
    stack._drive(null);

    expect(blockersBeside(stage, panel)).toEqual([]);
  });

  it("takes a clipping panel's blocker down with it", () => {
    const { panel, stage } = clippedPanel();
    const blocker = blockersBeside(stage, panel)[0]!;

    panel.destroy();

    expect(blocker.destroyed).toBe(true);
    expect(blockersBeside(stage, panel)).toEqual([]);
  });
});

describe("UIPanel focus paint", () => {
  // An outline is drawn only where one is asked for, so these boxes are
  // measured against the outline a game asks for once for the whole UI.
  beforeEach(() => setUIFocusStyle({}));
  afterEach(() => setUIFocusStyle(undefined));

  /** Move focus the way a scope does. */
  function setFocused(panel: UIPanel, focused: boolean): void {
    getFocusState(panel)?._setFocused(focused);
  }

  /** Every Graphics the panel keeps, in z-order. */
  function graphicsOf(
    panel: UIPanel,
  ): InstanceType<typeof mocks.MockGraphics>[] {
    const children = (
      panel.container as unknown as InstanceType<typeof mocks.MockContainer>
    ).children;
    return children.filter(
      (child): child is InstanceType<typeof mocks.MockGraphics> =>
        child instanceof mocks.MockGraphics,
    );
  }

  /** The background Graphics, once the panel has one. */
  function backgroundOf(
    panel: UIPanel,
  ): InstanceType<typeof mocks.MockGraphics> | undefined {
    return graphicsOf(panel).find((child) => child.measurable !== false);
  }

  /** The outline a focused panel draws, or `undefined` before it takes focus. */
  function outline(
    panel: UIPanel,
  ): InstanceType<typeof mocks.MockGraphics> | undefined {
    return graphicsOf(panel).find((child) => child.measurable === false);
  }

  /** Give the background renderer a computed size to draw at. */
  function layout(panel: UIPanel): void {
    panel.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    panel.applyLayout();
  }

  it("outlines a focused panel and leaves its background alone", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      background: { color: 0x204060, radius: 4 },
    });
    layout(panel);
    expect(outline(panel)).toBeUndefined();
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0x204060);

    setFocused(panel, true);

    const ring = outline(panel);
    expect(ring?.visible).toBe(true);
    // Half the 2 px stroke inside the box, on the panel's own corner radius.
    expect(ring?.lastRect).toEqual({
      x: 1,
      y: 1,
      width: 98,
      height: 38,
      radius: 3,
    });
    expect(ring?.lastStroke).toEqual({ color: 0xffffff, width: 2 });
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0x204060);
  });

  it("outlines a focusable panel that has no background of its own", () => {
    const panel = new UIPanel({ width: 100, height: 40, focusable: true });
    layout(panel);

    setFocused(panel, true);

    expect(backgroundOf(panel)).toBeUndefined();
    expect(outline(panel)?.lastRect).toMatchObject({ width: 98, height: 38 });
  });

  it("hides the outline when focus leaves", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      background: { color: 0x204060 },
    });
    layout(panel);
    setFocused(panel, true);

    setFocused(panel, false);

    expect(outline(panel)?.visible).toBe(false);
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0x204060);
  });

  it("follows the box a later layout pass gives it", () => {
    const panel = new UIPanel({ width: 100, height: 40, focusable: true });
    layout(panel);
    setFocused(panel, true);

    panel.update({ width: 160 });
    layout(panel);

    expect(outline(panel)?.lastRect).toMatchObject({ width: 158 });
  });

  it("takes the outline style this panel was given", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      focusStyle: { color: 0x33ff88, width: 6 },
    });
    layout(panel);

    setFocused(panel, true);

    expect(outline(panel)?.lastStroke).toEqual({ color: 0x33ff88, width: 6 });
  });

  it("fills a focused panel where the caller asked for one", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      background: { color: 0x204060, radius: 4 },
      focusBackground: { color: 0xff0000 },
    });
    layout(panel);

    setFocused(panel, true);

    expect(backgroundOf(panel)?.lastFill?.color).toBe(0xff0000);
    // A colour-only override keeps the resting corner radius.
    expect(backgroundOf(panel)?.lastRadius).toBe(4);
  });

  it("keeps the named focus fill through a resting background change", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      background: { color: 0x204060, radius: 4 },
      focusBackground: { color: 0xff0000 },
    });
    layout(panel);
    setFocused(panel, true);

    panel.update({ background: { color: 0x101010, radius: 10 } });

    expect(backgroundOf(panel)?.lastFill?.color).toBe(0xff0000);
    // The outline follows the panel's new corner radius.
    expect(outline(panel)?.lastRect?.radius).toBe(9);
  });

  it("fills a focused panel that is transparent at rest", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      focusBackground: { color: 0xff0000, radius: 6 },
    });
    layout(panel);
    expect(backgroundOf(panel)).toBeUndefined();

    setFocused(panel, true);

    // The 100 x 40 box the layout pass computed, drawn in the frame focus
    // arrived rather than the one after it.
    expect(backgroundOf(panel)?.lastRect).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      radius: 6,
    });
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0xff0000);
  });

  it("draws nothing once focus leaves a panel transparent at rest", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      focusBackground: { color: 0xff0000, radius: 6 },
    });
    layout(panel);
    setFocused(panel, true);

    setFocused(panel, false);

    // Not an empty painted rectangle — the display object goes with the fill.
    expect(backgroundOf(panel)).toBeUndefined();
  });

  it("follows the box a later layout pass gives a focused fill", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      focusBackground: { color: 0xff0000, radius: 6 },
    });
    layout(panel);
    setFocused(panel, true);

    panel.update({ width: 160 });
    layout(panel);

    expect(backgroundOf(panel)?.lastRect).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 40,
      radius: 6,
    });
  });

  it("gives back the resting fill a focused panel painted over", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      background: { color: 0x204060, radius: 4 },
      focusBackground: { color: 0xff0000 },
    });
    layout(panel);
    setFocused(panel, true);

    setFocused(panel, false);

    expect(backgroundOf(panel)?.lastFill?.color).toBe(0x204060);
    expect(backgroundOf(panel)?.lastRadius).toBe(4);
  });

  it("paints no focus fill without one the caller named", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      background: { color: 0x204060 },
    });
    layout(panel);

    setFocused(panel, true);

    expect(backgroundOf(panel)?.lastFill?.color).toBe(0x204060);
  });
});

describe("UIPanel pointer focus", () => {
  /** What Pixi dispatches on the panel's container as the pointer enters. */
  function hover(panel: UIPanel): void {
    (panel.container as unknown as { emit(event: string): void }).emit(
      "pointerover",
    );
  }

  /** What it dispatches as the pointer goes down on the panel. */
  function press(panel: UIPanel): void {
    (panel.container as unknown as { emit(event: string): void }).emit(
      "pointerdown",
    );
  }

  beforeEach(() => {
    // The pointer request cell is module-level; a request left by one test is
    // not the next one's.
    takePointerRequest();
  });

  it("asks for hover focus when the row takes part in navigation", () => {
    const panel = new UIPanel({ focusable: true });

    hover(panel);

    const request = takePointerRequest();
    expect(request?.element).toBe(panel);
    expect(request?.trigger).toBe("hover");
  });

  it("asks for press focus when the pointer presses the row", () => {
    const panel = new UIPanel({ focusable: true });

    press(panel);

    const request = takePointerRequest();
    expect(request?.element).toBe(panel);
    expect(request?.trigger).toBe("press");
  });

  it("asks for nothing from a row that takes no part", () => {
    const panel = new UIPanel({});

    hover(panel);
    press(panel);

    expect(takePointerRequest()).toBeNull();
  });

  it("leaves the innermost focusable row in the cell", () => {
    const row = new UIPanel({ focusable: true });
    const inner = new UIPanel({ focusable: true });
    row.addElement(inner);

    // One pointer move dispatches along the whole composed path, so the row
    // around the element under the pointer asks last.
    hover(inner);
    hover(row);

    expect(takePointerRequest()?.element).toBe(inner);
  });

  it("leaves the innermost pressed row in the cell", () => {
    const row = new UIPanel({ focusable: true });
    const inner = new UIPanel({ focusable: true });
    row.addElement(inner);

    press(inner);
    press(row);

    const request = takePointerRequest();
    expect(request?.element).toBe(inner);
    expect(request?.trigger).toBe("press");
  });
});
