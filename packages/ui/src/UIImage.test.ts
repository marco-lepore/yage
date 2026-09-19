import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";
import { AssetHandle } from "@yagejs/core";
import type { Texture } from "pixi.js";

const { mocks } = vi.hoisted(() => {
  class MockTexture {
    width: number;
    height: number;
    constructor(w = 64, h = 64) {
      this.width = w;
      this.height = h;
    }
  }

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
    scale = {
      x: 1,
      y: 1,
      set(sx: number, sy: number) {
        this.x = sx;
        this.y = sy;
      },
    };
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    destroyed = false;
    eventMode = "auto";
    cursor = "default";

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
      for (const fn of this._listeners.get(event) ?? []) fn(...args);
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockSprite extends MockContainer {
    texture: MockTexture;
    // Pixi sizes a sprite by scaling it against its texture.
    private _width = 0;
    private _height = 0;
    get width(): number {
      return this._width;
    }
    set width(value: number) {
      this._width = value;
      const natural = this.texture.width;
      this.scale.x = natural !== 0 ? value / natural : 1;
    }
    get height(): number {
      return this._height;
    }
    set height(value: number) {
      this._height = value;
      const natural = this.texture.height;
      this.scale.y = natural !== 0 ? value / natural : 1;
    }
    tint = 0xffffff;
    anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };

    constructor(texture?: MockTexture) {
      super();
      this.texture = texture ?? new MockTexture();
      this.width = this.texture.width;
      this.height = this.texture.height;
    }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics {
      return this;
    }
    rect(): MockGraphics {
      return this;
    }
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
      this.lastRect = {
        x,
        y,
        width,
        height,
        ...(radius === undefined ? {} : { radius }),
      };
      return this;
    }
    fill(): MockGraphics {
      return this;
    }
    /** The style passed to the most recent `stroke`. */
    lastStroke: { color?: number; width?: number } | undefined;
    stroke(style?: { color?: number; width?: number }): MockGraphics {
      this.lastStroke = style;
      return this;
    }
  }

  class MockNineSliceSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) this.texture = opts.texture;
    }
  }

  class MockTilingSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    tileScale = {
      x: 1,
      y: 1,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    constructor(opts?: Record<string, unknown>) {
      super();
      if (opts) {
        this.texture = opts.texture;
        this.width = (opts.width as number) ?? 0;
        this.height = (opts.height as number) ?? 0;
      }
    }
  }

  return {
    mocks: {
      MockContainer,
      MockSprite,
      MockGraphics,
      MockNineSliceSprite,
      MockTilingSprite,
      MockTexture,
      mockTexture: new MockTexture(100, 50),
      registeredTextures: new Map<string, unknown>(),
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Sprite: mocks.MockSprite,
  Graphics: mocks.MockGraphics,
  NineSliceSprite: mocks.MockNineSliceSprite,
  TilingSprite: mocks.MockTilingSprite,
}));

vi.mock("@yagejs/renderer", () => ({
  registerTexture: (key: string, texture: unknown) => {
    mocks.registeredTextures.set(key, texture);
  },
  resolveTextureInput: (input: unknown) => {
    const key =
      typeof input === "string" ? input : (input as { path?: string }).path;
    return (key && mocks.registeredTextures.get(key)) ?? mocks.mockTexture;
  },
}));

import type { Node as YogaNode } from "yoga-layout";
import Yoga, { Align, Direction, FlexDirection } from "yoga-layout";
import { registerTexture } from "@yagejs/renderer";
import { setYoga } from "./yoga-helpers.js";
import { UIImage } from "./UIImage.js";
import { getFocusState } from "./focus/FocusState.js";
import { setUIFocusStyle } from "./internal/focus-outline.js";
import { takePointerRequest } from "./focus/pointer-request.js";

/**
 * Lay an image out inside a parent node the way the layout system does —
 * compute, then push the result onto the sprite — and return the computed
 * size. The image is detached again so its own `destroy()` still owns its
 * Yoga node.
 */
function layoutInParent(
  img: UIImage,
  configureParent?: (parent: YogaNode) => void,
): { width: number; height: number } {
  const parent = Yoga.Node.create();
  configureParent?.(parent);
  parent.insertChild(img.yogaNode, 0);
  parent.calculateLayout(undefined, undefined, Direction.LTR);
  const size = {
    width: img.yogaNode.getComputedWidth(),
    height: img.yogaNode.getComputedHeight(),
  };
  img.applyLayout();
  parent.removeChild(img.yogaNode);
  parent.free();
  return size;
}

/** A parent that gives its child a definite box to lay out in. */
function box(
  width: number,
  height: number,
  direction: FlexDirection,
  align?: Align,
): (parent: YogaNode) => void {
  return (parent) => {
    parent.setWidth(width);
    parent.setHeight(height);
    parent.setFlexDirection(direction);
    if (align !== undefined) parent.setAlignItems(align);
  };
}

beforeAll(() => {
  setYoga(Yoga);
});

describe("UIImage", () => {
  const handle = new AssetHandle<Texture>("texture", "test.png");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registeredTextures.clear();
  });

  it("resolves a registered texture key", () => {
    const texture = new mocks.MockTexture(80, 40);
    registerTexture("runtime-image", texture as never);

    const img = new UIImage({ texture: "runtime-image" });

    const sprite = img.container as unknown as InstanceType<
      typeof mocks.MockSprite
    >;
    expect(sprite.texture).toBe(texture);
  });

  it("creates a sprite from an asset handle", () => {
    const img = new UIImage({ texture: handle });
    expect(img.displayObject).toBeDefined();
    expect(img.visible).toBe(true);
  });

  it("measureFunc returns texture natural dimensions", () => {
    const img = new UIImage({ texture: handle });
    // Calculate layout to trigger measure
    img.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    expect(img.yogaNode.getComputedWidth()).toBe(100);
    expect(img.yogaNode.getComputedHeight()).toBe(50);
  });

  it("applyLayout scales sprite to computed size", () => {
    const img = new UIImage({ texture: handle, width: 200, height: 100 });
    img.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    img.applyLayout();
    const sprite = img.container as unknown as InstanceType<
      typeof mocks.MockSprite
    >;
    expect(sprite.width).toBe(200);
    expect(sprite.height).toBe(100);
  });

  it("a sized height gives the width the texture's aspect", () => {
    const img = new UIImage({ texture: handle, height: 25 });
    expect(layoutInParent(img)).toEqual({ width: 50, height: 25 });
  });

  it("a sized width still gives the height the aspect", () => {
    const img = new UIImage({ texture: handle, width: 50 });
    expect(layoutInParent(img)).toEqual({ width: 50, height: 25 });
  });

  it("sizing both dimensions stretches the texture", () => {
    const img = new UIImage({ texture: handle, width: 200, height: 100 });
    expect(layoutInParent(img)).toEqual({ width: 200, height: 100 });
  });

  it("a column parent does not stretch an image sized on one axis", () => {
    const img = new UIImage({ texture: handle, height: 25 });
    const size = layoutInParent(img, box(400, 200, FlexDirection.Column));
    expect(size).toEqual({ width: 50, height: 25 });
  });

  it("a percentage height derives the width", () => {
    const img = new UIImage({ texture: handle, height: "50%" });
    const size = layoutInParent(
      img,
      box(400, 200, FlexDirection.Row, Align.Center),
    );
    expect(size).toEqual({ width: 200, height: 100 });
  });

  it("an image sized on one axis overflows a narrow parent", () => {
    const img = new UIImage({ texture: handle, height: 25 });
    const size = layoutInParent(
      img,
      box(40, 200, FlexDirection.Row, Align.Center),
    );
    expect(size).toEqual({ width: 50, height: 25 });
  });

  it("maxWidth shrinks both axes", () => {
    const img = new UIImage({ texture: handle, height: 50, maxWidth: 40 });
    const size = layoutInParent(
      img,
      box(400, 200, FlexDirection.Row, Align.Center),
    );
    expect(size).toEqual({ width: 40, height: 20 });
  });

  it("removing the height prop restores the natural size", () => {
    const img = new UIImage({ texture: handle, height: 25 });
    img.update({ height: undefined });
    expect(layoutInParent(img)).toEqual({ width: 100, height: 50 });
  });

  it("changing the texture re-derives the width", () => {
    registerTexture("tall", new mocks.MockTexture(40, 100) as never);
    const img = new UIImage({ texture: handle, height: 25 });
    expect(layoutInParent(img)).toEqual({ width: 50, height: 25 });

    img.update({ texture: "tall" });
    expect(layoutInParent(img)).toEqual({ width: 10, height: 25 });
  });

  it("flexGrow on the main axis turns the ratio off", () => {
    const img = new UIImage({ texture: handle, height: 25, flexGrow: 1 });
    const size = layoutInParent(img, box(400, 200, FlexDirection.Row));
    expect(size).toEqual({ width: 400, height: 25 });
  });

  it("flex: 1 turns the ratio off", () => {
    const img = new UIImage({ texture: handle, height: 25, flex: 1 });
    const size = layoutInParent(img, box(400, 200, FlexDirection.Row));
    expect(size).toEqual({ width: 400, height: 25 });
  });

  it("a flexBasis turns the ratio off", () => {
    const img = new UIImage({ texture: handle, height: 25, flexBasis: 300 });
    const size = layoutInParent(img, box(400, 200, FlexDirection.Row));
    expect(size).toEqual({ width: 300, height: 25 });
  });

  it("a sized width with flexGrow keeps that width in a column", () => {
    const img = new UIImage({ texture: handle, width: 50, flexGrow: 1 });
    const size = layoutInParent(img, box(400, 200, FlexDirection.Column));
    expect(size).toEqual({ width: 50, height: 200 });
  });

  it("removing flexGrow restores the ratio", () => {
    const img = new UIImage({ texture: handle, height: 25, flexGrow: 1 });
    img.update({ flexGrow: undefined });
    const size = layoutInParent(img, box(400, 200, FlexDirection.Row));
    expect(size).toEqual({ width: 50, height: 25 });
  });

  it("an image with no size still follows its flex parent", () => {
    const img = new UIImage({ texture: handle });
    const size = layoutInParent(img, box(400, 40, FlexDirection.Row));
    expect(size).toEqual({ width: 100, height: 40 });
  });

  it("a texture with no measurable size keeps its natural size", () => {
    registerTexture("empty", new mocks.MockTexture(0, 0) as never);
    const img = new UIImage({ texture: "empty", height: 30 });
    expect(layoutInParent(img)).toEqual({ width: 0, height: 30 });
  });

  it("a zero-width texture does not measure an infinite height", () => {
    registerTexture("sliver", new mocks.MockTexture(0, 50) as never);
    const img = new UIImage({ texture: "sliver", width: 30 });
    expect(layoutInParent(img)).toEqual({ width: 30, height: 30 });
  });

  it("applyLayout sizes the sprite to the derived box", () => {
    const img = new UIImage({ texture: handle, height: 25 });
    layoutInParent(img);
    const sprite = img.container as unknown as InstanceType<
      typeof mocks.MockSprite
    >;
    expect(sprite.width).toBe(50);
    expect(sprite.height).toBe(25);
  });

  it("applies tint and alpha", () => {
    const img = new UIImage({ texture: handle, tint: 0xff0000, alpha: 0.5 });
    const sprite = img.container as unknown as InstanceType<
      typeof mocks.MockSprite
    >;
    expect(sprite.tint).toBe(0xff0000);
    expect(sprite.alpha).toBe(0.5);
  });

  it("update changes tint and alpha", () => {
    const img = new UIImage({ texture: handle });
    img.update({ tint: 0x00ff00, alpha: 0.3 });
    const sprite = img.container as unknown as InstanceType<
      typeof mocks.MockSprite
    >;
    expect(sprite.tint).toBe(0x00ff00);
    expect(sprite.alpha).toBe(0.3);
  });

  it("visibility can be toggled", () => {
    const img = new UIImage({ texture: handle });
    img.visible = false;
    expect(img.visible).toBe(false);
    img.visible = true;
    expect(img.visible).toBe(true);
  });

  it("destroy cleans up", () => {
    const img = new UIImage({ texture: handle });
    img.destroy();
    const sprite = img.container as unknown as InstanceType<
      typeof mocks.MockSprite
    >;
    expect(sprite.destroyed).toBe(true);
  });
});

describe("UIImage focus", () => {
  // An outline is drawn only where one is asked for, so these boxes are
  // measured against the outline a game asks for once for the whole UI.
  beforeEach(() => setUIFocusStyle({}));
  afterEach(() => setUIFocusStyle(undefined));

  /** Fire a Pixi event on the element's own display object. */
  const emitOn = (img: UIImage, event: string): void =>
    (img.displayObject as unknown as { emit(e: string): void }).emit(event);

  it("stays out of focus navigation by default", () => {
    const img = new UIImage({ texture: "cell" });

    expect(getFocusState(img)?.focusable).toBe(false);
    img.destroy();
  });

  /** The outline a focused element draws, or `undefined` before it takes one. */
  function outlineOf(element: {
    displayObject: unknown;
  }): InstanceType<typeof mocks.MockGraphics> | undefined {
    const children = (
      element.displayObject as unknown as InstanceType<
        typeof mocks.MockContainer
      >
    ).children;
    return children.find(
      (child): child is InstanceType<typeof mocks.MockGraphics> =>
        child instanceof mocks.MockGraphics && child.measurable === false,
    );
  }

  it("joins focus navigation and reports focus changes", () => {
    const onFocusChange = vi.fn();
    const img = new UIImage({
      texture: "cell",
      focusable: true,
      onFocusChange,
    });

    const state = getFocusState(img);
    expect(state?.focusable).toBe(true);
    state?._setFocused(true);

    expect(onFocusChange).toHaveBeenCalledWith(true);
    img.destroy();
  });

  it("outlines a focusable cell at the size it is drawn on screen", () => {
    const img = new UIImage({
      texture: "cell",
      focusable: true,
      width: 128,
      height: 96,
    });
    getFocusState(img)?._setFocused(true);

    img.yogaNode.calculateLayout(128, 96, Direction.LTR);
    img.applyLayout();

    // The sprite is sized by scaling its 100x50 texture, so the outline is
    // scaled back: 128 px across on screen, with a 2 px stroke on both axes
    // rather than one stretched with the picture.
    const ring = outlineOf(img);
    const sprite = img.container as unknown as {
      scale: { x: number; y: number };
    };
    const rect = ring?.lastRect;
    expect(sprite.scale.x).not.toBeCloseTo(sprite.scale.y);
    expect(ring?.lastStroke).toEqual({ color: 0xffffff, width: 2 });
    expect(
      ((rect?.width ?? 0) + 2) * (ring?.scale.x ?? 1) * sprite.scale.x,
    ).toBeCloseTo(128);
    expect(2 * (ring?.scale.x ?? 1) * sprite.scale.x).toBeCloseTo(2);
    expect(2 * (ring?.scale.y ?? 1) * sprite.scale.y).toBeCloseTo(2);
    img.destroy();
  });

  it("takes the focus props an update carries", () => {
    const img = new UIImage({ texture: "cell" });

    img.update({ focusable: true, focusId: "first-cell" });

    expect(getFocusState(img)?.focusable).toBe(true);
    expect(getFocusState(img)?.id).toBe("first-cell");
    img.destroy();
  });

  it("asks for hover focus while the pointer is over it", () => {
    const img = new UIImage({ texture: "cell", focusable: true });
    takePointerRequest();

    emitOn(img, "pointerover");

    expect(takePointerRequest()?.trigger).toBe("hover");
    img.destroy();
  });

  it("asks for press focus when the pointer presses it", () => {
    const img = new UIImage({ texture: "cell", focusable: true });
    takePointerRequest();

    emitOn(img, "pointerdown");

    const request = takePointerRequest();
    expect(request?.element).toBe(img);
    expect(request?.trigger).toBe("press");
    img.destroy();
  });

  it("reports its focus state to the Inspector", () => {
    const img = new UIImage({ texture: "cell", focusable: true });

    expect(img._inspectState()).toEqual({ focused: false, focusable: true });
    getFocusState(img)?._setFocused(true);
    expect(img._inspectState()).toEqual({ focused: true, focusable: true });
    img.destroy();
  });

  it("leaves focus navigation when it is destroyed", () => {
    const img = new UIImage({ texture: "cell", focusable: true });

    img.destroy();

    expect(getFocusState(img)).toBeUndefined();
  });
});
