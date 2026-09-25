import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("pixi.js", async () => (await import("./test-pixi.js")).widgetPixiMock);

vi.mock("@yagejs/renderer", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  resolveTextureInput: () => ({ width: 120, height: 40 }),
}));

import Yoga, { Direction } from "yoga-layout";
import { setYoga } from "./yoga-helpers.js";
import { MockContainer, MockGraphics } from "./test-pixi.js";
import type { LayoutProps, UIElement } from "./types.js";
import { UIButton } from "./UIButton.js";
import { UICheckbox } from "./UICheckbox.js";
import { UIImage } from "./UIImage.js";
import { UINineSlice } from "./UINineSlice.js";
import { UIPanel } from "./UIPanel.js";
import { UIProgressBar } from "./UIProgressBar.js";
import { UIScrollView } from "./UIScrollView.js";
import { UISplitText } from "./UISplitText.js";
import { UIText } from "./UIText.js";
import { layoutFloat } from "./floating.js";
import { getFocusState } from "./focus/FocusState.js";
import { setUIFocusStyle } from "./internal/focus-outline.js";

beforeAll(() => setYoga(Yoga));

/** An element that takes the transform props, and its accessors. */
interface TransformWidget extends UIElement {
  update(props: LayoutProps): void;
  transformOrigin: Readonly<{ x: number; y: number }>;
  scale: Readonly<{ x: number; y: number }>;
  rotation: number;
  zIndex: number;
}

const SIZE = { width: 120, height: 40 };

const widgets: [string, (props: LayoutProps) => TransformWidget][] = [
  ["UIButton", (p) => new UIButton({ children: "Go", ...SIZE, ...p })],
  ["UICheckbox", (p) => new UICheckbox({ label: "On", ...p })],
  ["UIImage", (p) => new UIImage({ texture: "cell", ...SIZE, ...p })],
  [
    "UINineSlice",
    (p) => new UINineSlice({ texture: "panel", insets: 4, ...SIZE, ...p }),
  ],
  ["UIPanel", (p) => new UIPanel({ ...SIZE, ...p })],
  ["UIProgressBar", (p) => new UIProgressBar({ value: 0.5, ...SIZE, ...p })],
  ["UIScrollView", (p) => new UIScrollView({ ...SIZE, ...p })],
  [
    "UISplitText",
    (p) => new UISplitText({ children: "hi there", ...SIZE, ...p }),
  ],
  ["UIText", (p) => new UIText({ children: "hi", ...SIZE, ...p })],
];

function display(element: UIElement): MockContainer {
  return element.displayObject as unknown as MockContainer;
}

it.each(widgets)("%s takes the transform props", (name, create) => {
  const parent = new UIPanel({ padding: 10 });
  const el = create({
    transformOrigin: 0.5,
    scale: { x: 1.5, y: 2 },
    rotation: 0.5,
    zIndex: 2,
  });
  parent.addElement(el);
  parent.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
  parent.applyLayout();

  const width = el.yogaNode.getComputedWidth();
  const height = el.yogaNode.getComputedHeight();
  const shown = display(el);
  expect(shown.pivot).toMatchObject({ x: width / 2, y: height / 2 });
  expect(shown.position).toMatchObject({
    x: 10 + width / 2,
    y: 10 + height / 2,
  });
  expect(shown.scale).toMatchObject({ x: 1.5, y: 2 });
  expect(shown.rotation).toBe(0.5);
  expect(shown.zIndex).toBe(2);

  el.update({
    transformOrigin: undefined,
    scale: undefined,
    rotation: undefined,
    zIndex: undefined,
  });

  expect(el.transformOrigin).toEqual({ x: 0, y: 0 });
  expect(shown.pivot).toMatchObject({ x: 0, y: 0 });
  expect(shown.position).toMatchObject({ x: 10, y: 10 });
  expect(shown.scale).toMatchObject({ x: 1, y: 1 });
  expect(shown.rotation).toBe(0);
  expect(shown.zIndex).toBe(0);
  expect(() => el.update({ scale: Number.POSITIVE_INFINITY })).toThrow(
    `${name}.scale: must be finite, got Infinity`,
  );
  parent.destroy();
});

describe("zIndex", () => {
  it("orders a panel's children above its background and under its outline", () => {
    setUIFocusStyle({});
    const panel = new UIPanel({
      width: 200,
      height: 100,
      background: { color: 0x222222 },
      focusable: true,
    });
    const [low, middle, high] = [0, 1, 2].map(() => {
      const child = new UIPanel({ width: 20, height: 20 });
      panel.addElement(child);
      return child;
    }) as [UIPanel, UIPanel, UIPanel];
    getFocusState(panel)?._setFocused(true);
    panel.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    panel.applyLayout();

    // The first child added is raised over its siblings. The last is lowered
    // far below them and still draws over the background.
    low.zIndex = 5;
    high.zIndex = -1_000_000;
    const container = display(panel);
    container.sortChildren();

    const children = container.children;
    const outline = children.at(-1);
    expect(outline).toBeInstanceOf(MockGraphics);
    expect(outline?.zIndex).toBe(Infinity);
    expect(children.slice(0, 2).map((child) => child.zIndex)).toEqual([
      -Infinity,
      -Infinity,
    ]);
    expect(children.slice(2, 5)).toEqual([
      display(high),
      display(middle),
      display(low),
    ]);
    panel.destroy();
    setUIFocusStyle(undefined);
  });

  it("keeps a button's children above its background", () => {
    const button = new UIButton({ children: "Go" });
    const icon = new UIPanel({ width: 10, height: 10, zIndex: -5 });
    button.addElement(icon);
    const container = display(button);
    container.sortChildren();

    expect(container.children[0]?.zIndex).toBe(-Infinity);
    expect(container.children[1]).toBe(display(icon));
    button.destroy();
  });
});

describe("placement", () => {
  it("places a button's children about their origins", () => {
    const button = new UIButton({ padding: 4 });
    const icon = new UIPanel({ width: 20, height: 10, transformOrigin: 0.5 });
    button.addElement(icon);
    button.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    button.applyLayout();

    expect(display(icon).pivot).toMatchObject({ x: 10, y: 5 });
    expect(display(icon).position).toMatchObject({ x: 14, y: 9 });
    button.destroy();
  });

  it("scrolls a scaled row into view by its layout box", () => {
    // Four 30 px rows in a 50 px viewport; row 3 spans 90 to 120 in layout
    // and draws from 75 to 135 at twice its size about its centre.
    const view = new UIScrollView({ width: 100, height: 50, scrollbar: false });
    const rows = [0, 1, 2, 3].map(
      () => new UIPanel({ width: 100, height: 30, transformOrigin: 0.5 }),
    );
    for (const row of rows) view.addElement(row);
    rows[3]!.scale = 2;
    view.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    view.applyLayout();

    view.scrollIntoView(rows[3]!);

    expect(view.scrollOffset).toBe(70);
    expect(view.maxScroll).toBe(70);
    view.destroy();
  });

  it("drags a scaled scroll view at its own scale", () => {
    const view = new UIScrollView({ width: 100, height: 50, scrollbar: false });
    for (let i = 0; i < 4; i += 1) {
      view.addElement(new UIPanel({ width: 100, height: 30 }));
    }
    view.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    view.applyLayout();
    view.scale = 2;
    const viewport = display(view);

    viewport.emit("pointerdown", { global: { x: 10, y: 90 } });
    viewport.emit("globalpointermove", { global: { x: 10, y: 30 } });

    // 60 screen px is 30 px of the view's own space.
    expect(view.scrollOffset).toBeCloseTo(30);
    viewport.emit("pointerup", { global: { x: 10, y: 30 } });
    view.destroy();
  });

  it("stacks floating content about each element's origin", () => {
    const first = new UIPanel({ width: 60, height: 20 });
    const second = new UIPanel({ width: 40, height: 10, transformOrigin: 1 });

    expect(layoutFloat([first, second], undefined)).toEqual({
      width: 60,
      height: 30,
    });

    expect(display(first).position).toMatchObject({ x: 0, y: 0 });
    expect(display(second).pivot).toMatchObject({ x: 40, y: 10 });
    expect(display(second).position).toMatchObject({ x: 40, y: 30 });
    first.destroy();
    second.destroy();
  });
});
