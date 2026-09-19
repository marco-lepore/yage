import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  /** Counts the strokes laid down, so a test reads how often it redrew. */
  class MockGraphics {
    parent: MockGraphics | null = null;
    children: MockGraphics[] = [];
    measurable = true;
    visible = true;
    destroyed = false;
    clears = 0;
    strokes = 0;
    lastRect: {
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
    } | null = null;
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

    addChild(child: MockGraphics): MockGraphics {
      this.children.push(child);
      child.parent = this;
      return child;
    }
    clear(): this {
      this.clears += 1;
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
      return this;
    }
    stroke(): this {
      this.strokes += 1;
      return this;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }

  return { mocks: { MockGraphics } };
});

vi.mock("pixi.js", () => ({ Graphics: mocks.MockGraphics }));

import type { DisplayContainer } from "@yagejs/renderer";
import { setUIDefaultTextStyle } from "../text-defaults.js";
import {
  FocusOutline,
  resolveFocusStyle,
  setUIFocusStyle,
} from "./focus-outline.js";
import type { UIFocusOutlineBox } from "../types.js";

afterEach(() => {
  setUIFocusStyle(undefined);
  setUIDefaultTextStyle(undefined);
});

describe("focus outline style", () => {
  it("names no outline when neither the element nor the UI asks for one", () => {
    expect(resolveFocusStyle(undefined)).toBeNull();
    expect(resolveFocusStyle(undefined, 12)).toBeNull();
  });

  it("names no outline for an element that opted out of the UI-wide one", () => {
    setUIFocusStyle({ color: 0x102030, width: 3 });

    expect(resolveFocusStyle(null)).toBeNull();
  });

  it("names no outline for a UI that asked for none", () => {
    setUIFocusStyle(null);

    expect(resolveFocusStyle(undefined)).toBeNull();
  });

  it("gives the UI-wide outline to an element that names no style", () => {
    setUIFocusStyle({ color: 0x102030 });

    expect(resolveFocusStyle(undefined)).toEqual({
      color: 0x102030,
      width: 2,
      radius: 4,
      inset: 0,
    });
  });

  it("falls back to a 2 px white outline on a 4 px radius", () => {
    expect(resolveFocusStyle({})).toEqual({
      color: 0xffffff,
      width: 2,
      radius: 4,
      inset: 0,
    });
  });

  it("takes its colour from the UI default text fill", () => {
    setUIDefaultTextStyle({ fill: 0xe2e8f0 });

    expect(resolveFocusStyle({})?.color).toBe(0xe2e8f0);
  });

  it("stays white for a text fill that names no colour number", () => {
    setUIDefaultTextStyle({ fill: { fill: 0x112233 } });

    expect(resolveFocusStyle({})?.color).toBe(0xffffff);
  });

  it("follows the element's own corner radius", () => {
    expect(resolveFocusStyle({}, 12)?.radius).toBe(12);
  });

  it("lets the themed style win over the element's radius", () => {
    setUIFocusStyle({ radius: 0 });

    expect(resolveFocusStyle(undefined, 12)?.radius).toBe(0);
  });

  it("resolves each field on its own, element over theme over default", () => {
    setUIFocusStyle({ color: 0x102030, width: 3 });

    expect(resolveFocusStyle({ color: 0xff8800, inset: 2 })).toEqual({
      color: 0xff8800,
      width: 3,
      radius: 4,
      inset: 2,
    });
  });
});

describe("focus outline drawing", () => {
  let container: InstanceType<typeof mocks.MockGraphics>;
  let box: UIFocusOutlineBox;

  beforeEach(() => {
    container = new mocks.MockGraphics();
    box = { x: 0, y: 0, width: 100, height: 40 };
    // The UI asked for an outline, which is what puts one on every element.
    setUIFocusStyle({});
  });

  function outline(): FocusOutline {
    return new FocusOutline({
      container: container as unknown as DisplayContainer,
      box: () => box,
    });
  }

  /** The graphics the outline built inside its host container. */
  function graphics(): InstanceType<typeof mocks.MockGraphics> {
    const child = container.children[0];
    if (!child) throw new Error("the outline drew nothing");
    return child;
  }

  it("strokes the box the host states", () => {
    outline().setFocused(true);

    expect(graphics().lastRect).toEqual({
      x: 1,
      y: 1,
      width: 98,
      height: 38,
      radius: 3,
    });
    expect(graphics().measurable).toBe(false);
  });

  it("skips a layout pass that would stroke what is already drawn", () => {
    const focusOutline = outline();
    focusOutline.setFocused(true);
    expect(graphics().strokes).toBe(1);

    focusOutline.refresh();
    focusOutline.refresh();

    expect(graphics().strokes).toBe(1);
    expect(graphics().clears).toBe(1);
  });

  it("redraws once the host's box moves", () => {
    const focusOutline = outline();
    focusOutline.setFocused(true);

    box = { x: 0, y: 0, width: 100, height: 60 };
    focusOutline.refresh();

    expect(graphics().strokes).toBe(2);
    expect(graphics().lastRect?.height).toBe(58);
  });

  it("redraws for a style the element itself names", () => {
    const focusOutline = outline();
    focusOutline.setFocused(true);

    focusOutline.set({ focusStyle: { color: 0xff0000, width: 4 } });

    expect(graphics().strokes).toBe(2);
    expect(graphics().lastRect).toEqual({
      x: 2,
      y: 2,
      width: 96,
      height: 36,
      radius: 2,
    });
  });

  it("builds nothing for an element no style names an outline for", () => {
    setUIFocusStyle(undefined);
    const focusOutline = outline();

    focusOutline.setFocused(true);
    focusOutline.refresh();

    expect(container.children).toEqual([]);
  });

  it("builds nothing for an element that opted out of the UI-wide outline", () => {
    const focusOutline = outline();
    focusOutline.set({ focusStyle: null });

    focusOutline.setFocused(true);

    expect(container.children).toEqual([]);
  });

  it("drops the outline when the element opts out while it holds focus", () => {
    const focusOutline = outline();
    focusOutline.setFocused(true);
    expect(graphics().visible).toBe(true);

    focusOutline.set({ focusStyle: null });

    expect(graphics().visible).toBe(false);
    expect(graphics().strokes).toBe(1);
  });

  it("draws the outline a style names while the element holds focus", () => {
    setUIFocusStyle(undefined);
    const focusOutline = outline();
    focusOutline.setFocused(true);
    expect(container.children).toEqual([]);

    focusOutline.set({ focusStyle: { color: 0x33ff88, width: 2 } });

    expect(graphics().visible).toBe(true);
    expect(graphics().strokes).toBe(1);
  });
});
