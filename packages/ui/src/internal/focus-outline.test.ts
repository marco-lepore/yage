import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("pixi.js", async () => (await import("../test-pixi.js")).pixiMock);

import Yoga, { Direction } from "yoga-layout";
import type { DisplayContainer } from "@yagejs/renderer";
import { MockContainer, MockGraphics } from "../test-pixi.js";
import { setYoga } from "../yoga-helpers.js";
import { setUIDefaultTextStyle } from "../text-defaults.js";
import { UIPanel } from "../UIPanel.js";
import { getFocusState } from "../focus/FocusState.js";
import {
  FocusOutline,
  resolveFocusStyle,
  setUIFocusStyle,
} from "./focus-outline.js";
import type { UIFocusOutlineBox } from "../types.js";

beforeAll(() => setYoga(Yoga));
afterEach(() => {
  setUIFocusStyle(undefined);
  setUIDefaultTextStyle(undefined);
});

describe("focus outline style", () => {
  it("names no outline when nothing asks for one, or the element opts out", () => {
    expect(resolveFocusStyle(undefined, 12)).toBeNull();

    setUIFocusStyle(null);
    expect(resolveFocusStyle(undefined)).toBeNull();

    setUIFocusStyle({ color: 0x102030, width: 3 });
    expect(resolveFocusStyle(null)).toBeNull();
  });

  it("falls back to a 2 px outline on a 4 px radius, in the UI default text fill or white", () => {
    expect(resolveFocusStyle({})).toEqual({
      color: 0xffffff,
      width: 2,
      radius: 4,
      inset: 0,
    });

    setUIDefaultTextStyle({ fill: 0xe2e8f0 });
    expect(resolveFocusStyle({})?.color).toBe(0xe2e8f0);

    // A fill that names no colour number.
    setUIDefaultTextStyle({ fill: { fill: 0x112233 } });
    expect(resolveFocusStyle({})?.color).toBe(0xffffff);
  });

  it("resolves each field on its own, element over theme over default", () => {
    setUIFocusStyle({ color: 0x102030, width: 3 });

    expect(resolveFocusStyle(undefined)).toEqual({
      color: 0x102030,
      width: 3,
      radius: 4,
      inset: 0,
    });
    expect(resolveFocusStyle({ color: 0xff8800, inset: 2 })).toEqual({
      color: 0xff8800,
      width: 3,
      radius: 4,
      inset: 2,
    });
  });

  it("follows the element's own corner radius unless the themed style names one", () => {
    expect(resolveFocusStyle({}, 12)?.radius).toBe(12);

    setUIFocusStyle({ radius: 0 });
    expect(resolveFocusStyle(undefined, 12)?.radius).toBe(0);
  });
});

describe("focus outline drawing", () => {
  let container: MockContainer;
  let box: UIFocusOutlineBox;

  beforeEach(() => {
    container = new MockContainer();
    box = { x: 0, y: 0, width: 100, height: 40 };
    setUIFocusStyle({});
  });

  function outline(): FocusOutline {
    return new FocusOutline({
      container: container as unknown as DisplayContainer,
      box: () => box,
    });
  }

  /** The graphics the outline built inside its host container. */
  function graphics(): MockGraphics & { measurable?: boolean } {
    const child = container.children[0];
    if (!(child instanceof MockGraphics)) {
      throw new Error("the outline drew nothing");
    }
    return child;
  }

  it("strokes the box the host states, on a graphics that does not measure", () => {
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

  it("redraws only once the host's box moves", () => {
    const stroke = vi.spyOn(MockGraphics.prototype, "stroke");
    const focusOutline = outline();
    focusOutline.setFocused(true);

    focusOutline.refresh();
    focusOutline.refresh();
    expect(stroke).toHaveBeenCalledTimes(1);

    box = { x: 0, y: 0, width: 100, height: 60 };
    focusOutline.refresh();
    expect(stroke).toHaveBeenCalledTimes(2);
    expect(graphics().lastRect?.height).toBe(58);
    stroke.mockRestore();
  });

  it("redraws for a style the element itself names", () => {
    const focusOutline = outline();
    focusOutline.setFocused(true);

    focusOutline.set({ focusStyle: { color: 0xff0000, width: 4 } });

    expect(graphics().lastStroke).toEqual({ color: 0xff0000, width: 4 });
    expect(graphics().lastRect).toEqual({
      x: 2,
      y: 2,
      width: 96,
      height: 36,
      radius: 2,
    });
  });

  it("builds nothing where no style names an outline, until one does", () => {
    setUIFocusStyle(undefined);
    const focusOutline = outline();

    focusOutline.setFocused(true);
    focusOutline.refresh();
    expect(container.children).toEqual([]);

    focusOutline.set({ focusStyle: { color: 0x33ff88, width: 2 } });
    expect(graphics().visible).toBe(true);
  });

  it("builds nothing for an element that opted out of the UI-wide outline", () => {
    const focusOutline = outline();
    focusOutline.set({ focusStyle: null });

    focusOutline.setFocused(true);

    expect(container.children).toEqual([]);
  });

  it("hides the outline when the element opts out while it holds focus", () => {
    const focusOutline = outline();
    focusOutline.setFocused(true);
    expect(graphics().visible).toBe(true);

    focusOutline.set({ focusStyle: null });

    expect(graphics().visible).toBe(false);
  });
});

describe("focus with no outline", () => {
  it("still reports focus to the game and the Inspector, and paints the focus background", () => {
    const changes: boolean[] = [];
    const panel = new UIPanel({
      width: 100,
      height: 40,
      focusable: true,
      background: { color: 0x204060, radius: 4 },
      focusBackground: { color: 0xff0000 },
      onFocusChange: (focused) => changes.push(focused),
    });
    panel.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    panel.applyLayout();

    getFocusState(panel)?._setFocused(true);

    const drawn = (panel.container as unknown as MockContainer).children.filter(
      (child): child is MockGraphics => child instanceof MockGraphics,
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.lastFill?.color).toBe(0xff0000);
    expect(panel._inspectState()).toMatchObject({
      focused: true,
      focusable: true,
    });

    getFocusState(panel)?._setFocused(false);
    expect(changes).toEqual([true, false]);
  });
});
