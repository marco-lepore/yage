/**
 * Stand-ins for `@pixi/ui` and for the `pixi.js` classes its widgets are
 * built from. A widget test mocks both modules with them:
 *
 *   vi.mock("pixi.js", async () => (await import("./test-pixi-ui.js")).pixiMock);
 *   vi.mock("@pixi/ui", async () => (await import("./test-pixi-ui.js")).pixiUIMock);
 *
 * The container measures itself the way Pixi v8 does, because a widget
 * wrapper reads its size from `getLocalBounds`.
 */

import { MockContainer as PlainContainer } from "../test-pixi.js";

export class MockSignal {
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

export interface MockBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Records what a transform was built from, in place of Pixi's arithmetic: the
 * container whose world transform it was read from, whether it was inverted,
 * and the matrix appended to it.
 */
export class MockMatrix {
  static readonly IDENTITY = new MockMatrix();
  source: MockContainer | null = null;
  inverted = false;
  appended: MockMatrix | null = null;
  invert(): this {
    this.inverted = true;
    return this;
  }
  append(other: MockMatrix): this {
    this.appended = other;
    return this;
  }
}

/**
 * The shared container, measured the way Pixi v8 measures: width and height
 * come from `getLocalBounds` and the scale.
 */
export class MockContainer extends PlainContainer {
  declare children: MockContainer[];
  /** What each matrix `setFromMatrix` was given was built from, in order. */
  readonly appliedMatrices: {
    from: MockContainer | null;
    under: MockContainer | null;
  }[] = [];
  /** Pixi v8 leaves a child out of `getLocalBounds` unless it measures. */
  measurable = true;
  /** The box this container draws itself, before any child is folded in. */
  ownX = 0;
  ownY = 0;
  ownWidth = 20;
  ownHeight = 10;

  /**
   * A container that draws nothing contributes only its children. A child
   * that is hidden, empty or does not measure is skipped; one that is folded
   * in carries its own position and scale.
   */
  getLocalBounds(): MockBounds {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    if (this.ownWidth !== 0 || this.ownHeight !== 0) {
      minX = this.ownX;
      minY = this.ownY;
      maxX = this.ownX + this.ownWidth;
      maxY = this.ownY + this.ownHeight;
    }
    for (const child of this.children) {
      if (!child.visible || !child.measurable) continue;
      const bounds = child.getLocalBounds();
      if (bounds.width === 0 && bounds.height === 0) continue;
      const left = child.position.x + bounds.x * child.scale.x;
      const top = child.position.y + bounds.y * child.scale.y;
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + bounds.width * child.scale.x);
      maxY = Math.max(maxY, top + bounds.height * child.scale.y);
    }
    if (minX === Number.POSITIVE_INFINITY) {
      return { x: 0, y: 0, width: 0, height: 0 };
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

  getGlobalTransform(matrix: MockMatrix): MockMatrix {
    matrix.source = this;
    matrix.inverted = false;
    matrix.appended = null;
    return matrix;
  }

  setFromMatrix(matrix: MockMatrix): void {
    if (matrix === MockMatrix.IDENTITY) {
      this.position.set(0, 0);
      this.scale.set(1, 1);
      this.skew.set(0, 0);
      this.rotation = 0;
      return;
    }
    this.appliedMatrices.push({
      from: matrix.appended?.source ?? null,
      under: matrix.inverted ? matrix.source : null,
    });
  }
}

/** A sprite draws around its anchor; every other view keeps its origin. */
export class MockSprite extends MockContainer {
  readonly anchor = {
    x: 0,
    y: 0,
    set: (x: number, y = x): void => {
      this.anchor.x = x;
      this.anchor.y = y;
      this.ownX = -x * this.ownWidth;
      this.ownY = -y * this.ownHeight;
    },
  };
}

/** Records the last shape drawn, so a test can read the outline's geometry. */
export class MockGraphics extends MockContainer {
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

export type ButtonState = "default" | "hover" | "pressed" | "disabled";

/**
 * @pixi/ui's own state machine. The widget swaps its face off the press
 * signal and off the `mouse*` events, which is the pair it connects away
 * from a touch device. A press already held keeps its face while the mouse
 * crosses the button, and a release only counts where a press started here.
 * `enabled` writes the state too.
 */
export class MockFancyButton extends MockContainer {
  onPress = new MockSignal();
  textView = { style: {} };
  text = "";
  state: ButtonState = "default";
  private _enabled = true;
  private _isDown = false;
  private _isMouseIn = false;
  /** What the wrapper passed in; the widget sets its own scale from it. */
  constructor(readonly options: { scale?: number } = {}) {
    super();
    this.scale.set(options.scale ?? 1);
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
 * Track and knob as @pixi/ui builds them. The knob art hangs in a container
 * of its own, moved half its width to the right and anchored at its centre
 * only when it is a `Sprite`. That container is parked on the track's
 * mid-line and slides to `progress * trackWidth - containerWidth / 2`.
 */
export class MockSlider extends MockContainer {
  onChange = new MockSignal();
  onUpdate = new MockSignal();
  min: number;
  max: number;
  step: number;
  /** The track. `nineSliceSprite` resizes it and leaves the slider unscaled. */
  protected bg: MockContainer;
  private readonly _knob: MockContainer | undefined;
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

    const art = options?.slider;
    if (art) {
      art.position.set(art.width / 2, 0);
      const knob = new MockContainer();
      knob.ownWidth = 0;
      knob.ownHeight = 0;
      knob.addChild(art);
      if (art instanceof MockSprite) art.anchor.set(0.5);
      this.addChild(knob);
      this._knob = knob;
    }
    this._updateSlider();
  }
  /** `SliderBase.slider1` — the container that holds the knob art. */
  get slider1(): MockContainer | undefined {
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
    const knob = this._knob;
    if (!knob) return;
    const span = this.max - this.min || 1;
    const progress = ((this._value - this.min) / span) * 100;
    knob.position.set(
      (this.bg.width / 100) * progress - knob.width / 2,
      this.bg.height / 2,
    );
  }
}

export class MockInput extends MockContainer {
  onChange = new MockSignal();
  onEnter = new MockSignal();
  protected placeholder = { text: "", visible: false };
  protected editing = false;
  private _value = "";
  secure = false;
  padding: number | number[] = 0;
  /** `Input` binds this in its constructor, so a subclass override is what runs. */
  readonly onKeyUpBinding: (e: KeyboardEvent) => void = this.onKeyUp.bind(this);
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

export class MockCheckBox extends MockContainer {
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

export class MockProgressBar extends MockContainer {
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
export class MockSelect extends MockContainer {
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

export class MockRadioGroup extends MockContainer {
  protected items: MockCheckBox[];
  protected options: {
    items: MockCheckBox[];
    type: string | undefined;
    selectedItem: number | undefined;
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

export class MockTexture {
  readonly mock = true;
}

/** The module a test file hands `vi.mock("pixi.js", …)`. */
export const pixiMock = {
  Container: MockContainer,
  Matrix: MockMatrix,
  Graphics: MockGraphics,
  Sprite: MockSprite,
  Texture: MockTexture,
};

/** The module a test file hands `vi.mock("@pixi/ui", …)`. */
export const pixiUIMock = {
  FancyButton: MockFancyButton,
  Slider: MockSlider,
  Input: MockInput,
  CheckBox: MockCheckBox,
  ProgressBar: MockProgressBar,
  Select: MockSelect,
  RadioGroup: MockRadioGroup,
};
