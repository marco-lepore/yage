import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
    measurable = true;
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
      const listeners = this._listeners.get(event) ?? new Set();
      listeners.add(fn);
      this._listeners.set(event, listeners);
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
import { setYoga } from "../yoga-helpers.js";
import { UIPanel } from "../UIPanel.js";
import { getFocusState } from "../focus/FocusState.js";
import { setUIFocusStyle } from "./focus-outline.js";

beforeAll(() => {
  setYoga(Yoga);
});

afterEach(() => {
  setUIFocusStyle(undefined);
});

/** Move focus the way a scope does. */
function setFocused(panel: UIPanel, focused: boolean): void {
  getFocusState(panel)?._setFocused(focused);
}

/** Give the background renderer a computed size to draw at. */
function layout(panel: UIPanel): void {
  panel.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
  panel.applyLayout();
}

/** Every Graphics the panel keeps, in z-order. */
function graphicsOf(panel: UIPanel): InstanceType<typeof mocks.MockGraphics>[] {
  const container = panel.container as unknown as InstanceType<
    typeof mocks.MockContainer
  >;
  return container.children.filter(
    (child): child is InstanceType<typeof mocks.MockGraphics> =>
      child instanceof mocks.MockGraphics,
  );
}

/** The panel's background fill, which is the Graphics layout measures. */
function background(
  panel: UIPanel,
): InstanceType<typeof mocks.MockGraphics> | undefined {
  return graphicsOf(panel).find((child) => child.measurable !== false);
}

/** The outline a focused panel draws, where a style asks for one. */
function outline(
  panel: UIPanel,
): InstanceType<typeof mocks.MockGraphics> | undefined {
  return graphicsOf(panel).find((child) => child.measurable === false);
}

describe("focus with no outline", () => {
  it("draws nothing around a focused element", () => {
    const panel = new UIPanel({ width: 100, height: 40, focusable: true });
    layout(panel);

    setFocused(panel, true);
    layout(panel);

    expect(outline(panel)).toBeUndefined();
  });

  it("still tells the game focus arrived and left", () => {
    const changes: boolean[] = [];
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      onFocusChange: (focused) => changes.push(focused),
    });
    layout(panel);

    setFocused(panel, true);
    setFocused(panel, false);

    expect(changes).toEqual([true, false]);
    expect(outline(panel)).toBeUndefined();
  });

  it("still paints the focus background the game asked for", () => {
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      background: { color: 0x204060, radius: 4 },
      focusBackground: { color: 0xff0000 },
    });
    layout(panel);

    setFocused(panel, true);

    expect(background(panel)?.lastFill?.color).toBe(0xff0000);
    expect(outline(panel)).toBeUndefined();
  });

  it("still reports the focus the Inspector reads", () => {
    const panel = new UIPanel({ width: 100, height: 40, focusable: true });
    layout(panel);

    setFocused(panel, true);

    expect(panel._inspectState()).toMatchObject({
      focused: true,
      focusable: true,
    });
  });

  it("draws an outline once the UI asks for one", () => {
    setUIFocusStyle({ color: 0x33ff88 });
    const panel = new UIPanel({ width: 100, height: 40, focusable: true });
    layout(panel);

    setFocused(panel, true);

    expect(outline(panel)?.lastStroke).toEqual({ color: 0x33ff88, width: 2 });
  });

  it("drops the UI-wide outline for an element that opts out", () => {
    setUIFocusStyle({ color: 0x33ff88 });
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      focusStyle: null,
    });
    layout(panel);

    setFocused(panel, true);

    expect(outline(panel)).toBeUndefined();
  });
});
