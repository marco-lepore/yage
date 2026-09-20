import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", async () => (await import("./test-pixi-ui.js")).pixiMock);
vi.mock("@pixi/ui", async () => (await import("./test-pixi-ui.js")).pixiUIMock);

import Yoga, { Direction, Display } from "yoga-layout";
import { setYoga } from "../yoga-helpers.js";
import { setUIFocusStyle } from "../internal/focus-outline.js";
import { getFocusState } from "../focus/FocusState.js";
import { takePointerRequest } from "../focus/pointer-request.js";
import { isCapturingInput } from "../focus/input-capture.js";
import { PixiFancyButton } from "./PixiFancyButton.js";
import { PixiSlider } from "./PixiSlider.js";
import { PixiInput } from "./PixiInput.js";
import { PixiCheckbox } from "./PixiCheckbox.js";
import { PixiProgressBar } from "./PixiProgressBar.js";
import { PixiSelect } from "./PixiSelect.js";
import { PixiRadioGroup } from "./PixiRadioGroup.js";
import type { PixiUIBase } from "./PixiUIBase.js";
import type { FocusDirection, UIElement } from "../types.js";
import {
  MockContainer,
  MockGraphics,
  MockSprite,
  type MockFancyButton,
} from "./test-pixi-ui.js";

beforeAll(() => setYoga(Yoga));
beforeEach(() => {
  takePointerRequest();
  setUIFocusStyle(undefined);
});

const view = (): never => new MockContainer() as never;

/** Lay out one element on its own, so its Yoga box carries real numbers. */
function layout(element: UIElement, width: number, height: number): void {
  element.yogaNode.calculateLayout(width, height, Direction.LTR);
  element.applyLayout?.();
}

/** Drive the focus the owning scope would paint. */
function setFocused(element: UIElement, focused: boolean): void {
  getFocusState(element)?._setFocused(focused);
}

/** The focus outline a wrapper draws, or `undefined` before it takes focus. */
function focusOutline(element: UIElement): MockGraphics | undefined {
  const children = (element.displayObject as unknown as MockContainer).children;
  return children.find(
    (child): child is MockGraphics => child instanceof MockGraphics,
  );
}

/** Ask an element's own stepper to take a direction, as a scope does. */
function adjust(element: UIElement, direction: FocusDirection): boolean {
  return getFocusState(element)?._adjust(direction) === true;
}

function allWrappers(): PixiUIBase<MockContainer>[] {
  return [
    new PixiFancyButton({ defaultView: view(), disabled: true }),
    new PixiSlider({ bg: view(), fill: view(), slider: view(), value: 25 }),
    new PixiInput({ bg: view(), value: "hello", secure: true, padding: 4 }),
    new PixiCheckbox({
      checkedView: view(),
      uncheckedView: view(),
      checked: true,
    }),
    new PixiProgressBar({ bg: view(), fill: view(), value: 50 }),
    new PixiSelect({ closedBG: view(), openBG: view(), items: ["A", "B"] }),
    new PixiRadioGroup({
      items: [{ checkedView: view(), uncheckedView: view(), text: "A" }],
      type: "vertical",
      elementsMargin: 0,
    }),
  ] as unknown as PixiUIBase<MockContainer>[];
}

describe("PixiUI wrappers", () => {
  it("destroy is idempotent for every wrapper", () => {
    for (const wrapper of allWrappers()) {
      const free = vi.spyOn(wrapper.yogaNode, "free");
      const destroy = vi.spyOn(wrapper.displayObject, "destroy");
      wrapper.destroy();
      wrapper.destroy();
      expect(free).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("a removed visible prop restores every wrapper to Flex", () => {
    for (const wrapper of allWrappers()) {
      wrapper.update({ visible: false });
      wrapper.update({ visible: undefined });
      expect(wrapper.visible).toBe(true);
      expect(wrapper.yogaNode.getDisplay()).toBe(Display.Flex);
      wrapper.destroy();
    }
  });

  it("removed mutable props restore their constructor defaults", () => {
    const button = new PixiFancyButton({ defaultView: view(), disabled: true });
    button.update({ disabled: undefined });
    expect(
      (button.displayObject as unknown as { enabled: boolean }).enabled,
    ).toBe(true);

    const slider = new PixiSlider({
      bg: view(),
      fill: view(),
      slider: view(),
      value: 25,
      min: 10,
      max: 50,
      step: 5,
    });
    slider.update({
      value: undefined,
      min: undefined,
      max: undefined,
      step: undefined,
    });
    expect(slider.displayObject).toMatchObject({
      value: 0,
      min: 0,
      max: 100,
      step: 1,
    });

    const input = new PixiInput({
      bg: view(),
      value: "hello",
      secure: true,
      padding: 4,
    });
    input.update({ value: undefined, secure: undefined, padding: undefined });
    expect(input.displayObject).toMatchObject({
      value: "",
      secure: false,
      padding: 0,
    });

    const checkbox = new PixiCheckbox({
      checkedView: view(),
      uncheckedView: view(),
      checked: true,
      text: "Label",
    });
    checkbox.update({ checked: undefined, text: undefined });
    expect(checkbox.displayObject).toMatchObject({ checked: false, text: "" });

    const progress = new PixiProgressBar({
      bg: view(),
      fill: view(),
      value: 50,
    });
    progress.update({ value: undefined });
    expect(progress.displayObject).toMatchObject({ progress: 0 });
  });

  it("keeps an authored selection when the items are relabelled", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["Easy", "Hard"],
      selected: 1,
    });
    // No row picked yet, so the authored `selected` still owns the row.
    select.update({ items: ["Facile", "Difficile"] });
    expect(select.displayObject).toMatchObject({ value: 1 });
  });

  it("keeps a select's layout size while its dropdown is open", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
    });
    const measure = (): number => {
      select.yogaNode.markDirty();
      select.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
      return select.yogaNode.getComputedWidth();
    };
    expect(measure()).toBe(180);

    // Open: the closed button is hidden and the list sits on the stage, so the
    // Select's own bounds are empty — layout must not follow them.
    (select.displayObject as unknown as { open(): void }).open();
    expect(measure()).toBe(180);

    select.update({ items: ["Facile", "Difficile"] });
    expect(measure()).toBe(180);

    (select.displayObject as unknown as { close(): void }).close();
    expect(measure()).toBe(180);
  });

  it("keeps the player's row when a select's items are replaced without one", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B", "C"],
      selected: 0,
    });
    // The player opens the dropdown and picks the third row.
    (select.displayObject as unknown as { value: number }).value = 2;

    select.update({ items: ["X", "Y", "Z"] });
    expect(select.displayObject).toMatchObject({ value: 2 });

    // A shorter list clamps rather than dropping to the first row.
    select.update({ items: ["X", "Y"] });
    expect(select.displayObject).toMatchObject({ value: 1 });

    // An explicit `selected` still wins.
    select.update({ items: ["P", "Q"], selected: 0 });
    expect(select.displayObject).toMatchObject({ value: 0 });
  });

  it("re-measures a wrapper whose text changes size", () => {
    const button = new PixiFancyButton({ text: "A" });
    const dirty = vi.spyOn(button.yogaNode, "markDirty");

    button.update({ text: "A much longer label" });
    expect(dirty).toHaveBeenCalled();

    dirty.mockClear();
    button.update({ disabled: true });
    expect(dirty).not.toHaveBeenCalled();
  });

  it("applies item updates for selects and radio groups", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
      selected: 1,
    });
    select.update({ items: ["C", "D"], selected: 0 });
    expect(select.displayObject).toMatchObject({
      value: 0,
      addedItems: { items: ["C", "D"] },
    });

    const radio = new PixiRadioGroup({
      items: [{ checkedView: view(), uncheckedView: view(), text: "A" }],
      type: "vertical",
      elementsMargin: 0,
    });
    radio.update({
      items: [
        { checkedView: view(), uncheckedView: view(), text: "B" },
        { checkedView: view(), uncheckedView: view(), text: "C" },
      ],
      selected: 1,
    });
    expect(radio.displayObject).toMatchObject({ selected: 1 });
  });

  it("keeps selection in range when item updates shrink a list", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
      selected: 1,
    });
    select.update({ items: ["C"] });
    expect(select.displayObject).toMatchObject({ value: 0 });

    const radio = new PixiRadioGroup({
      items: [
        { checkedView: view(), uncheckedView: view(), text: "A" },
        { checkedView: view(), uncheckedView: view(), text: "B" },
      ],
      type: "vertical",
      elementsMargin: 0,
      selected: 1,
    });
    expect(() =>
      radio.update({
        items: [{ checkedView: view(), uncheckedView: view(), text: "C" }],
      }),
    ).not.toThrow();
    expect(radio.displayObject).toMatchObject({ selected: 0 });
  });

  it("clears a select when an item update empties the list", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
      selected: 1,
    });

    select.update({ items: [] });

    expect(select.displayObject).toMatchObject({
      value: -1,
      openButton: { text: "" },
      closeButton: { text: "" },
    });
  });

  it("resets selection when selected is removed with an item update", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
      selected: 1,
    });
    select.update({ items: ["C", "D"], selected: undefined });
    expect(select.displayObject).toMatchObject({ value: 0 });

    const radio = new PixiRadioGroup({
      items: [
        { checkedView: view(), uncheckedView: view(), text: "A" },
        { checkedView: view(), uncheckedView: view(), text: "B" },
      ],
      type: "vertical",
      elementsMargin: 0,
      selected: 1,
    });
    radio.update({
      items: [
        { checkedView: view(), uncheckedView: view(), text: "C" },
        { checkedView: view(), uncheckedView: view(), text: "D" },
      ],
      selected: undefined,
    });
    expect(radio.displayObject).toMatchObject({ selected: 0 });
  });

  it("changes the placeholder of an existing input", () => {
    const input = new PixiInput({ bg: view(), placeholder: "Search" });
    const placeholder = (
      input.displayObject as unknown as {
        placeholder: { text: string; visible: boolean };
      }
    ).placeholder;

    input.update({ placeholder: "Cerca" });
    expect(placeholder).toEqual({ text: "Cerca", visible: true });

    input.activate();
    input.update({ placeholder: "Buscar" });
    expect(placeholder).toEqual({ text: "Buscar", visible: false });
    input.commitEditing();
    expect(placeholder.visible).toBe(true);

    input.update({ value: "hello" });
    input.update({ placeholder: "Suchen" });
    expect(placeholder).toEqual({ text: "Suchen", visible: false });

    input.update({ placeholder: undefined });
    expect(placeholder.text).toBe("");
  });

  it("disconnects one callback shared by two signals", () => {
    const callback = vi.fn();
    const input = new PixiInput({
      bg: view(),
      onChange: callback,
      onEnter: callback,
    });
    const inputView = input.displayObject as unknown as {
      onChange: { callbacks: Set<unknown> };
      onEnter: { callbacks: Set<unknown> };
    };

    input.destroy();

    expect(inputView.onChange.callbacks).toHaveLength(0);
    expect(inputView.onEnter.callbacks).toHaveLength(0);
  });
});

describe("PixiUI focus outline", () => {
  // These cases measure the outline a game asks for once for the whole UI.
  beforeEach(() => setUIFocusStyle({}));

  /** What the outline's rectangle comes to on screen, through both scales. */
  function onScreenRect(
    element: UIElement,
  ): { left: number; top: number; right: number; bottom: number } | undefined {
    const outline = focusOutline(element);
    const rect = outline?.lastRect;
    if (!outline || !rect) return undefined;
    const viewScale = (element.displayObject as unknown as MockContainer).scale;
    const x = (value: number): number =>
      (outline.position.x + value * outline.scale.x) * viewScale.x;
    const y = (value: number): number =>
      (outline.position.y + value * outline.scale.y) * viewScale.y;
    // The stroke straddles the path, so the outer edge is half a width out.
    const half = outline.lastStrokeWidth / 2;
    return {
      left: x(rect.x - half),
      top: y(rect.y - half),
      right: x(rect.x + rect.width + half),
      bottom: y(rect.y + rect.height + half),
    };
  }

  it("appears on focus around the layout box, and hides on blur", () => {
    const button = new PixiFancyButton({ defaultView: view(), width: 120 });
    layout(button, 300, 40);

    expect(focusOutline(button)).toBeUndefined();

    setFocused(button, true);
    const outline = focusOutline(button);
    expect(button.focused).toBe(true);
    expect(outline?.visible).toBe(true);
    // The outline undoes the scale layout sized the view by.
    const scale = (button.displayObject as unknown as MockContainer).scale.x;
    expect(scale).toBeGreaterThan(1);
    expect(outline?.scale.x).toBeCloseTo(1 / scale);
    const box = onScreenRect(button);
    expect(box?.left).toBeCloseTo(0);
    expect((box?.right ?? 0) - (box?.left ?? 0)).toBeCloseTo(120);

    setFocused(button, false);
    expect(button.focused).toBe(false);
    expect(outline?.visible).toBe(false);
  });

  it("draws every edge at one thickness on a widget scaled per axis", () => {
    // Wider and shorter than the view, so the two axes scale differently.
    const button = new PixiFancyButton({ defaultView: view() });
    button.yogaNode.setWidth(220);
    button.yogaNode.setHeight(30);
    setFocused(button, true);
    layout(button, 220, 30);

    const buttonView = button.displayObject as unknown as MockContainer;
    expect(buttonView.scale.x).not.toBeCloseTo(buttonView.scale.y);

    const box = onScreenRect(button);
    expect((box?.right ?? 0) - (box?.left ?? 0)).toBeCloseTo(220);
    expect((box?.bottom ?? 0) - (box?.top ?? 0)).toBeCloseTo(30);

    const outline = focusOutline(button);
    const stroke = outline?.lastStrokeWidth ?? 0;
    expect(stroke).toBeGreaterThan(0);
    expect(stroke * (outline?.scale.y ?? 1) * buttonView.scale.y).toBeCloseTo(
      stroke * (outline?.scale.x ?? 1) * buttonView.scale.x,
    );
  });

  it("does not measure, so focus never resizes the widget", () => {
    // An outline that measured would become the widget's own reported size.
    const checkbox = new PixiCheckbox({
      checkedView: view(),
      uncheckedView: view(),
    });
    const checkboxView = checkbox.displayObject as unknown as MockContainer;
    checkbox.yogaNode.setWidth(64);
    checkbox.yogaNode.setHeight(24);
    layout(checkbox, 64, 24);

    const before = {
      width: checkboxView.width,
      height: checkboxView.height,
      bounds: checkboxView.getLocalBounds(),
    };

    setFocused(checkbox, true);
    layout(checkbox, 64, 24);

    const outline = focusOutline(checkbox);
    expect(outline?.lastRect).toMatchObject({
      width: before.bounds.width - 2,
      height: before.bounds.height - 2,
    });
    expect(checkboxView.width).toBe(before.width);
    expect(checkboxView.height).toBe(before.height);
    expect(checkboxView.getLocalBounds()).toEqual(before.bounds);
    expect(outline?.measurable).toBe(false);
  });

  it("rings what a wrapper that keeps its own size draws", () => {
    const checkbox = new PixiCheckbox({
      checkedView: view(),
      uncheckedView: view(),
    });
    const radio = new PixiRadioGroup({
      items: [{ checkedView: view(), uncheckedView: view(), text: "A" }],
      type: "vertical",
      elementsMargin: 0,
    });

    for (const wrapper of [checkbox, radio]) {
      const drawn = (
        wrapper.displayObject as unknown as MockContainer
      ).getLocalBounds();
      setFocused(wrapper, true);
      // A row far wider and taller than the widget.
      wrapper.yogaNode.setWidth(240);
      wrapper.yogaNode.setHeight(64);
      layout(wrapper, 240, 64);

      expect(onScreenRect(wrapper)).toEqual({
        left: 0,
        top: 0,
        right: drawn.width,
        bottom: drawn.height,
      });
    }
  });

  it("puts the outline on the drawn corner of a scaled widget", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    const buttonView = button.displayObject as unknown as MockContainer;
    // Art drawn above and left of the origin, on a widget sized by scaling.
    buttonView.ownX = -10;
    buttonView.ownY = -5;
    button.yogaNode.setWidth(120);
    button.yogaNode.setHeight(40);
    setFocused(button, true);
    layout(button, 120, 40);

    expect(buttonView.scale.x).toBeGreaterThan(1);
    const box = onScreenRect(button);
    expect(box?.left).toBeCloseTo(-10 * buttonView.scale.x);
    expect(box?.top).toBeCloseTo(-5 * buttonView.scale.y);
    expect(box?.right).toBeCloseTo(120);
    expect(box?.bottom).toBeCloseTo(40);
  });

  it.each([
    ["a centred sprite", () => new MockSprite(), [-10, -5, 210, 15]],
    [
      "a view that keeps its own origin",
      () => new MockGraphics(),
      [0, 0, 220, 25],
    ],
  ])(
    "outlines the whole travel of a slider knob that is %s, the same at every value",
    (_name, makeKnob, [left, top, right, bottom]) => {
      const track = new MockContainer();
      track.ownWidth = 200;
      track.ownHeight = 10;
      const knob = makeKnob();
      knob.ownWidth = 20;
      knob.ownHeight = 20;
      // Nine-sliced, so layout resizes the track rather than scaling the widget.
      const slider = new PixiSlider({
        bg: track as never,
        fill: view(),
        slider: knob as never,
        nineSliceSprite: [1, 1, 1, 1],
        value: 0,
        step: 50,
      });
      slider.yogaNode.setWidth(200);
      slider.yogaNode.setHeight(10);
      setFocused(slider, true);
      layout(slider, 200, 10);

      const expected = { left, top, right, bottom };
      expect(onScreenRect(slider)).toEqual(expected);

      // One step from the keyboard, then one update from the game.
      expect(adjust(slider, "right")).toBe(true);
      layout(slider, 200, 10);
      expect(onScreenRect(slider)).toEqual(expected);
      slider.update({ value: 100 });
      layout(slider, 200, 10);
      expect(onScreenRect(slider)).toEqual(expected);
    },
  );

  it("outlines a select's closed button, open or shut", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
    });
    // A row wider and taller than the 180x40 button the select draws.
    select.yogaNode.setWidth(240);
    select.yogaNode.setHeight(64);
    setFocused(select, true);
    layout(select, 240, 64);

    const closed = { left: 0, top: 0, right: 180, bottom: 40 };
    expect(onScreenRect(select)).toEqual(closed);

    select.activate();
    layout(select, 240, 64);

    // The open list is an overlay and the closed button is hidden.
    expect(onScreenRect(select)).toEqual(closed);
  });

  it("takes the colour and width the plugin themed, and a widget's override", () => {
    setUIFocusStyle({ color: 0x102030, width: 3 });
    const button = new PixiFancyButton({ defaultView: view(), width: 120 });
    const checkbox = new PixiCheckbox({
      checkedView: view(),
      uncheckedView: view(),
      focusStyle: { color: 0xff8800 },
    });

    for (const wrapper of [button, checkbox]) {
      setFocused(wrapper, true);
      layout(wrapper, 120, 40);
    }

    expect(focusOutline(button)?.lastStrokeColor).toBe(0x102030);
    expect(focusOutline(button)?.lastStrokeWidth).toBe(3);
    // The widget's own style wins field by field, so the themed width stays.
    expect(focusOutline(checkbox)?.lastStrokeColor).toBe(0xff8800);
    expect(focusOutline(checkbox)?.lastStrokeWidth).toBe(3);
  });

  it.each([
    ["pointerover", "hover"],
    ["pointerdown", "press"],
  ] as const)("asks for focus on %s with the %s trigger", (event, trigger) => {
    const slider = new PixiSlider({
      bg: view(),
      fill: view(),
      slider: view(),
    });

    (slider.displayObject as unknown as MockContainer).emit(event);

    const request = takePointerRequest();
    expect(request?.element).toBe(slider);
    expect(request?.trigger).toBe(trigger);
  });

  it("asks for nothing from a disabled widget the pointer presses", () => {
    const button = new PixiFancyButton({ defaultView: view(), disabled: true });

    (button.displayObject as unknown as MockContainer).emit("pointerdown");

    expect(takePointerRequest()).toBeNull();
  });
});

describe("PixiUI focus participation", () => {
  it("takes focus on the widgets that answer the player, and on a progress bar the game asks for", () => {
    const byWidget = Object.fromEntries(
      allWrappers().map((wrapper) => [
        wrapper.constructor.name,
        wrapper.focusable,
      ]),
    );

    expect(byWidget).toEqual({
      PixiFancyButton: true,
      PixiSlider: true,
      PixiInput: true,
      PixiCheckbox: true,
      PixiProgressBar: false,
      PixiSelect: true,
      PixiRadioGroup: true,
    });
    const bar = new PixiProgressBar({
      bg: view(),
      fill: view(),
      value: 50,
      focusable: true,
    });
    expect(bar.focusable).toBe(true);
  });

  it("makes no pointer request from a widget that only shows a value", () => {
    const bar = new PixiProgressBar({ bg: view(), fill: view(), value: 50 });
    const container = bar.displayObject as unknown as MockContainer;

    container.emit("pointerover");
    container.emit("pointerdown");

    expect(takePointerRequest()).toBeNull();
  });

  it("reports focus, navigation and the disabled flag to the Inspector", () => {
    const button = new PixiFancyButton({ defaultView: view(), disabled: true });

    expect(button._inspectState()).toEqual({
      focused: false,
      focusable: true,
      disabled: true,
    });

    setFocused(button, true);
    expect(button._inspectState()).toEqual({
      focused: true,
      focusable: true,
      disabled: true,
    });
  });
});

describe("PixiFancyButton activation", () => {
  it("does nothing while the button is disabled", () => {
    const onClick = vi.fn();
    const button = new PixiFancyButton({
      defaultView: view(),
      onClick,
      disabled: true,
    });

    expect(button.disabled).toBe(true);
    button.activate();
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("PixiFancyButton press feedback", () => {
  /** The face the wrapped widget is showing. */
  function face(button: PixiFancyButton): string {
    return (button.displayObject as unknown as MockFancyButton).state;
  }

  function containerOf(button: PixiFancyButton): MockContainer {
    return button.displayObject as unknown as MockContainer;
  }

  /** What Pixi dispatches for one mouse gesture: the pointer event, then the mouse one. */
  function mouse(
    button: PixiFancyButton,
    gesture: "over" | "out" | "down" | "up" | "upoutside",
  ): void {
    containerOf(button).emit(`pointer${gesture}`);
    containerOf(button).emit(`mouse${gesture}`);
  }

  /** Hold or release a confirm press the way a scope does. */
  function setPressed(element: UIElement, pressed: boolean): void {
    getFocusState(element)?.behavior.setPressed?.(pressed);
  }

  /** Run the element's action the way a scope does on a confirm release. */
  function confirmActivate(element: UIElement): void {
    getFocusState(element)?.behavior.activate?.();
  }

  it("shows the pressed face while a confirm press is held", () => {
    const button = new PixiFancyButton({ defaultView: view() });

    setPressed(button, true);
    expect(face(button)).toBe("pressed");

    setPressed(button, false);
    expect(face(button)).toBe("default");
  });

  it("rests on its default face after a confirm press no pointer made", () => {
    const onClick = vi.fn();
    const button = new PixiFancyButton({ defaultView: view(), onClick });

    expect(button.disabled).toBe(false);
    button.activate();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(face(button)).toBe("default");
  });

  it("leaves the hover face only while the pointer is over the button", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    containerOf(button).emit("pointerover");

    button.activate();
    expect(face(button)).toBe("hover");

    setPressed(button, true);
    expect(face(button)).toBe("pressed");
    setPressed(button, false);
    expect(face(button)).toBe("hover");

    containerOf(button).emit("pointerout");
    button.activate();
    expect(face(button)).toBe("default");
  });

  it("keeps the disabled face a callback turned on", () => {
    const button: PixiFancyButton = new PixiFancyButton({
      defaultView: view(),
      onClick: () => button.update({ disabled: true }),
    });

    button.activate();

    expect(button.disabled).toBe(true);
    expect(face(button)).toBe("disabled");
  });

  it("keeps the disabled face when a press held on it is dropped", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    setPressed(button, true);

    button.update({ disabled: true });
    setPressed(button, false);

    expect(face(button)).toBe("disabled");
  });

  it("holds the pressed face while the mouse crosses a button under confirm", () => {
    const button = new PixiFancyButton({ defaultView: view() });

    setPressed(button, true);
    expect(face(button)).toBe("pressed");

    mouse(button, "over");
    expect(face(button)).toBe("pressed");
    mouse(button, "out");
    expect(face(button)).toBe("pressed");

    setPressed(button, false);
    expect(face(button)).toBe("default");
  });

  it("holds the pressed face when confirm ends under a mouse still down", () => {
    const button = new PixiFancyButton({ defaultView: view() });

    mouse(button, "over");
    mouse(button, "down");
    expect(face(button)).toBe("pressed");

    setPressed(button, true);
    setPressed(button, false);
    expect(face(button)).toBe("pressed");

    mouse(button, "up");
    expect(face(button)).toBe("hover");
  });

  it.each([
    ["the scope's confirm", confirmActivate],
    ["the game's own call", (button: PixiFancyButton) => button.activate()],
  ])("keeps the mouse's pressed face when %s runs the action", (_name, run) => {
    const onClick = vi.fn();
    const button = new PixiFancyButton({ defaultView: view(), onClick });

    mouse(button, "over");
    mouse(button, "down");
    run(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(face(button)).toBe("pressed");

    mouse(button, "up");
    expect(face(button)).toBe("hover");
  });

  it.each(["up", "upoutside"] as const)(
    "holds a confirm press through a mouse click that ends with %s",
    (release) => {
      const button = new PixiFancyButton({ defaultView: view() });
      setPressed(button, true);

      mouse(button, "over");
      mouse(button, "down");
      mouse(button, release);
      expect(face(button)).toBe("pressed");

      setPressed(button, false);
      expect(face(button)).toBe("hover");
    },
  );

  it("ends the mouse's press when the pointer leaves the button", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    setPressed(button, true);

    mouse(button, "over");
    mouse(button, "down");
    mouse(button, "out");
    expect(face(button)).toBe("pressed");

    // Only the confirm press is left, so letting go of it rests the button.
    setPressed(button, false);
    expect(face(button)).toBe("default");
  });

  it("forgets a press the button was disabled under", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    mouse(button, "over");
    mouse(button, "down");
    setPressed(button, true);

    button.update({ disabled: true });
    expect(face(button)).toBe("disabled");

    // Enabling it again shows what it is under, not the presses it refused.
    button.update({ disabled: false });
    mouse(button, "up");
    mouse(button, "out");
    expect(face(button)).toBe("default");
  });
});

describe("PixiSelect press feedback", () => {
  /** The face the closed button is showing. */
  function closedFace(select: PixiSelect): string {
    return (
      select.displayObject as unknown as { openButton: { state: string } }
    ).openButton.state;
  }

  it("presses the closed button while a confirm press is held", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
    });

    getFocusState(select)?.behavior.setPressed?.(true);
    expect(closedFace(select)).toBe("pressed");

    getFocusState(select)?.behavior.setPressed?.(false);
    expect(closedFace(select)).toBe("default");
  });
});

describe("PixiCheckbox activation", () => {
  it("flips the box and reports it once, while an update stays silent", () => {
    const onChange = vi.fn();
    const checkbox = new PixiCheckbox({
      checkedView: view(),
      uncheckedView: view(),
      onChange,
    });

    checkbox.activate();
    expect(checkbox.displayObject).toMatchObject({ checked: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);

    onChange.mockClear();
    checkbox.update({ checked: false });
    expect(checkbox.displayObject).toMatchObject({ checked: false });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("PixiSlider stepping", () => {
  function steppable(props?: { value?: number }): PixiSlider {
    return new PixiSlider({
      bg: view(),
      fill: view(),
      slider: view(),
      min: 0,
      max: 100,
      step: 10,
      ...props,
    });
  }

  it("steps by the widget's step and reports the move and the settled value", () => {
    const onUpdate = vi.fn();
    const onChange = vi.fn();
    const slider = steppable();
    slider.update({ value: 50, onUpdate, onChange });
    onUpdate.mockClear();

    expect(adjust(slider, "right")).toBe(true);
    expect(slider.displayObject).toMatchObject({ value: 60 });
    expect(onUpdate).toHaveBeenCalledWith(60);
    expect(onChange).toHaveBeenCalledWith(60);

    expect(adjust(slider, "left")).toBe(true);
    expect(slider.displayObject).toMatchObject({ value: 50 });
  });

  it("releases the press at either end and on the other axis", () => {
    const slider = steppable();

    slider.update({ value: 100 });
    expect(adjust(slider, "right")).toBe(false);
    expect(slider.displayObject).toMatchObject({ value: 100 });

    slider.update({ value: 0 });
    expect(adjust(slider, "left")).toBe(false);
    expect(slider.displayObject).toMatchObject({ value: 0 });

    slider.update({ value: 50 });
    expect(adjust(slider, "up")).toBe(false);
    expect(adjust(slider, "down")).toBe(false);
    expect(slider.displayObject).toMatchObject({ value: 50 });
  });
});

describe("PixiSelect stepping", () => {
  function dropdown(): PixiSelect {
    return new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["Easy", "Normal", "Hard"],
      selected: 1,
    });
  }

  it("steps the closed selection and reports the new row", () => {
    const onSelect = vi.fn();
    const select = dropdown();
    select.update({ onSelect });

    expect(adjust(select, "right")).toBe(true);
    expect(select.displayObject).toMatchObject({
      value: 2,
      openButton: { text: "Hard" },
      closeButton: { text: "Hard" },
    });
    expect(onSelect).toHaveBeenCalledWith(2, "Hard");

    // At the last row the press is left for navigation.
    expect(adjust(select, "right")).toBe(false);

    expect(adjust(select, "left")).toBe(true);
    expect(adjust(select, "left")).toBe(true);
    expect(select.displayObject).toMatchObject({ value: 0 });
    expect(adjust(select, "left")).toBe(false);
  });
});

describe("PixiSelect open list", () => {
  interface SelectView {
    value: number;
    isOpen: boolean;
    highlighted: number;
    openButton: { text: string; visible: boolean };
    closeButton: { text: string };
    scrollBox: { items: { state: string }[]; scrolledTo: number };
  }

  function dropdown(): PixiSelect {
    return new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["Easy", "Normal", "Hard"],
      selected: 1,
    });
  }

  function inner(select: PixiSelect): SelectView {
    return select.displayObject as unknown as SelectView;
  }

  /** The face of every row, in order: `hover` is the highlighted one. */
  function faces(select: PixiSelect): string[] {
    return inner(select).scrollBox.items.map((row) => row.state);
  }

  it("shows the list and takes the scope's input on activate, and gives both back", () => {
    const select = dropdown();
    expect(isCapturingInput(select)).toBe(false);

    select.activate();
    expect(inner(select).openButton.visible).toBe(false);
    expect(isCapturingInput(select)).toBe(true);

    select.activate();
    expect(inner(select).openButton.visible).toBe(true);
    expect(isCapturingInput(select)).toBe(false);
  });

  it("opens with the current row lit and scrolled to", () => {
    const select = dropdown();
    select.activate();

    expect(inner(select).highlighted).toBe(1);
    expect(faces(select)).toEqual(["default", "hover", "default"]);
    expect(inner(select).scrollBox.scrolledTo).toBe(1);
  });

  it("moves the light on up and down, follows it with the list, and stops at either end", () => {
    const select = dropdown();
    select.activate();

    select.moveCapture("down");
    select.moveCapture("down");
    expect(faces(select)).toEqual(["default", "default", "hover"]);
    expect(inner(select).scrollBox.scrolledTo).toBe(2);

    select.moveCapture("up");
    select.moveCapture("up");
    select.moveCapture("up");
    expect(faces(select)).toEqual(["hover", "default", "default"]);
    expect(inner(select).scrollBox.scrolledTo).toBe(0);
  });

  it("leaves left and right to a game's own adjust handler", () => {
    const select = dropdown();
    select.activate();

    select.moveCapture("left");
    select.moveCapture("right");

    expect(inner(select).highlighted).toBe(1);
    expect(inner(select).value).toBe(-1);
    expect(inner(select).isOpen).toBe(true);
  });

  it("commits the lit row on confirm and closes on it", () => {
    const onSelect = vi.fn();
    const select = dropdown();
    select.update({ onSelect });
    select.activate();

    select.moveCapture("down");
    select.confirmCapture();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(2, "Hard");
    expect(inner(select)).toMatchObject({
      value: 2,
      isOpen: false,
      openButton: { text: "Hard", visible: true },
      closeButton: { text: "Hard" },
    });
    expect(isCapturingInput(select)).toBe(false);
    expect(faces(select)).toEqual(["default", "default", "default"]);
  });

  it.each([
    ["cancel reaches it", (select: PixiSelect) => select.cancelCapture()],
    ["focus leaves it", (select: PixiSelect) => select.releaseCapture()],
  ])("closes on the value it had when %s", (_name, end) => {
    const onSelect = vi.fn();
    const select = dropdown();
    select.update({ onSelect });
    select.activate();

    select.moveCapture("down");
    end(select);

    expect(onSelect).not.toHaveBeenCalled();
    expect(inner(select)).toMatchObject({
      value: -1,
      isOpen: false,
      openButton: { text: "Normal", visible: true },
    });
    expect(isCapturingInput(select)).toBe(false);
  });

  it("opens on the row the player picked, not the one the game authored", () => {
    const select = dropdown();
    select.activate();
    select.moveCapture("down");
    select.confirmCapture();

    select.activate();
    expect(inner(select).highlighted).toBe(2);
  });

  it("lights a row of the replacement list when the items change under it", () => {
    const select = dropdown();
    select.activate();

    select.update({ items: ["A", "B"], selected: 1 });

    expect(inner(select).highlighted).toBe(1);
    expect(faces(select)).toEqual(["default", "hover"]);
  });
});

describe("PixiRadioGroup stepping", () => {
  function group(type: "vertical" | "horizontal"): PixiRadioGroup {
    return new PixiRadioGroup({
      items: [
        { checkedView: view(), uncheckedView: view(), text: "A" },
        { checkedView: view(), uncheckedView: view(), text: "B" },
      ],
      type,
      elementsMargin: 0,
    });
  }

  it("steps along its own axis, reports the choice, and stops at either end", () => {
    const onChange = vi.fn();
    const vertical = group("vertical");
    vertical.update({ onChange });

    expect(adjust(vertical, "up")).toBe(false);
    expect(adjust(vertical, "down")).toBe(true);
    expect(vertical.displayObject).toMatchObject({ selected: 1 });
    expect(onChange).toHaveBeenCalledWith(1, "B");

    expect(adjust(vertical, "down")).toBe(false);
    expect(adjust(vertical, "right")).toBe(false);
    expect(adjust(vertical, "left")).toBe(false);
    expect(vertical.displayObject).toMatchObject({ selected: 1 });
  });

  it("claims left and right when it stacks across", () => {
    const horizontal = group("horizontal");

    expect(adjust(horizontal, "down")).toBe(false);
    expect(adjust(horizontal, "right")).toBe(true);
    expect(horizontal.displayObject).toMatchObject({ selected: 1 });
  });
});

describe("PixiInput editing", () => {
  /** A key press arriving at the hidden DOM field `Input` listens on. */
  function typeKey(field: PixiInput, key: string): void {
    (
      field.displayObject as unknown as {
        onKeyUpBinding(e: KeyboardEvent): void;
      }
    ).onKeyUpBinding({ key } as KeyboardEvent);
  }

  it("takes and gives back the caret", () => {
    const field = new PixiInput({ bg: view(), value: "Ada" });

    expect(field.isEditing).toBe(false);
    expect(isCapturingInput(field)).toBe(false);

    field.activate();
    expect(field.isEditing).toBe(true);
    expect(isCapturingInput(field)).toBe(true);

    field.commitEditing();
    expect(field.isEditing).toBe(false);
    expect(isCapturingInput(field)).toBe(false);
  });

  it.each<[string, (field: PixiInput) => void, string]>([
    ["cancelEditing", (field) => field.cancelEditing(), "Ada"],
    ["the scope's cancel", (field) => field.cancelCapture(), "Ada"],
    ["Escape in the field itself", (field) => typeKey(field, "Escape"), "Ada"],
    ["commitEditing", (field) => field.commitEditing(), "Adabcd"],
    ["the scope's confirm", (field) => field.confirmCapture(), "Adabcd"],
    [
      "the scope taking its input back",
      (field) => field.releaseCapture(),
      "Adabcd",
    ],
    ["Enter in the field itself", (field) => typeKey(field, "Enter"), "Adabcd"],
  ])(
    "ends the edit on %s and reports the value it leaves",
    (_name, end, value) => {
      const onEnter = vi.fn();
      const field = new PixiInput({ bg: view(), value: "Ada", onEnter });

      field.activate();
      field.update({ value: "Adabcd" });
      end(field);

      expect(field.displayObject).toMatchObject({ value });
      expect(field.isEditing).toBe(false);
      expect(isCapturingInput(field)).toBe(false);
      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(onEnter).toHaveBeenCalledWith(value);
    },
  );

  it("takes a typed character to the field", () => {
    const onChange = vi.fn();
    const field = new PixiInput({ bg: view(), value: "Ad", onChange });

    field.activate();
    typeKey(field, "a");

    expect(field.displayObject).toMatchObject({ value: "Ada" });
    expect(field.isEditing).toBe(true);
    expect(onChange).toHaveBeenCalledWith("Ada");
  });

  it.each([
    [
      "a select with its list open",
      () =>
        new PixiSelect({ closedBG: view(), openBG: view(), items: ["A", "B"] }),
    ],
    ["a field mid-edit", () => new PixiInput({ bg: view(), value: "Ada" })],
  ])("gives the scope's input back when %s is destroyed", (_name, make) => {
    const element = make();
    element.activate();
    expect(isCapturingInput(element)).toBe(true);

    element.destroy();
    expect(isCapturingInput(element)).toBe(false);
  });
});
