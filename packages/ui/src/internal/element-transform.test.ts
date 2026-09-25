import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("pixi.js", async () => (await import("../test-pixi.js")).pixiMock);

import Yoga, { Direction } from "yoga-layout";
import type { DisplayContainer } from "@yagejs/renderer";
import { MockContainer } from "../test-pixi.js";
import { createYogaNode, setYoga } from "../yoga-helpers.js";
import type { UIElement } from "../types.js";
import { UIElementBase } from "../UIElementBase.js";
import type { ElementTransform } from "./element-transform.js";
import { placeElement } from "./element-transform.js";

beforeAll(() => setYoga(Yoga));

class UITest extends UIElementBase {
  readonly displayObject = new MockContainer() as unknown as DisplayContainer;
  readonly yogaNode = createYogaNode();
  visible = true;
  update(): void {}
  destroy(): void {
    this.yogaNode.free();
  }
}

/** A 40 x 20 element, laid out unless `laidOut` is `false`. */
function makeElement(laidOut = true): {
  display: MockContainer;
  transform: ElementTransform;
  element: UIElement;
} {
  const element = new UITest();
  element.yogaNode.setWidth(40);
  element.yogaNode.setHeight(20);
  if (laidOut) {
    element.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
  }
  const display = element.displayObject as unknown as MockContainer;
  return { display, transform: element._transform, element };
}

describe("ElementTransform", () => {
  it("places the corner with no pivot at the default origin", () => {
    const { display, element } = makeElement();

    placeElement(element, 100, 50);

    expect(display.position).toMatchObject({ x: 100, y: 50 });
    expect(display.pivot).toMatchObject({ x: 0, y: 0 });
  });

  it("puts the pivot at the origin and adds it back into the position", () => {
    const { display, transform, element } = makeElement();
    transform.set({ transformOrigin: { x: 0.5, y: 1 } });

    placeElement(element, 100, 50);

    expect(display.pivot).toMatchObject({ x: 20, y: 20 });
    expect(display.position).toMatchObject({ x: 120, y: 70 });
    expect(transform.transformOrigin).toEqual({ x: 0.5, y: 1 });
  });

  it("moves the pivot at once and keeps the corner where layout put it", () => {
    const { display, transform, element } = makeElement();
    placeElement(element, 100, 50);

    transform.transformOrigin = 0.5;
    expect(display.pivot).toMatchObject({ x: 20, y: 10 });
    expect(display.position).toMatchObject({ x: 120, y: 60 });

    transform.transformOrigin = 0;
    expect(display.pivot).toMatchObject({ x: 0, y: 0 });
    expect(display.position).toMatchObject({ x: 100, y: 50 });
  });

  it("leaves the pivot to the first layout pass when set before it", () => {
    const { display, transform, element } = makeElement(false);
    transform.transformOrigin = 0.5;

    expect(display.pivot).toMatchObject({ x: 0, y: 0 });

    element.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);
    placeElement(element, 10, 10);
    expect(display.pivot).toMatchObject({ x: 20, y: 10 });
    expect(display.position).toMatchObject({ x: 30, y: 20 });
  });

  it("writes scale, rotation and zIndex to the display object at once", () => {
    const { display, transform } = makeElement();

    transform.scale = 1.5;
    transform.rotation = 0.25;
    transform.zIndex = 3;
    expect(display.scale).toMatchObject({ x: 1.5, y: 1.5 });
    expect(display.rotation).toBe(0.25);
    expect(display.zIndex).toBe(3);

    transform.scale = { x: -1, y: 0 };
    expect(display.scale).toMatchObject({ x: -1, y: 0 });
    expect(transform.scale).toEqual({ x: -1, y: 0 });
  });

  it("reads back one object for scale and origin, updated in place", () => {
    const { transform } = makeElement();
    const scale = transform.scale;
    const origin = transform.transformOrigin;

    transform.scale = 2;
    transform.transformOrigin = 0.5;

    expect(transform.scale).toBe(scale);
    expect(transform.transformOrigin).toBe(origin);
    expect(scale).toEqual({ x: 2, y: 2 });
  });

  it("resets a present key holding undefined and leaves an absent one", () => {
    const { display, transform, element } = makeElement();
    transform.set({
      transformOrigin: 0.5,
      scale: 2,
      rotation: 1,
      zIndex: 4,
    });
    placeElement(element, 0, 0);

    transform.set({ zIndex: 5 });
    expect(display.scale).toMatchObject({ x: 2, y: 2 });
    expect(display.rotation).toBe(1);

    transform.set({
      transformOrigin: undefined,
      scale: undefined,
      rotation: undefined,
      zIndex: undefined,
    });

    expect(transform.transformOrigin).toEqual({ x: 0, y: 0 });
    expect(display.pivot).toMatchObject({ x: 0, y: 0 });
    expect(display.position).toMatchObject({ x: 0, y: 0 });
    expect(display.scale).toMatchObject({ x: 1, y: 1 });
    expect(display.rotation).toBe(0);
    expect(display.zIndex).toBe(0);
  });

  it.each([
    ["scale", { scale: Number.NaN }, "UITest.scale: must be finite, got NaN"],
    [
      "one axis of scale",
      { scale: { x: 1, y: Number.POSITIVE_INFINITY } },
      "UITest.scale.y: must be finite, got Infinity",
    ],
    [
      "transformOrigin",
      { transformOrigin: { x: Number.NaN, y: 0 } },
      "UITest.transformOrigin.x: must be finite, got NaN",
    ],
    [
      "rotation",
      { rotation: Number.NEGATIVE_INFINITY },
      "UITest.rotation: must be finite, got -Infinity",
    ],
    [
      "zIndex",
      { zIndex: Number.NaN },
      "UITest.zIndex: must be finite, got NaN",
    ],
    [
      "scale beside a valid origin",
      { transformOrigin: 0.5, scale: Number.NaN },
      "UITest.scale: must be finite, got NaN",
    ],
  ])(
    "throws on a non-finite %s before writing anything",
    (_n, props, message) => {
      const { display, transform } = makeElement();

      expect(() => transform.set(props)).toThrow(message);

      expect(display.scale).toMatchObject({ x: 1, y: 1 });
      expect(display.pivot).toMatchObject({ x: 0, y: 0 });
      expect(display.rotation).toBe(0);
      expect(display.zIndex).toBe(0);
      expect(transform.scale).toEqual({ x: 1, y: 1 });
      expect(transform.transformOrigin).toEqual({ x: 0, y: 0 });
    },
  );
});

describe("placeElement", () => {
  it("places an element with no transform state at its corner", () => {
    const display = new MockContainer();
    const element = {
      displayObject: display as unknown as DisplayContainer,
    } as UIElement;

    placeElement(element, 7, 9);

    expect(display.position).toMatchObject({ x: 7, y: 9 });
  });
});
