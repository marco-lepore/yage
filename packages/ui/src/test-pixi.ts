/**
 * The stand-in for `pixi.js` that the UI test files share. A test file mocks
 * the module with it and imports the classes it wants to inspect:
 *
 *   vi.mock("pixi.js", async () => (await import("./test-pixi.js")).pixiMock);
 *
 * Nothing here imports `pixi.js`, so loading it from inside the mock factory
 * is safe.
 */

import { toLocalThrough } from "./test-affine.js";

type Listener = (...args: unknown[]) => void;

function point(): { x: number; y: number; set(x: number, y?: number): void } {
  return {
    x: 0,
    y: 0,
    set(x: number, y = x): void {
      this.x = x;
      this.y = y;
    },
  };
}

export class MockContainer {
  children: MockContainer[] = [];
  parent: MockContainer | null = null;
  position = point();
  scale = { ...point(), x: 1, y: 1 };
  pivot = point();
  skew = point();
  rotation = 0;
  visible = true;
  alpha = 1;
  sortableChildren = false;
  zIndex = 0;
  label = "";
  destroyed = false;
  eventMode = "auto";
  cursor = "default";
  mask: MockContainer | null = null;
  private readonly _listeners = new Map<string, Set<Listener>>();

  setMask(opts: { mask: MockContainer | null }): void {
    this.mask = opts.mask;
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
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parent = null;
    }
    return child;
  }

  removeFromParent(): void {
    this.parent?.removeChild(this);
  }

  sortChildren(): void {
    this.children.sort((a, b) => a.zIndex - b.zIndex);
  }

  /**
   * Convert `point` from `from`'s local space, or from global space, into
   * this container's. See {@link toLocalThrough}.
   */
  toLocal(
    point: { x: number; y: number },
    from?: MockContainer,
    out?: { x: number; y: number },
  ): { x: number; y: number } {
    return toLocalThrough(this, point, from, out);
  }

  on(event: string, fn: Listener): this {
    let listeners = this._listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this._listeners.set(event, listeners);
    }
    listeners.add(fn);
    return this;
  }

  off(event: string, fn: Listener): this {
    this._listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this._listeners.get(event) ?? [])]) fn(...args);
  }

  destroy(): void {
    this.destroyed = true;
    this.removeFromParent();
  }
}

interface DrawnRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

/** Records the last shape, fill and stroke, so a test reads what was drawn. */
export class MockGraphics extends MockContainer {
  lastRect: DrawnRect | undefined;
  lastRadius: number | undefined;
  lastFill: { color?: number; alpha?: number } | undefined;
  lastStroke: { color?: number; width?: number } | undefined;

  clear(): this {
    this.lastRect = undefined;
    return this;
  }

  rect(x: number, y: number, width: number, height: number): this {
    this.lastRect = { x, y, width, height };
    return this;
  }

  roundRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius?: number,
  ): this {
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

  fill(style?: { color?: number; alpha?: number }): this {
    this.lastFill = style;
    return this;
  }

  stroke(style?: { color?: number; width?: number }): this {
    this.lastStroke = style;
    return this;
  }
}

export class MockRectangle {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
}

export class MockText extends MockContainer {
  text: string;
  style: Record<string, unknown>;
  width = 50;
  height = 14;
  anchor = point();

  constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
    super();
    this.text = opts?.text ?? "";
    this.style = opts?.style ?? {};
  }
}

/** A distinct class, so a test can assert a bitmap label was built. */
export class MockBitmapText extends MockText {}

export class MockSprite extends MockContainer {
  width = 0;
  height = 0;
  tint = 0xffffff;
  anchor = point();

  constructor(public texture?: unknown) {
    super();
  }
}

export class MockNineSliceSprite extends MockContainer {
  texture: unknown;
  width = 0;
  height = 0;
  leftWidth: number;
  topHeight: number;
  rightWidth: number;
  bottomHeight: number;

  constructor(opts: Record<string, unknown> = {}) {
    super();
    this.texture = opts.texture;
    this.leftWidth = (opts.leftWidth as number | undefined) ?? 0;
    this.topHeight = (opts.topHeight as number | undefined) ?? 0;
    this.rightWidth = (opts.rightWidth as number | undefined) ?? 0;
    this.bottomHeight = (opts.bottomHeight as number | undefined) ?? 0;
  }
}

export class MockTilingSprite extends MockContainer {
  texture: unknown;
  width: number;
  height: number;
  tileScale = { ...point(), x: 1, y: 1 };
  tilePosition = { x: 0, y: 0 };

  constructor(opts: Record<string, unknown> = {}) {
    super();
    this.texture = opts.texture;
    this.width = (opts.width as number | undefined) ?? 0;
    this.height = (opts.height as number | undefined) ?? 0;
  }
}

/** Sizes itself the way Pixi does: by scaling against its texture. */
export class MockScalingSprite extends MockSprite {
  constructor(texture: { width: number; height: number }) {
    super(texture);
    for (const [size, axis] of [
      ["width", "x"],
      ["height", "y"],
    ] as const) {
      Object.defineProperty(this, size, {
        get: () => texture[size] * this.scale[axis],
        set: (value: number) => {
          this.scale[axis] = value / texture[size];
        },
      });
    }
  }
}

/** Adds the path calls a checkmark is drawn with. */
export class MockPathGraphics extends MockGraphics {
  moveTo(): this {
    return this;
  }
  lineTo(): this {
    return this;
  }
}

/** Splits into one line holding one word per run of non-space characters. */
export class MockSplitText extends MockContainer {
  style: Record<string, unknown>;
  chars: MockText[] = [];
  words: MockContainer[] = [];
  lines: MockContainer[] = [];
  constructor(readonly opts: { text: string; style?: object }) {
    super();
    this.style = { ...opts.style };
    this.split();
  }
  get text(): string {
    return this.opts.text;
  }
  split(): void {
    this.chars = [...this.text.replace(/\s/g, "")].map(
      (text) => new MockText({ text }),
    );
    this.words = this.text.split(/\s+/).map(() => new MockContainer());
    this.lines = [this.addChild(new MockContainer())];
  }
}

const measureText = (text: string): { width: number; height: number } => ({
  width: text.length * 10,
  height: 16,
});

/** The module a test file hands `vi.mock("pixi.js", …)`. */
export const pixiMock = {
  Container: MockContainer,
  Graphics: MockGraphics,
  Rectangle: MockRectangle,
  Text: MockText,
  BitmapText: MockBitmapText,
  Sprite: MockSprite,
  NineSliceSprite: MockNineSliceSprite,
  TilingSprite: MockTilingSprite,
};

/**
 * {@link pixiMock} with what every widget class needs to be built: a sprite
 * that sizes by scale, the checkmark's path calls, and split text. A test
 * file that mocks the texture resolver hands its sprites a texture with a
 * size.
 */
export const widgetPixiMock = {
  ...pixiMock,
  Graphics: MockPathGraphics,
  Sprite: MockScalingSprite,
  SplitText: MockSplitText,
  SplitBitmapText: MockSplitText,
  CanvasTextMetrics: { measureText },
  BitmapFontManager: { measureText },
};
