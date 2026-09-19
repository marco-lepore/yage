import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

vi.mock("pixi.js", async () => (await import("./test-pixi.js")).pixiMock);

import Yoga, { Direction } from "yoga-layout";
import type { Node as YogaNode } from "yoga-layout";
import { Container } from "pixi.js";
import { isPointerConsumeContainer } from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";
import { createYogaNode, setYoga } from "./yoga-helpers.js";
import { MockContainer, MockGraphics } from "./test-pixi.js";
import { TreeContextProbe } from "./test-helpers.js";
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

const contextProbe = (): TreeContextProbe =>
  new TreeContextProbe(new Container());

/** A focusable leaf, the way an interactive primitive builds one. */
class FocusProbe implements UIElement {
  readonly displayObject: DisplayContainer = new Container();
  readonly yogaNode: YogaNode = createYogaNode();
  readonly focus: FocusState;

  constructor(props: FocusProps = {}) {
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
  it("attaches a child whether it arrives before or after the panel joins a tree", () => {
    const panel = new UIPanel({});
    const early = contextProbe();
    panel.addElement(early);
    expect(early.attached).toBe(false);

    panel._attachToTree(mountedContext());
    const late = contextProbe();
    panel.addElement(late);

    expect(early.attached).toBe(true);
    expect(late.attached).toBe(true);
  });

  it("detaches a child it removes, and leaves another panel's child alone", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext());
    const own = contextProbe();
    panel.addElement(own);
    const other = new UIPanel({});
    other._attachToTree(mountedContext());
    const foreign = contextProbe();
    other.addElement(foreign);

    panel.removeElement(own);
    panel.removeElement(foreign);

    expect(own.attached).toBe(false);
    expect(foreign.attached).toBe(true);
  });

  it("stops attaching children once the panel leaves the tree", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext());
    panel._detachFromTree();
    const probe = contextProbe();

    panel.addElement(probe);

    expect(probe.attached).toBe(false);
  });

  it("detaches the whole subtree once when the panel is destroyed", () => {
    const panel = new UIPanel({});
    panel._attachToTree(mountedContext());
    const probe = contextProbe();
    panel.panel().addElement(probe);
    expect(probe.attached).toBe(true);

    panel.destroy();

    expect(probe.attached).toBe(false);
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

  it("builds a scope once it has both the option and a tree, in either order", () => {
    const stack = new UIFocusStack();
    const optionFirst = new UIPanel({ focus: true });
    const treeFirst = new UIPanel({});
    treeFirst._attachToTree(mountedContext(stack));
    expect(optionFirst.focusScope).toBeNull();
    expect(treeFirst.focusScope).toBeNull();
    expect(stack._observe()).toBe(false);

    optionFirst._attachToTree(mountedContext(stack));
    treeFirst.update({ focus: { wrap: false } });

    expect(optionFirst.focusScope).not.toBeNull();
    expect(treeFirst.focusScope).not.toBeNull();
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

  it("refreshes the scope from a fresh options object, dropping what it leaves out", () => {
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

    panel.update({ focus: {} });
    scope.cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, false])(
    "disposes the scope when the option turns %s",
    (focus) => {
      const stack = new UIFocusStack();
      const { panel } = mountedPanel(stack);

      panel.update({ focus });

      expect(panel.focusScope).toBeNull();
      expect(stack._observe()).toBe(false);
    },
  );

  it.each(["removed from its parent", "destroyed"])(
    "unregisters the scope of a panel that is %s",
    (how) => {
      const stack = new UIFocusStack();
      const parent = new UIPanel({});
      parent._attachToTree(mountedContext(stack));
      const child = parent.panel({ focus: true });
      expect(stack._observe()).toBe(true);

      if (how === "destroyed") child.destroy();
      else parent.removeElement(child);

      expect(child.focusScope).toBeNull();
      expect(stack._observe()).toBe(false);
    },
  );

  it("reports the scope's input state to the Inspector", () => {
    const stack = new UIFocusStack();
    const { panel } = mountedPanel(stack);
    const inspect = (): unknown =>
      (panel as unknown as { _inspectState(): unknown })._inspectState();
    const resting = { focused: false, focusable: false };

    expect(inspect()).toEqual({ ...resting, focusScope: { hasInput: false } });

    stack._observe();
    stack._drive(null);

    expect(inspect()).toEqual({ ...resting, focusScope: { hasInput: true } });
  });
});

describe("UIPanel pointer ownership", () => {
  /** A panel with a background, a row of its own, and a scope driving it. */
  function scopedPanel(props: FocusProps & { focus?: unknown } = {}): {
    panel: UIPanel;
    stack: UIFocusStack;
    row: FocusProbe;
    children: MockContainer[];
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
    const children = (panel.container as unknown as MockContainer).children;
    return { panel, stack, row, children };
  }

  it("puts the blocker below everything the panel draws", () => {
    const { row, children } = scopedPanel();

    const blockers = children.filter((child) =>
      isPointerConsumeContainer(child),
    );
    expect(blockers).toHaveLength(1);
    // Pixi asks the last child first, so the panel's own row answers first.
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

  it.each(["hidden", "destroyed"])(
    "takes the blocker away when the panel is %s",
    (how) => {
      const { panel, stack, children } = scopedPanel();
      const blocker = children.find((child) =>
        isPointerConsumeContainer(child),
      )!;

      if (how === "hidden") panel.visible = false;
      else panel.destroy();
      stack._observe();
      stack._drive(null);

      expect(children).not.toContain(blocker);
      if (how === "destroyed") {
        expect(blocker.destroyed).toBe(true);
        expect(isPointerConsumeContainer(blocker)).toBe(false);
      }
    },
  );

  /** A clipping panel drawn on a stage, with a scope already driving it. */
  function clippedPanel(): {
    panel: UIPanel;
    stack: UIFocusStack;
    stage: MockContainer;
  } {
    const stage = new Container() as unknown as MockContainer;
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

  /** The blockers beside the panel; its own container is marked too. */
  function blockersBeside(
    stage: MockContainer,
    panel: UIPanel,
  ): MockContainer[] {
    return stage.children.filter(
      (child) =>
        child !== (panel.container as never) &&
        isPointerConsumeContainer(child),
    );
  }

  it("seats the blocker outside a panel that clips its overflow", () => {
    const { panel, stage } = clippedPanel();

    // The panel's mask prunes its whole subtree for a point outside its box.
    const inside = (
      panel.container as unknown as MockContainer
    ).children.filter((child) => isPointerConsumeContainer(child));
    expect(inside).toEqual([]);
    // Directly under the panel, so the panel's own rows answer first.
    const blocker = blockersBeside(stage, panel)[0];
    expect(stage.children.indexOf(blocker!)).toBe(
      stage.children.indexOf(panel.container as never) - 1,
    );
  });

  it("keeps a dialog's blocker inside the panel that clips it", () => {
    const stage = new Container() as unknown as MockContainer;
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

    // The menu's mask bounds its rows exactly as it bounds the dialog.
    expect(blockersBeside(stage, menu)).toEqual([]);
    const children = (dialog.container as unknown as MockContainer).children;
    const blockers = children.filter((child) =>
      isPointerConsumeContainer(child),
    );
    expect(blockers).toHaveLength(1);
    // Below everything the dialog draws, so its own rows answer first.
    expect(children[0]).toBe(blockers[0]);
  });

  it.each(["hidden", "destroyed"])(
    "takes a clipping panel's blocker away when the panel is %s",
    (how) => {
      const { panel, stack, stage } = clippedPanel();
      const blocker = blockersBeside(stage, panel)[0]!;

      if (how === "hidden") panel.visible = false;
      else panel.destroy();
      stack._observe();
      stack._drive(null);

      expect(blockersBeside(stage, panel)).toEqual([]);
      if (how === "destroyed") expect(blocker.destroyed).toBe(true);
    },
  );
});

describe("UIPanel focus paint", () => {
  // An outline is drawn only where a style asks for one.
  beforeEach(() => setUIFocusStyle({}));
  afterEach(() => setUIFocusStyle(undefined));

  /** Move focus the way a scope does. */
  function setFocused(panel: UIPanel, focused: boolean): void {
    getFocusState(panel)?._setFocused(focused);
  }

  /** Every Graphics the panel keeps, in z-order. */
  function graphicsOf(panel: UIPanel): MockGraphics[] {
    const children = (panel.container as unknown as MockContainer).children;
    return children.filter(
      (child): child is MockGraphics => child instanceof MockGraphics,
    );
  }

  /** The background Graphics, once the panel has one. */
  function backgroundOf(panel: UIPanel): MockGraphics | undefined {
    return graphicsOf(panel).find((child) => child.measurable !== false);
  }

  /** The outline a focused panel draws, or `undefined` before it takes focus. */
  function outline(panel: UIPanel): MockGraphics | undefined {
    return graphicsOf(panel).find((child) => child.measurable === false);
  }

  /** Give the background renderer a computed size to draw at. */
  function layout(panel: UIPanel): void {
    panel.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    panel.applyLayout();
  }

  const BOX = { width: 100, height: 40, focusable: true };

  it("outlines a focused panel on its own corner radius and leaves its background alone", () => {
    const panel = new UIPanel({
      ...BOX,
      background: { color: 0x204060, radius: 4 },
    });
    layout(panel);
    expect(outline(panel)).toBeUndefined();

    setFocused(panel, true);

    const ring = outline(panel);
    expect(ring?.visible).toBe(true);
    // Half the 2 px stroke inside the box, radius included.
    expect(ring?.lastRect).toEqual({
      x: 1,
      y: 1,
      width: 98,
      height: 38,
      radius: 3,
    });
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0x204060);

    setFocused(panel, false);
    expect(ring?.visible).toBe(false);
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0x204060);
  });

  it("fills a focused panel where the caller asked, and gives the resting fill back", () => {
    const panel = new UIPanel({
      ...BOX,
      background: { color: 0x204060, radius: 4 },
      focusBackground: { color: 0xff0000 },
    });
    layout(panel);

    setFocused(panel, true);
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0xff0000);
    // A colour-only override keeps the resting corner radius.
    expect(backgroundOf(panel)?.lastRadius).toBe(4);

    // A resting background change keeps the focus fill and moves the outline.
    panel.update({ background: { color: 0x101010, radius: 10 } });
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0xff0000);
    expect(outline(panel)?.lastRect?.radius).toBe(9);

    setFocused(panel, false);
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0x101010);
    expect(backgroundOf(panel)?.lastRadius).toBe(10);
  });

  it("fills a panel that is transparent at rest only while it holds focus", () => {
    const panel = new UIPanel({
      ...BOX,
      focusBackground: { color: 0xff0000, radius: 6 },
    });
    layout(panel);
    expect(backgroundOf(panel)).toBeUndefined();

    // Drawn in the frame focus arrives, at the box layout computed.
    setFocused(panel, true);
    expect(backgroundOf(panel)?.lastFill?.color).toBe(0xff0000);
    expect(backgroundOf(panel)?.lastRect).toMatchObject({ width: 100 });

    panel.update({ width: 160 });
    layout(panel);
    expect(backgroundOf(panel)?.lastRect).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 40,
      radius: 6,
    });

    // The display object goes with the fill.
    setFocused(panel, false);
    expect(backgroundOf(panel)).toBeUndefined();
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
    // The pointer request cell is module-level.
    takePointerRequest();
  });

  it("asks for nothing from a row that takes no part", () => {
    const panel = new UIPanel({});

    hover(panel);
    press(panel);

    expect(takePointerRequest()).toBeNull();
  });

  it.each([
    ["hover", hover],
    ["press", press],
  ] as const)("leaves the innermost row in the cell on %s", (trigger, act) => {
    const row = new UIPanel({ focusable: true });
    const inner = new UIPanel({ focusable: true });
    row.addElement(inner);

    // One pointer event dispatches along the whole path, so the outer row
    // asks last.
    act(inner);
    act(row);

    const request = takePointerRequest();
    expect(request?.element).toBe(inner);
    expect(request?.trigger).toBe(trigger);
  });
});
