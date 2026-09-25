import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

vi.mock("pixi.js", async () => (await import("./test-pixi.js")).widgetPixiMock);

vi.mock("@yagejs/renderer", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  // The size of the box the widgets below are given, so a sprite scales by 1.
  resolveTextureInput: () => ({ width: 120, height: 40 }),
}));

import Yoga, { Direction } from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { MockContainer, MockGraphics } from "./test-pixi.js";
import type { FocusProps, UIElement } from "./types.js";
import { UIButton } from "./UIButton.js";
import { UICheckbox } from "./UICheckbox.js";
import { UIImage } from "./UIImage.js";
import { UINineSlice } from "./UINineSlice.js";
import { UIPanel } from "./UIPanel.js";
import { UIProgressBar } from "./UIProgressBar.js";
import { UIScrollView } from "./UIScrollView.js";
import { UISplitText } from "./UISplitText.js";
import { UIText } from "./UIText.js";
import { getFocusState } from "./focus/FocusState.js";
import { setUIFocusStyle } from "./internal/focus-outline.js";
import { takePointerRequest } from "./focus/pointer-request.js";

/** A display widget that takes the focus props without being interactive. */
interface FocusWidget extends UIElement {
  yogaNode: UIElement["yogaNode"];
  update(props: FocusProps): void;
  applyLayout(): void;
  _inspectState(): unknown;
}

const SIZE = { width: 120, height: 40 };

const widgets: [string, (props: FocusProps) => FocusWidget][] = [
  ["UIImage", (p) => new UIImage({ texture: "cell", ...SIZE, ...p })],
  [
    "UINineSlice",
    (p) => new UINineSlice({ texture: "panel", insets: 4, ...SIZE, ...p }),
  ],
  ["UIPanel", (p) => new UIPanel({ ...SIZE, ...p })],
  ["UIProgressBar", (p) => new UIProgressBar({ value: 0.5, ...SIZE, ...p })],
  [
    "UISplitText",
    (p) => new UISplitText({ children: "hi there", ...SIZE, ...p }),
  ],
  ["UIScrollView", (p) => new UIScrollView({ ...SIZE, ...p })],
  ["UIText", (p) => new UIText({ children: "hi", ...SIZE, ...p })],
];

/** The outline a focused element draws, or `undefined` before it takes one. */
function outlineOf(element: UIElement): MockGraphics | undefined {
  const { children } = element.displayObject as unknown as MockContainer;
  return children.find(
    (child): child is MockGraphics =>
      child instanceof MockGraphics &&
      (child as { measurable?: boolean }).measurable === false,
  );
}

function emitOn(element: UIElement, event: string): void {
  // A picture listens on its sprite, which is what the pointer hits.
  const target =
    element instanceof UIImage ? element.sprite : element.displayObject;
  // A scroll view's drag listener reads the pointer position off the event.
  (target as unknown as MockContainer).emit(event, {
    global: { x: 0, y: 0 },
  });
}

beforeAll(() => setYoga(Yoga));

describe.each(widgets)("%s focus props", (_name, create) => {
  // An outline is drawn only where a style asks for one.
  beforeEach(() => setUIFocusStyle({}));
  afterEach(() => setUIFocusStyle(undefined));

  it("stays out of focus navigation by default", () => {
    const el = create({});

    expect(getFocusState(el)?.focusable).toBe(false);
    el.destroy();
  });

  it("joins focus navigation and reports focus changes", () => {
    const onFocusChange = vi.fn();
    const el = create({ focusable: true, onFocusChange });

    const state = getFocusState(el);
    expect(state?.focusable).toBe(true);
    state?._setFocused(true);

    expect(onFocusChange).toHaveBeenCalledWith(true);
    el.destroy();
  });

  it("takes the focus props an update carries", () => {
    const el = create({});

    el.update({ focusable: true, focusId: "first" });

    expect(getFocusState(el)?.focusable).toBe(true);
    expect(getFocusState(el)?.id).toBe("first");
    el.destroy();
  });

  it("outlines the box layout gave it while it holds focus", () => {
    const el = create({ focusable: true });
    expect(outlineOf(el)).toBeUndefined();

    getFocusState(el)?._setFocused(true);
    el.yogaNode.calculateLayout(SIZE.width, SIZE.height, Direction.LTR);
    el.applyLayout();

    const ring = outlineOf(el);
    expect(ring?.visible).toBe(true);
    expect(ring?.lastRect).toMatchObject({
      x: 1,
      y: 1,
      width: 118,
      height: 38,
    });
    expect(ring?.lastStroke).toEqual({ color: 0xffffff, width: 2 });
    el.destroy();
  });

  it.each([
    ["pointerover", "hover"],
    ["pointerdown", "press"],
  ])("asks for focus on %s with the %s trigger", (event, trigger) => {
    const el = create({ focusable: true });
    takePointerRequest();

    emitOn(el, event);

    const request = takePointerRequest();
    expect(request?.element).toBe(el);
    expect(request?.trigger).toBe(trigger);
    el.destroy();
  });

  it("reports its focus state to the Inspector", () => {
    const el = create({ focusable: true });

    const state = { focused: false, focusable: true };
    expect(el._inspectState()).toMatchObject(state);
    getFocusState(el)?._setFocused(true);
    expect(el._inspectState()).toMatchObject({ ...state, focused: true });
    el.destroy();
  });

  it("leaves focus navigation when it is destroyed", () => {
    const el = create({ focusable: true });

    el.destroy();

    expect(getFocusState(el)).toBeUndefined();
  });
});

/** A widget that acts on a press: a pointer's, or a focus scope's confirm. */
interface PressWidget extends FocusWidget {
  readonly focusable: boolean;
  activate(): void;
  setDisabled(disabled: boolean): void;
  _inspectState(): Record<string, unknown>;
}

interface PressProps extends FocusProps {
  disabled?: boolean;
  /** The widget's own action: a button's click, a checkbox's change. */
  onAction?: () => void;
}

const RESTING = 0x204060;
/** The resting colour times the 0.75 press factor. */
const PRESSED = 0x183048;

const pressWidgets: [string, (props?: PressProps) => PressWidget][] = [
  [
    "UIButton",
    ({ onAction, ...p } = {}) =>
      new UIButton({
        children: "Test",
        width: 100,
        height: 30,
        background: { color: RESTING },
        ...(onAction ? { onClick: onAction } : {}),
        ...p,
      }),
  ],
  [
    "UICheckbox",
    ({ onAction, ...p } = {}) =>
      new UICheckbox({
        boxColor: RESTING,
        ...(onAction ? { onChange: onAction } : {}),
        ...p,
      }),
  ],
];

describe.each(pressWidgets)("%s focus and press", (_name, create) => {
  beforeEach(() => {
    setUIFocusStyle({});
    takePointerRequest();
  });
  afterEach(() => setUIFocusStyle(undefined));

  /** Build the widget and lay it out, so its background is painted. */
  function build(props?: PressProps): PressWidget {
    const el = create(props);
    el.yogaNode.calculateLayout(100, 30, Direction.LTR);
    el.applyLayout();
    return el;
  }

  /** The colour the widget's first Graphics was last filled with. */
  function painted(el: PressWidget): number | undefined {
    const { children } = el.displayObject as unknown as MockContainer;
    return (children[0] as MockGraphics).lastFill?.color;
  }

  /** Hold or release a confirm press the way a scope does. */
  function setPressed(el: PressWidget, pressed: boolean): void {
    getFocusState(el)?.behavior.setPressed?.(pressed);
  }

  it("takes focus by default and gives it up on request", () => {
    expect(build().focusable).toBe(true);
    const out = build({ focusable: false });
    expect(out.focusable).toBe(false);
    expect(out._inspectState()).toMatchObject({ focusable: false });
  });

  it("outlines itself while it holds focus and leaves its fill alone", () => {
    const el = build();
    expect(outlineOf(el)).toBeUndefined();

    getFocusState(el)?._setFocused(true);
    const ring = outlineOf(el);
    expect(ring?.visible).toBe(true);
    expect(ring?.lastRect).toMatchObject({ x: 1, y: 1, width: 98, height: 28 });
    expect(ring?.lastStroke).toEqual({ color: 0xffffff, width: 2 });
    expect(painted(el)).toBe(RESTING);

    getFocusState(el)?._setFocused(false);
    expect(ring?.visible).toBe(false);
  });

  it.each([
    ["pointerover", "hover"],
    ["pointerdown", "press"],
  ])("asks for focus on %s with the %s trigger", (event, trigger) => {
    const el = build();

    emitOn(el, event);

    const request = takePointerRequest();
    expect(request?.element).toBe(el);
    expect(request?.trigger).toBe(trigger);
  });

  it.each([
    ["disabled", { disabled: true }],
    ["out of focus navigation", { focusable: false }],
  ])("asks for no focus while %s", (_state, props) => {
    const el = build(props);

    emitOn(el, "pointerover");
    emitOn(el, "pointerdown");

    expect(takePointerRequest()).toBeNull();
  });

  it("runs its action once from activate(), and not while disabled", () => {
    const onAction = vi.fn();
    build({ onAction }).activate();
    expect(onAction).toHaveBeenCalledTimes(1);

    build({ onAction, disabled: true }).activate();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("sends a pointer press and release through activate()", () => {
    const onAction = vi.fn();
    const el = build({ onAction });
    const activate = vi.spyOn(el, "activate");

    // A release whose press began elsewhere is not a click.
    emitOn(el, "pointerup");
    expect(activate).not.toHaveBeenCalled();

    emitOn(el, "pointerdown");
    emitOn(el, "pointerup");
    expect(takePointerRequest()?.trigger).toBe("press");
    expect(activate).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("leaves the pointer's press alone when something else activates it", () => {
    const onAction = vi.fn();
    const el = build({ onAction });

    emitOn(el, "pointerdown");
    el.activate();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(painted(el)).toBe(PRESSED);

    emitOn(el, "pointerup");
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(painted(el)).toBe(RESTING);
  });

  it("paints a confirm press the way a pointer press is painted", () => {
    const el = build();
    getFocusState(el)?._setFocused(true);

    setPressed(el, true);
    expect(painted(el)).toBe(PRESSED);
    expect(el._inspectState().pressed).toBe(true);

    // The pointer crossing the widget does not end the confirm press.
    emitOn(el, "pointerover");
    emitOn(el, "pointerout");
    expect(painted(el)).toBe(PRESSED);

    setPressed(el, false);
    expect(painted(el)).toBe(RESTING);
    expect(el._inspectState().pressed).toBe(false);
    expect(outlineOf(el)?.visible).toBe(true);
  });

  it("stays pressed when confirm ends under a pointer still down", () => {
    const el = build();

    emitOn(el, "pointerdown");
    setPressed(el, true);
    setPressed(el, false);
    expect(painted(el)).toBe(PRESSED);
    expect(el._inspectState().pressed).toBe(true);

    emitOn(el, "pointerup");
    expect(painted(el)).toBe(RESTING);
  });

  it("holds a confirm press through a pointer release outside it", () => {
    const el = build();
    setPressed(el, true);

    emitOn(el, "pointerdown");
    emitOn(el, "pointerupoutside");
    expect(painted(el)).toBe(PRESSED);

    setPressed(el, false);
    expect(painted(el)).toBe(RESTING);
  });

  it("forgets both presses when it is disabled under them", () => {
    const el = build();
    emitOn(el, "pointerdown");
    setPressed(el, true);

    el.setDisabled(true);
    expect(painted(el)).toBe(RESTING);
    expect(el._inspectState().pressed).toBe(false);

    el.setDisabled(false);
    expect(painted(el)).toBe(RESTING);
  });

  it("reports its interaction state to the Inspector", () => {
    const el = build();

    emitOn(el, "pointerdown");
    getFocusState(el)?._setFocused(true);

    expect(el._inspectState()).toMatchObject({
      focused: true,
      focusable: true,
      pressed: true,
      disabled: false,
    });
  });

  it("leaves focus navigation when it is destroyed", () => {
    const el = build();
    el.destroy();
    expect(getFocusState(el)).toBeUndefined();
  });
});

describe("UIImage focus outline", () => {
  beforeEach(() => setUIFocusStyle({}));
  afterEach(() => setUIFocusStyle(undefined));

  it("outlines a stretched picture at the size it is drawn on screen", () => {
    const img = new UIImage({
      texture: "cell",
      focusable: true,
      width: 240,
      height: 60,
    });
    getFocusState(img)?._setFocused(true);
    img.yogaNode.calculateLayout(240, 60, Direction.LTR);
    img.applyLayout();

    // The sprite scales its 120x40 texture by 2 and 1.5 inside the element's
    // own container, where the outline is drawn unscaled: 240 px across, with
    // a 2 px stroke on both axes.
    const ring = outlineOf(img);
    const sprite = img.sprite.scale;
    expect([sprite.x, sprite.y]).toEqual([2, 1.5]);
    expect(ring?.lastStroke).toEqual({ color: 0xffffff, width: 2 });
    expect((ring?.lastRect?.width ?? 0) + 2).toBeCloseTo(240);
    expect((ring?.lastRect?.height ?? 0) + 2).toBeCloseTo(60);
    expect([ring?.scale.x, ring?.scale.y]).toEqual([1, 1]);
    img.destroy();
  });
});
