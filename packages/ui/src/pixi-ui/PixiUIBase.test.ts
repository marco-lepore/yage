import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockSignal {
    callbacks = new Set<(...args: never[]) => void>();
    connect(callback: (...args: never[]) => void): void {
      this.callbacks.add(callback);
    }
    disconnect(callback: (...args: never[]) => void): void {
      this.callbacks.delete(callback);
    }
    emit(...args: unknown[]): void {
      for (const callback of [...this.callbacks]) {
        (callback as (...a: unknown[]) => void)(...args);
      }
    }
  }

  interface MockBounds {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    position = {
      x: 0,
      y: 0,
      set(x: number, y = x): void {
        this.x = x;
        this.y = y;
      },
    };
    scale = {
      x: 1,
      y: 1,
      set(x: number, y = x): void {
        this.x = x;
        this.y = y;
      },
    };
    worldTransform = {
      clone: () => ({ invert: () => ({ append: () => ({}) }) }),
    };
    visible = true;
    /** Pixi v8 leaves a child out of `getLocalBounds` unless it measures. */
    measurable = true;
    eventMode: string | undefined;
    destroyed = false;
    zIndex = 0;
    rotation = 0;
    /**
     * The box this container draws itself, before any child is folded in.
     * The origin is part of it, so a mock can draw above or left of its own
     * position the way a centred sprite does.
     */
    ownX = 0;
    ownY = 0;
    ownWidth = 20;
    ownHeight = 10;
    private readonly listeners = new Map<string, Set<() => void>>();

    on(event: string, handler: () => void): this {
      let handlers = this.listeners.get(event);
      if (!handlers) {
        handlers = new Set();
        this.listeners.set(event, handlers);
      }
      handlers.add(handler);
      return this;
    }
    off(event: string, handler: () => void): this {
      this.listeners.get(event)?.delete(handler);
      return this;
    }
    emit(event: string): void {
      for (const handler of [...(this.listeners.get(event) ?? [])]) handler();
    }

    /**
     * Pixi v8's rule: a child that is hidden or does not measure is skipped,
     * and one that is folded in carries its own position and scale, so a part
     * drawn outside this container's box widens the bounds on that side.
     */
    getLocalBounds(): MockBounds {
      let minX = this.ownX;
      let minY = this.ownY;
      let maxX = this.ownX + this.ownWidth;
      let maxY = this.ownY + this.ownHeight;
      for (const child of this.children) {
        if (!child.visible || !child.measurable) continue;
        const bounds = child.getLocalBounds();
        const left = child.position.x + bounds.x * child.scale.x;
        const top = child.position.y + bounds.y * child.scale.y;
        minX = Math.min(minX, left);
        minY = Math.min(minY, top);
        maxX = Math.max(maxX, left + bounds.width * child.scale.x);
        maxY = Math.max(maxY, top + bounds.height * child.scale.y);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    get width(): number {
      return Math.abs(this.scale.x * this.getLocalBounds().width);
    }
    set width(value: number) {
      const local = this.getLocalBounds().width;
      this.scale.x = local !== 0 ? value / local : 1;
    }
    get height(): number {
      return Math.abs(this.scale.y * this.getLocalBounds().height);
    }
    set height(value: number) {
      const local = this.getLocalBounds().height;
      this.scale.y = local !== 0 ? value / local : 1;
    }

    addChild(child: MockContainer): MockContainer {
      child.removeFromParent();
      this.children.push(child);
      child.parent = this;
      return child;
    }
    addChildAt(child: MockContainer, index: number): MockContainer {
      child.removeFromParent();
      this.children.splice(index, 0, child);
      child.parent = this;
      return child;
    }
    getChildIndex(child: MockContainer): number {
      return this.children.indexOf(child);
    }
    removeChild(child: MockContainer): MockContainer {
      const index = this.children.indexOf(child);
      if (index !== -1) this.children.splice(index, 1);
      child.parent = null;
      return child;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    setFromMatrix(): void {}
    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  /** Records the last shape drawn, so a test can read the outline's geometry. */
  class MockGraphics extends MockContainer {
    lastRect: {
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
    } | null = null;
    lastStrokeColor = 0;
    lastStrokeWidth = 0;
    constructor() {
      super();
      this.ownWidth = 0;
      this.ownHeight = 0;
    }
    clear(): this {
      this.lastRect = null;
      return this;
    }
    roundRect(
      x: number,
      y: number,
      width: number,
      height: number,
      radius = 0,
    ): this {
      this.lastRect = { x, y, width, height, radius };
      this.ownX = x;
      this.ownY = y;
      this.ownWidth = width;
      this.ownHeight = height;
      return this;
    }
    stroke(style: { color: number; width: number }): this {
      this.lastStrokeColor = style.color;
      this.lastStrokeWidth = style.width;
      return this;
    }
  }

  type ButtonState = "default" | "hover" | "pressed" | "disabled";

  /**
   * @pixi/ui's own state machine, which is the part that matters here: the
   * widget hangs its view swapping off the press signal a wrapper emits and
   * off the pointer itself, and lands on the face a mouse release leaves
   * behind. `enabled` writes the state too, so a callback that disables the
   * button moves it.
   *
   * The pointer handlers are on the `mouse*` names, which is the pair
   * @pixi/ui connects on anything that is not a touch device, and they carry
   * the two flags that guard the swaps: a press already held keeps its face
   * while the mouse crosses the button, and a release only counts where a
   * press started here.
   */
  class MockFancyButton extends MockContainer {
    onPress = new MockSignal();
    textView = { style: {} };
    text = "";
    state: ButtonState = "default";
    private _enabled = true;
    private _isDown = false;
    private _isMouseIn = false;
    constructor() {
      super();
      this.onPress.connect(() => this.setState("hover"));
      this.on("mousedown", () => {
        this._isDown = true;
        this.setState("pressed");
      });
      this.on("mouseup", () => {
        if (this._isDown) this.setState("hover");
        this._isDown = false;
      });
      this.on("mouseupoutside", () => {
        if (this._isDown) this.setState("default");
        this._isDown = false;
      });
      this.on("mouseover", () => {
        this._isMouseIn = true;
        if (!this._isDown) this.setState("hover");
      });
      this.on("mouseout", () => {
        if (!this._isMouseIn) return;
        this._isMouseIn = false;
        if (!this._isDown) this.setState("default");
      });
    }
    get enabled(): boolean {
      return this._enabled;
    }
    set enabled(enabled: boolean) {
      this._enabled = enabled;
      this.setState(enabled ? "default" : "disabled");
    }
    setState(state: ButtonState): void {
      this.state = state;
    }
  }

  /**
   * Track and knob as @pixi/ui builds them: the knob art is anchored at its
   * centre inside a container parked on the track's mid-line and on the
   * value's place along the track, so it overhangs both ends and, where its
   * art is taller than the track, above and below it too.
   */
  class MockSlider extends MockContainer {
    onChange = new MockSignal();
    onUpdate = new MockSignal();
    min: number;
    max: number;
    step: number;
    /** The track. `nineSliceSprite` resizes it instead of scaling the slider. */
    protected bg: MockContainer;
    private readonly _knob: MockContainer;
    private readonly _nineSlice: boolean;
    private _value: number;
    constructor(options?: {
      value?: number;
      min?: number;
      max?: number;
      step?: number;
      bg?: MockContainer;
      slider?: MockContainer;
      nineSliceSprite?: unknown;
    }) {
      super();
      this.ownWidth = 0;
      this.ownHeight = 0;
      this.min = options?.min ?? 0;
      this.max = options?.max ?? 100;
      this.step = options?.step ?? 1;
      this._value = options?.value ?? this.min;
      this._nineSlice = options?.nineSliceSprite !== undefined;

      this.bg = options?.bg ?? new MockContainer();
      this.addChild(this.bg);

      const art = options?.slider ?? new MockContainer();
      art.position.set(0, -art.ownHeight / 2);
      this._knob = new MockContainer();
      this._knob.ownWidth = 0;
      this._knob.ownHeight = 0;
      this._knob.addChild(art);
      this.addChild(this._knob);
      this._updateSlider();
    }
    /** `SliderBase.slider1` — the container that holds the knob art. */
    get slider1(): MockContainer {
      return this._knob;
    }
    get value(): number {
      return this._value;
    }
    set value(next: number) {
      if (next === this._value) return;
      this._value = next;
      this._updateSlider();
      this.onUpdate.emit(next);
    }
    override get width(): number {
      return super.width;
    }
    override set width(value: number) {
      if (this._nineSlice) {
        this.bg.ownWidth = value;
        this._updateSlider();
        return;
      }
      super.width = value;
    }
    override get height(): number {
      return super.height;
    }
    override set height(value: number) {
      if (this._nineSlice) {
        this.bg.ownHeight = value;
        this._updateSlider();
        return;
      }
      super.height = value;
    }
    /** `Slider.change()` — protected, and the only emitter of `onChange`. */
    protected change(): void {
      this.onChange.emit(this._value);
    }
    private _updateSlider(): void {
      const span = this.max - this.min || 1;
      const progress = ((this._value - this.min) / span) * 100;
      const knobWidth = this._knob.width;
      this._knob.position.set(
        (this.bg.width / 100) * progress - knobWidth / 2,
        this.bg.height / 2,
      );
    }
  }

  class MockInput extends MockContainer {
    onChange = new MockSignal();
    onEnter = new MockSignal();
    protected placeholder = { text: "", visible: false };
    protected editing = false;
    private _value = "";
    secure = false;
    padding: number | number[] = 0;
    /**
     * `Input`'s own keydown listener on the hidden DOM field, bound in its
     * constructor and so resolved against the instance: a subclass override
     * is what the field runs. Public here because a test stands in for the
     * DOM field and calls it.
     */
    readonly onKeyUpBinding: (e: KeyboardEvent) => void =
      this.onKeyUp.bind(this);
    constructor(options?: { placeholder?: string; value?: string }) {
      super();
      this.placeholder.text = options?.placeholder ?? "";
      this.placeholder.visible = !!options?.placeholder;
      this.value = options?.value ?? "";
    }
    get value(): string {
      return this._value;
    }
    set value(text: string) {
      this._value = text;
      this.placeholder.visible = text.length === 0 && !this.editing;
    }
    /** `Input.onKeyUp` — Escape and Enter both end the edit as it stands. */
    protected onKeyUp(e: KeyboardEvent): void {
      const key = e.key;
      if (key === "Escape" || key === "Enter") this.stopEditing();
      else if (key.length === 1) this._add(key);
    }
    protected _add(key: string): void {
      if (!this.editing) return;
      this.value = this.value + key;
      this.onChange.emit(this.value);
    }
    protected _startEditing(): void {
      this.editing = true;
      this.placeholder.visible = false;
    }
    protected stopEditing(): void {
      if (!this.editing) return;
      this.editing = false;
      this.placeholder.visible = this.value.length === 0;
      this.onEnter.emit(this.value);
    }
    // `Input.destroy()` deliberately leaves an edit in progress running.
  }

  class MockCheckBox extends MockContainer {
    onCheck = new MockSignal();
    text = "";
    private _checked = false;
    constructor(options?: { checked?: boolean; text?: string }) {
      super();
      this._checked = options?.checked ?? false;
      this.text = options?.text ?? "";
    }
    get checked(): boolean {
      return this._checked;
    }
    /** Routes through the widget's switch, so it reports the new state. */
    set checked(checked: boolean) {
      this._checked = checked;
      this.onCheck.emit(checked);
    }
    /** The setter @pixi/ui documents as the silent one. */
    forceCheck(checked: boolean): void {
      this._checked = checked;
    }
  }

  class MockProgressBar extends MockContainer {
    progress = 0;
    constructor(options?: { progress?: number }) {
      super();
      this.progress = options?.progress ?? 0;
    }
  }

  /**
   * @pixi/ui's dropdown, including the two parts a keyboard driver needs:
   * the rows are ordinary `FancyButton`s in the scroll box, and the whole
   * commit — the value, `onSelect`, both labels, the close — hangs off each
   * row's own press signal.
   */
  class MockSelect extends MockContainer {
    protected view = new MockContainer();
    protected scrollBox = {
      items: [] as MockFancyButton[],
      /** The row `scrollTo` was last asked for. */
      scrolledTo: -1,
      removeItems(): void {
        this.items.length = 0;
      },
      scrollTo(index: number): void {
        this.scrolledTo = index;
      },
    };
    protected openButton = {
      text: "",
      visible: true,
      state: "default" as ButtonState,
      setState(state: ButtonState): void {
        this.state = state;
      },
      getLocalBounds: () => ({ width: 180, height: 40 }),
    };
    protected closeButton = { text: "" };
    onSelect = new MockSignal();
    /** @pixi/ui leaves this at -1 until a row is picked. */
    value = -1;
    addedItems: unknown;
    constructor(options?: { selected?: number; items?: unknown }) {
      super();
      this.addedItems = options?.items;
      const items = (options?.items as { items?: string[] } | undefined)?.items;
      this.openButton.text = items?.[options?.selected ?? 0] ?? "";
      this.closeButton.text = this.openButton.text;
      this.view.visible = false;
      this.addChild(this.view);
      // `init` builds the rows without touching `value`.
      this.buildRows(options?.items);
    }
    addItems(items: unknown, selected = 0): void {
      this.addedItems = items;
      this.value = selected;
      this.buildRows(items);
    }
    toggle(): void {
      this.view.visible = !this.view.visible;
      this.openButton.visible = !this.openButton.visible;
    }
    open(): void {
      this.view.visible = true;
      this.openButton.visible = false;
    }
    close(): void {
      this.view.visible = false;
      this.openButton.visible = true;
    }
    private buildRows(items: unknown): void {
      const labels = (items as { items?: string[] } | undefined)?.items ?? [];
      labels.forEach((label, id) => {
        const row = new MockFancyButton();
        row.text = label;
        row.onPress.connect(() => {
          this.value = id;
          this.onSelect.emit(id, label);
          this.openButton.text = label;
          this.closeButton.text = label;
          this.close();
        });
        this.scrollBox.items.push(row);
      });
    }
  }

  class MockRadioGroup extends MockContainer {
    protected items: MockCheckBox[];
    protected options: {
      items: MockCheckBox[];
      type?: string;
      selectedItem?: number;
    };
    onChange = new MockSignal();
    selected: number;
    value = "";
    constructor(options?: {
      items?: MockCheckBox[];
      type?: string;
      selectedItem?: number;
    }) {
      super();
      this.items = options?.items ?? [];
      this.options = {
        items: this.items,
        type: options?.type,
        selectedItem: options?.selectedItem,
      };
      this.selected = options?.selectedItem ?? 0;
    }
    addItems(items: MockCheckBox[]): void {
      this.items.push(...items);
    }
    removeItems(ids: number[]): void {
      for (const id of ids) this.items.splice(id, 1);
    }
    selectItem(selected: number): void {
      // @pixi/ui reads the row's label with no bounds check, so an unclamped
      // step throws rather than doing nothing.
      const text = (this.items[selected] as MockCheckBox).text;
      this.items.forEach((item, index) => item.forceCheck(index === selected));
      if (this.selected !== selected) this.onChange.emit(selected, text);
      this.selected = selected;
      this.value = text;
    }
  }

  return {
    mocks: {
      MockContainer,
      MockGraphics,
      MockFancyButton,
      MockSlider,
      MockInput,
      MockCheckBox,
      MockProgressBar,
      MockSelect,
      MockRadioGroup,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Sprite: mocks.MockContainer,
  Texture: class MockTexture {
    readonly mock = true;
  },
}));

vi.mock("@pixi/ui", () => ({
  FancyButton: mocks.MockFancyButton,
  Slider: mocks.MockSlider,
  Input: mocks.MockInput,
  CheckBox: mocks.MockCheckBox,
  ProgressBar: mocks.MockProgressBar,
  Select: mocks.MockSelect,
  RadioGroup: mocks.MockRadioGroup,
}));

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

beforeAll(() => setYoga(Yoga));
beforeEach(() => {
  takePointerRequest();
  setUIFocusStyle(undefined);
});

const view = (): never => new mocks.MockContainer() as never;

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
function focusOutline(element: UIElement): mocks.MockGraphics | undefined {
  const children = (element.displayObject as unknown as mocks.MockContainer)
    .children;
  return children.find(
    (child): child is mocks.MockGraphics => child instanceof mocks.MockGraphics,
  );
}

/** Ask an element's own stepper to take a direction, as a scope does. */
function adjust(element: UIElement, direction: FocusDirection): boolean {
  return getFocusState(element)?._adjust(direction) === true;
}

function allWrappers(): PixiUIBase<mocks.MockContainer>[] {
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
  ] as unknown as PixiUIBase<mocks.MockContainer>[];
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
  // An outline is drawn only where one is asked for, so these boxes are
  // measured against the outline a game asks for once for the whole UI.
  beforeEach(() => setUIFocusStyle({}));

  /** What the outline's rectangle comes to on screen, through both scales. */
  function onScreenRect(
    element: UIElement,
  ): { left: number; top: number; right: number; bottom: number } | undefined {
    const outline = focusOutline(element);
    const rect = outline?.lastRect;
    if (!outline || !rect) return undefined;
    const viewScale = (element.displayObject as unknown as mocks.MockContainer)
      .scale;
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
    // Layout reaches this widget's size by scaling its view, and the outline
    // undoes that scale, so the 120 px box comes out at 120 px on screen.
    const scale = (button.displayObject as unknown as mocks.MockContainer).scale
      .x;
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
    // A box much wider and a little shorter than the widget's own view.
    // `applyLayout` writes width and height independently, so the view ends
    // up with two different scales.
    const button = new PixiFancyButton({ defaultView: view() });
    button.yogaNode.setWidth(220);
    button.yogaNode.setHeight(30);
    setFocused(button, true);
    layout(button, 220, 30);

    const buttonView = button.displayObject as unknown as mocks.MockContainer;
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
    // A box layout stretched well past the widget's own size: an outline that
    // measured would become the widget's local bounds and so its reported
    // size and the intrinsic size the measure function hands Yoga back.
    const checkbox = new PixiCheckbox({
      checkedView: view(),
      uncheckedView: view(),
    });
    const checkboxView =
      checkbox.displayObject as unknown as mocks.MockContainer;
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
        wrapper.displayObject as unknown as mocks.MockContainer
      ).getLocalBounds();
      setFocused(wrapper, true);
      // A row far wider and taller than the widget, the way a column
      // stretches every child to its own width.
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

  it("covers a part the widget draws outside its layout box", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    const buttonView = button.displayObject as unknown as mocks.MockContainer;
    // A label reaching left of the widget's origin and below its box.
    buttonView.ownX = -8;
    buttonView.ownHeight = 40;
    button.yogaNode.setWidth(64);
    button.yogaNode.setHeight(24);
    setFocused(button, true);
    layout(button, 64, 24);

    const box = onScreenRect(button);
    expect(box?.left).toBeCloseTo(-8 * buttonView.scale.x);
    expect(box?.right).toBeCloseTo(64);
    expect(box?.top).toBeCloseTo(0);
    expect(box?.bottom).toBeCloseTo(40 * buttonView.scale.y);
  });

  it("puts the outline on the drawn corner of a scaled widget", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    const buttonView = button.displayObject as unknown as mocks.MockContainer;
    // Art drawn above and left of the widget's own origin, the way a
    // centre-anchored face is, on a widget layout sizes by scaling.
    buttonView.ownX = -10;
    buttonView.ownY = -5;
    button.yogaNode.setWidth(120);
    button.yogaNode.setHeight(40);
    setFocused(button, true);
    layout(button, 120, 40);

    expect(buttonView.scale.x).toBeGreaterThan(1);
    // The corner and the extent are read in one space, so the outline lands on
    // the art rather than being offset by the scale on one of them.
    const box = onScreenRect(button);
    expect(box?.left).toBeCloseTo(-10 * buttonView.scale.x);
    expect(box?.top).toBeCloseTo(-5 * buttonView.scale.y);
    expect(box?.right).toBeCloseTo(120);
    expect(box?.bottom).toBeCloseTo(40);
  });

  it("outlines the slider's whole knob travel, the same at every value", () => {
    // The example's slider: a 200x16 track with a 24x32 knob, nine-sliced so
    // the track resizes in place rather than scaling the widget.
    const track = new mocks.MockContainer();
    track.ownWidth = 200;
    track.ownHeight = 16;
    const knob = new mocks.MockContainer();
    knob.ownWidth = 24;
    knob.ownHeight = 32;
    const slider = new PixiSlider({
      bg: track as never,
      fill: view(),
      slider: knob as never,
      nineSliceSprite: [1, 1, 1, 1],
      value: 0,
    });
    slider.yogaNode.setWidth(200);
    slider.yogaNode.setHeight(16);
    setFocused(slider, true);
    layout(slider, 200, 16);

    // Track y 0 to 16, knob y -8 to 24 and reaching 12 px past each end.
    const expected = { left: -12, top: -8, right: 212, bottom: 24 };
    expect(onScreenRect(slider)).toEqual(expected);

    for (const value of [50, 100]) {
      slider.update({ value });
      layout(slider, 200, 16);
      expect(onScreenRect(slider)).toEqual(expected);
    }
  });

  it("keeps the slider's outline still when a step moves the knob", () => {
    const track = new mocks.MockContainer();
    track.ownWidth = 200;
    track.ownHeight = 16;
    const knob = new mocks.MockContainer();
    knob.ownWidth = 24;
    knob.ownHeight = 32;
    const slider = new PixiSlider({
      bg: track as never,
      fill: view(),
      slider: knob as never,
      nineSliceSprite: [1, 1, 1, 1],
      value: 0,
      step: 10,
    });
    slider.yogaNode.setWidth(200);
    slider.yogaNode.setHeight(16);
    setFocused(slider, true);
    layout(slider, 200, 16);
    const before = onScreenRect(slider);

    // At 0 the knob hangs off the left end and at 10 it sits inside the
    // track, so an outline measured from what is drawn would shrink here.
    expect(adjust(slider, "right")).toBe(true);
    layout(slider, 200, 16);

    expect(onScreenRect(slider)).toEqual(before);
  });

  it("outlines a select's closed button, open or shut", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
    });
    // A row wider and taller than the button the select draws, which is what
    // a column of widgets gives every child.
    select.yogaNode.setWidth(240);
    select.yogaNode.setHeight(64);
    setFocused(select, true);
    layout(select, 240, 64);

    // The button is 180x40, so an outline on the layout box would reach past
    // the only part of the select on screen.
    const closed = { left: 0, top: 0, right: 180, bottom: 40 };
    expect(onScreenRect(select)).toEqual(closed);

    select.activate();
    layout(select, 240, 64);

    // The open list is an overlay on the stage and the closed button is
    // hidden, so the outline stays on the slot the closed button occupies.
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

  it("asks for hover focus from the widget the pointer reaches", () => {
    const slider = new PixiSlider({
      bg: view(),
      fill: view(),
      slider: view(),
    });

    (slider.displayObject as unknown as mocks.MockContainer).emit(
      "pointerover",
    );

    const request = takePointerRequest();
    expect(request?.element).toBe(slider);
    expect(request?.trigger).toBe("hover");
  });

  it("asks for press focus from the widget the pointer presses", () => {
    const slider = new PixiSlider({
      bg: view(),
      fill: view(),
      slider: view(),
    });

    (slider.displayObject as unknown as mocks.MockContainer).emit(
      "pointerdown",
    );

    const request = takePointerRequest();
    expect(request?.element).toBe(slider);
    expect(request?.trigger).toBe("press");
  });

  it("asks for nothing from a disabled widget the pointer presses", () => {
    const button = new PixiFancyButton({ defaultView: view(), disabled: true });

    (button.displayObject as unknown as mocks.MockContainer).emit(
      "pointerdown",
    );

    expect(takePointerRequest()).toBeNull();
  });
});

describe("PixiUI focus participation", () => {
  it("takes focus on the widgets that answer the player", () => {
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
  });

  it("puts a progress bar in navigation only when the game asks", () => {
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
    const container = bar.displayObject as unknown as mocks.MockContainer;

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
  it("runs the click callback once and reads the widget's enabled flag", () => {
    const onClick = vi.fn();
    const button = new PixiFancyButton({ defaultView: view(), onClick });

    expect(button.disabled).toBe(false);
    button.activate();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

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
    return (button.displayObject as unknown as mocks.MockFancyButton).state;
  }

  function containerOf(button: PixiFancyButton): mocks.MockContainer {
    return button.displayObject as unknown as mocks.MockContainer;
  }

  /**
   * What Pixi dispatches for one mouse gesture: the pointer event, and then
   * the mouse one. The order is what makes the widget's own face swap land
   * after the wrapper's listener, which is the whole difficulty.
   */
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

    button.activate();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(face(button)).toBe("default");
  });

  it("leaves the hover face where the pointer really is over it", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    (button.displayObject as unknown as mocks.MockContainer).emit(
      "pointerover",
    );

    button.activate();
    expect(face(button)).toBe("hover");

    setPressed(button, true);
    expect(face(button)).toBe("pressed");
    setPressed(button, false);
    expect(face(button)).toBe("hover");
  });

  it("gives the default face back once the pointer has left", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    const container = button.displayObject as unknown as mocks.MockContainer;
    container.emit("pointerover");
    container.emit("pointerout");

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

  it("holds the pressed face when confirm activates it under a mouse still down", () => {
    const onClick = vi.fn();
    const button = new PixiFancyButton({ defaultView: view(), onClick });

    mouse(button, "over");
    mouse(button, "down");
    confirmActivate(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(face(button)).toBe("pressed");

    mouse(button, "up");
    expect(face(button)).toBe("hover");
  });

  it("keeps the pressed face when the game runs the action under a held mouse", () => {
    const onClick = vi.fn();
    const button = new PixiFancyButton({ defaultView: view(), onClick });

    mouse(button, "over");
    mouse(button, "down");

    // The game's own call, not the scope's: nothing reclaims the face
    // afterwards, so `activate` has to leave the mouse's press showing.
    button.activate();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(face(button)).toBe("pressed");

    mouse(button, "up");
    expect(face(button)).toBe("hover");
  });

  it("holds a confirm press through a whole mouse click on the button", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    setPressed(button, true);

    mouse(button, "over");
    mouse(button, "down");
    expect(face(button)).toBe("pressed");
    mouse(button, "up");
    expect(face(button)).toBe("pressed");

    setPressed(button, false);
    expect(face(button)).toBe("hover");
  });

  it("holds a confirm press through a mouse release that lands elsewhere", () => {
    const button = new PixiFancyButton({ defaultView: view() });
    setPressed(button, true);

    mouse(button, "over");
    mouse(button, "down");
    mouse(button, "upoutside");
    expect(face(button)).toBe("pressed");

    setPressed(button, false);
    expect(face(button)).toBe("hover");
  });

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

    // Enabling the button again shows what it is under now, not the presses
    // it refused.
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

  it("opens and closes the list", () => {
    const select = dropdown();
    const selectView = select.displayObject as unknown as {
      openButton: { visible: boolean };
    };

    select.activate();
    expect(selectView.openButton.visible).toBe(false);

    select.activate();
    expect(selectView.openButton.visible).toBe(true);
  });

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

  it("takes the scope's input while the list shows, and gives it back", () => {
    const select = dropdown();
    expect(isCapturingInput(select)).toBe(false);

    select.activate();
    expect(isCapturingInput(select)).toBe(true);

    select.activate();
    expect(isCapturingInput(select)).toBe(false);
  });

  it("opens with the current row lit and scrolled to", () => {
    const select = dropdown();
    select.activate();

    expect(inner(select).highlighted).toBe(1);
    expect(faces(select)).toEqual(["default", "hover", "default"]);
    expect(inner(select).scrollBox.scrolledTo).toBe(1);
  });

  it("moves the light on up and down, and follows it with the list", () => {
    const select = dropdown();
    select.activate();

    select.moveCapture("down");
    expect(faces(select)).toEqual(["default", "default", "hover"]);
    expect(inner(select).scrollBox.scrolledTo).toBe(2);

    select.moveCapture("up");
    select.moveCapture("up");
    expect(faces(select)).toEqual(["hover", "default", "default"]);
    expect(inner(select).scrollBox.scrolledTo).toBe(0);
  });

  it("stops at either end of the list", () => {
    const select = dropdown();
    select.activate();

    select.moveCapture("up");
    select.moveCapture("up");
    expect(inner(select).highlighted).toBe(0);
    select.moveCapture("up");
    expect(inner(select).highlighted).toBe(0);

    select.moveCapture("down");
    select.moveCapture("down");
    expect(inner(select).highlighted).toBe(2);
    select.moveCapture("down");
    expect(inner(select).highlighted).toBe(2);
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

  it("closes on the value it had when cancel reaches it", () => {
    const onSelect = vi.fn();
    const select = dropdown();
    select.update({ onSelect });
    select.activate();

    select.moveCapture("down");
    select.cancelCapture();

    expect(onSelect).not.toHaveBeenCalled();
    expect(inner(select)).toMatchObject({
      value: -1,
      isOpen: false,
      openButton: { text: "Normal", visible: true },
    });
    expect(isCapturingInput(select)).toBe(false);
  });

  it("closes when focus leaves the select", () => {
    const onSelect = vi.fn();
    const select = dropdown();
    select.update({ onSelect });
    select.activate();
    select.moveCapture("down");

    select.releaseCapture();

    expect(onSelect).not.toHaveBeenCalled();
    expect(inner(select).isOpen).toBe(false);
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

  it("gives the input back when the select is destroyed with its list open", () => {
    const select = dropdown();
    select.activate();

    select.destroy();
    expect(isCapturingInput(select)).toBe(false);
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

  it("steps along its own axis and reports the choice", () => {
    const onChange = vi.fn();
    const vertical = group("vertical");
    vertical.update({ onChange });

    expect(adjust(vertical, "down")).toBe(true);
    expect(vertical.displayObject).toMatchObject({ selected: 1 });
    expect(onChange).toHaveBeenCalledWith(1, "B");

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

  it("stops at either end rather than reading a row that is not there", () => {
    const vertical = group("vertical");

    expect(adjust(vertical, "up")).toBe(false);
    expect(adjust(vertical, "down")).toBe(true);
    expect(adjust(vertical, "down")).toBe(false);
    expect(vertical.displayObject).toMatchObject({ selected: 1 });
  });
});

describe("PixiInput editing", () => {
  /**
   * A key press arriving at the hidden DOM field, which `Input` reads through
   * the listener it bound in its constructor.
   */
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

  it("puts back the value captured when editing began", () => {
    const onEnter = vi.fn();
    const field = new PixiInput({ bg: view(), value: "Ada", onEnter });

    field.activate();
    field.update({ value: "Adabcd" });
    field.cancelEditing();

    expect(field.displayObject).toMatchObject({ value: "Ada" });
    expect(field.isEditing).toBe(false);
    // Leaving the field either way ends the edit, and after a cancel the end
    // carries the restored value.
    expect(onEnter).toHaveBeenCalledWith("Ada");
  });

  it("ends the edit on what was typed when the scope takes its input back", () => {
    const onEnter = vi.fn();
    const field = new PixiInput({ bg: view(), value: "Ada", onEnter });

    field.activate();
    field.update({ value: "Adabcd" });
    field.releaseCapture();

    expect(field.displayObject).toMatchObject({ value: "Adabcd" });
    expect(field.isEditing).toBe(false);
    expect(isCapturingInput(field)).toBe(false);
    expect(onEnter).toHaveBeenCalledWith("Adabcd");
  });

  it("takes each end point to the field's own way of ending", () => {
    const field = new PixiInput({ bg: view(), value: "Ada" });

    field.activate();
    field.update({ value: "Grace" });
    field.confirmCapture();
    expect(field.isEditing).toBe(false);
    expect(field.displayObject).toMatchObject({ value: "Grace" });

    field.activate();
    field.update({ value: "Ada" });
    field.cancelCapture();
    expect(field.isEditing).toBe(false);
    expect(field.displayObject).toMatchObject({ value: "Grace" });
  });

  it("puts the value back when Escape reaches the field itself", () => {
    const onEnter = vi.fn();
    const field = new PixiInput({ bg: view(), value: "Ada", onEnter });

    field.activate();
    field.update({ value: "Adabcd" });
    typeKey(field, "Escape");

    // The same end the scope's cancel gives it, so the player sees one
    // behaviour whether the key reached the field or the menu around it.
    expect(field.displayObject).toMatchObject({ value: "Ada" });
    expect(field.isEditing).toBe(false);
    expect(isCapturingInput(field)).toBe(false);
    expect(onEnter).toHaveBeenCalledWith("Ada");
  });

  it("keeps what was typed when Enter reaches the field itself", () => {
    const onEnter = vi.fn();
    const field = new PixiInput({ bg: view(), value: "Ada", onEnter });

    field.activate();
    field.update({ value: "Adabcd" });
    typeKey(field, "Enter");

    expect(field.displayObject).toMatchObject({ value: "Adabcd" });
    expect(field.isEditing).toBe(false);
    expect(isCapturingInput(field)).toBe(false);
    expect(onEnter).toHaveBeenCalledWith("Adabcd");
  });

  it("takes a typed character to the field", () => {
    const onChange = vi.fn();
    const field = new PixiInput({ bg: view(), value: "Ad", onChange });

    field.activate();
    typeKey(field, "a");

    expect(field.displayObject).toMatchObject({ value: "Ada" });
    expect(field.isEditing).toBe(true);
    expect(onChange).toHaveBeenCalledWith("Ada");
  });

  it("gives up the caret when the field is destroyed mid-edit", () => {
    const field = new PixiInput({ bg: view(), value: "Ada" });

    field.activate();
    expect(isCapturingInput(field)).toBe(true);

    field.destroy();
    expect(isCapturingInput(field)).toBe(false);
  });
});
