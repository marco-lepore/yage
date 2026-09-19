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
    visible = true;
    /** Pixi v8 leaves a child out of `getLocalBounds` unless it measures. */
    measurable = true;
    eventMode: string | undefined;
    destroyed = false;
    /** The box this container draws itself, before any child is folded in. */
    ownX = 0;
    ownY = 0;
    ownWidth = 0;
    ownHeight = 0;
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

    addChild(child: MockContainer): MockContainer {
      child.removeFromParent();
      this.children.push(child);
      child.parent = this;
      return child;
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

    /**
     * Pixi v8's rule: a container that draws nothing of its own contributes
     * only its children, and a child that is hidden or does not measure is
     * skipped. A child that is folded in carries its own position and scale.
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

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  /** A sprite draws around its anchor; every other view keeps its origin. */
  class MockSprite extends MockContainer {
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

  /** Records the last shape drawn, so a test can read the outline. */
  class MockGraphics extends MockContainer {
    lastRect: {
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
    } | null = null;
    lastStrokeWidth = 0;
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
      this.lastStrokeWidth = style.width;
      return this;
    }
  }

  /**
   * `@pixi/ui`'s Slider, in the parts a focus outline is measured from.
   *
   * `SliderBase.createSlider` hangs the knob art in a container of its own:
   * it moves the art half its width to the right, anchors it at its centre
   * only when the art is a `Sprite`, and parks the container on the track's
   * mid-line. `Slider.updateSlider` then slides that container to
   * `progress * trackWidth - containerWidth / 2`.
   */
  class MockSlider extends MockContainer {
    onChange = new MockSignal();
    onUpdate = new MockSignal();
    min: number;
    max: number;
    step: number;
    /** The track. `nineSliceSprite` resizes it instead of scaling the slider. */
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
        knob.addChild(art);
        if (art instanceof MockSprite) art.anchor.set(0.5);
        knob.position.set(0, this.bg.height / 2);
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

  return { mocks: { MockContainer, MockSprite, MockGraphics, MockSlider } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Sprite: mocks.MockSprite,
  Texture: class MockTexture {
    readonly mock = true;
  },
}));

vi.mock("@pixi/ui", () => ({ Slider: mocks.MockSlider }));

import Yoga, { Direction } from "yoga-layout";
import { setYoga } from "../yoga-helpers.js";
import { setUIFocusStyle } from "../internal/focus-outline.js";
import { getFocusState } from "../focus/FocusState.js";
import { PixiSlider } from "./PixiSlider.js";

beforeAll(() => setYoga(Yoga));
beforeEach(() => setUIFocusStyle(undefined));

const TRACK_WIDTH = 200;
const TRACK_HEIGHT = 10;
const KNOB_SIZE = 20;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A track of the size every test here uses. */
function track(): InstanceType<typeof mocks.MockContainer> {
  const view = new mocks.MockContainer();
  view.ownWidth = TRACK_WIDTH;
  view.ownHeight = TRACK_HEIGHT;
  return view;
}

/** A square knob of `view`'s kind, drawn from its own origin. */
function knobArt<T extends InstanceType<typeof mocks.MockContainer>>(
  view: T,
): T {
  view.ownWidth = KNOB_SIZE;
  view.ownHeight = KNOB_SIZE;
  return view;
}

/** A focused, laid-out slider with `knob` for its knob art. */
function focusedSlider(
  knob: InstanceType<typeof mocks.MockContainer>,
): PixiSlider {
  const slider = new PixiSlider({
    bg: track() as never,
    fill: new mocks.MockContainer() as never,
    slider: knob as never,
    // Nine-sliced, so layout resizes the track in place rather than scaling
    // the whole widget, which is what a slider in a menu row does.
    nineSliceSprite: [1, 1, 1, 1],
    value: 0,
  });
  slider.yogaNode.setWidth(TRACK_WIDTH);
  slider.yogaNode.setHeight(TRACK_HEIGHT);
  getFocusState(slider)?._setFocused(true);
  layout(slider);
  return slider;
}

function layout(slider: PixiSlider): void {
  slider.yogaNode.calculateLayout(TRACK_WIDTH, TRACK_HEIGHT, Direction.LTR);
  slider.applyLayout();
}

function sliderView(slider: PixiSlider): InstanceType<typeof mocks.MockSlider> {
  return slider.displayObject as unknown as InstanceType<
    typeof mocks.MockSlider
  >;
}

/** The outline's outer edge, in the slider view's own space. */
function outlineRect(slider: PixiSlider): Rect {
  const view = sliderView(slider);
  const outline = view.children.find(
    (child): child is InstanceType<typeof mocks.MockGraphics> =>
      child instanceof mocks.MockGraphics,
  );
  const rect = outline?.lastRect;
  if (!outline || !rect) throw new Error("the slider drew no focus outline");
  // The stroke straddles the path, so the outer edge is half a width out.
  const half = outline.lastStrokeWidth / 2;
  return {
    left: outline.position.x + (rect.x - half) * outline.scale.x,
    top: outline.position.y + (rect.y - half) * outline.scale.y,
    right: outline.position.x + (rect.x + rect.width + half) * outline.scale.x,
    bottom:
      outline.position.y + (rect.y + rect.height + half) * outline.scale.y,
  };
}

/** Where the knob art is drawn right now, in the slider view's own space. */
function knobRect(slider: PixiSlider): Rect {
  const knob = sliderView(slider).slider1;
  if (!knob) throw new Error("the slider built no knob");
  const bounds = knob.getLocalBounds();
  return {
    left: knob.position.x + bounds.x,
    top: knob.position.y + bounds.y,
    right: knob.position.x + bounds.x + bounds.width,
    bottom: knob.position.y + bounds.y + bounds.height,
  };
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

describe("PixiSlider focus outline", () => {
  // An outline is drawn only where one is asked for, so these boxes are
  // measured against the outline a game asks for once for the whole UI.
  beforeEach(() => setUIFocusStyle({}));

  it("holds a centred sprite knob at every value", () => {
    const slider = focusedSlider(knobArt(new mocks.MockSprite()));

    // The knob reaches half its width past each end of the track and half its
    // height above and below the track's mid-line.
    expect(outlineRect(slider)).toEqual({
      left: -10,
      top: -5,
      right: 210,
      bottom: 15,
    });
  });

  it("holds a knob whose view keeps its own origin at every value", () => {
    const slider = focusedSlider(knobArt(new mocks.MockGraphics()));

    // A view that is not a sprite takes no anchor, so the knob hangs to the
    // right of the value's place on the track and below its mid-line.
    expect(outlineRect(slider)).toEqual({
      left: 0,
      top: 0,
      right: 220,
      bottom: 25,
    });
  });

  it.each([
    ["a sprite", () => new mocks.MockSprite()],
    ["a graphics", () => new mocks.MockGraphics()],
  ])("covers %s knob at both ends of the track", (_name, make) => {
    const slider = focusedSlider(knobArt(make()));
    const box = outlineRect(slider);

    for (const value of [0, 50, 100]) {
      slider.update({ value });
      layout(slider);
      expect(contains(box, knobRect(slider))).toBe(true);
      // The box is the same at every value, so the outline does not breathe.
      expect(outlineRect(slider)).toEqual(box);
    }
  });
});
