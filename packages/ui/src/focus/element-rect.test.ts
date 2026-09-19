import { describe, expect, it } from "vitest";
import { readElementRect } from "./element-rect.js";
import { MockContainer } from "../test-helpers.js";
import type { Rect } from "../positioning.js";
import type { DisplayContainer } from "@yagejs/renderer";
import type { UIElement } from "../types.js";

function asDisplay(container: MockContainer): DisplayContainer {
  return container as unknown as DisplayContainer;
}

/** A stand-in element: a container to project, and a laid-out Yoga size. */
function makeElement(
  container: MockContainer,
  width: number,
  height: number,
): UIElement {
  return {
    displayObject: asDisplay(container),
    yogaNode: {
      getComputedWidth: () => width,
      getComputedHeight: () => height,
    } as unknown as UIElement["yogaNode"],
    visible: true,
    update: () => undefined,
    destroy: () => undefined,
  };
}

function emptyRect(): Rect {
  return { x: -1, y: -1, width: -1, height: -1 };
}

describe("readElementRect", () => {
  it("projects a nested element into the host's own space", () => {
    const host = new MockContainer();
    host.position.set(100, 200);
    const panel = host.addChild(new MockContainer());
    panel.position.set(10, 20);
    const box = panel.addChild(new MockContainer());
    box.position.set(5, 5);

    const out = emptyRect();
    expect(
      readElementRect(asDisplay(host), makeElement(box, 40, 20), out),
    ).toBe(true);
    expect(out).toEqual({ x: 15, y: 25, width: 40, height: 20 });
  });

  it("reads the layout box of an element its own scale sizes", () => {
    // A sprite fitted to its layout box: `applyLayout` writes the size as a
    // scale on the container, so the element's own space is the picture's
    // natural one and the 100 by 40 box belongs to the host's.
    const host = new MockContainer();
    const box = host.addChild(new MockContainer());
    box.position.set(200, 100);
    box.scale.x = 2;
    box.scale.y = 2;

    // Corners in the host's space: (200, 100) and (200 + 100, 100 + 40).
    const out = emptyRect();
    expect(
      readElementRect(asDisplay(host), makeElement(box, 100, 40), out),
    ).toBe(true);
    expect(out).toEqual({ x: 200, y: 100, width: 100, height: 40 });
  });

  it("reads a picture's box at its box, not at its texture's aspect", () => {
    // A 64 by 64 texture laid out into a 100 by 40 slot: Pixi sizes a sprite
    // by scale, so the sprite carries 100 / 64 across and 40 / 64 down. Read
    // out of the sprite's own space the box would come out 100 * 1.5625 wide
    // and 40 * 0.625 tall — 156.25 by 25, wider and shorter than the slot.
    const host = new MockContainer();
    const picture = host.addChild(new MockContainer());
    picture.position.set(0, 0);
    picture.scale.x = 100 / 64;
    picture.scale.y = 40 / 64;

    const out = emptyRect();
    expect(
      readElementRect(asDisplay(host), makeElement(picture, 100, 40), out),
    ).toBe(true);
    expect(out).toEqual({ x: 0, y: 0, width: 100, height: 40 });
  });

  it("magnifies a self-scaled element by its ancestors and not by itself", () => {
    const host = new MockContainer();
    const panel = host.addChild(new MockContainer());
    panel.position.set(10, 20);
    panel.scale.x = 2;
    panel.scale.y = 2;
    const image = panel.addChild(new MockContainer());
    image.position.set(5, 5);
    image.scale.x = 3;
    image.scale.y = 3;

    // Corners in the panel's space: (5, 5) and (5 + 30, 5 + 12) = (35, 17).
    // Through the panel: (10 + 5 * 2, 20 + 5 * 2) = (20, 30) and
    // (10 + 35 * 2, 20 + 17 * 2) = (80, 54), so 60 by 24 — the 30 by 12 box
    // doubled by the panel alone.
    const out = emptyRect();
    expect(
      readElementRect(asDisplay(host), makeElement(image, 30, 12), out),
    ).toBe(true);
    expect(out).toEqual({ x: 20, y: 30, width: 60, height: 24 });
  });

  it("keeps a self-scaled row's box on the scroll offset it is drawn at", () => {
    const host = new MockContainer();
    const viewport = host.addChild(new MockContainer());
    const content = viewport.addChild(new MockContainer());
    content.position.set(0, -140);
    const row = content.addChild(new MockContainer());
    row.position.set(0, 80);
    row.scale.x = 2;
    row.scale.y = 2;

    // Corners in the content's space: (0, 80) and (100, 110), carried up by
    // the content's -140 offset to (0, -60) and (100, -30).
    const out = emptyRect();
    expect(
      readElementRect(asDisplay(host), makeElement(row, 100, 30), out),
    ).toBe(true);
    expect(out).toEqual({ x: 0, y: -60, width: 100, height: 30 });
  });

  it("reads a box in the host's own space wherever the host is placed", () => {
    // A surface pinned by a Transform on a camera-scaled layer: the host's
    // own placement cancels out, because the box is asked for in its space.
    const host = new MockContainer();
    host.position.set(340, 210);
    host.scale.x = 1.5;
    host.scale.y = 1.5;
    const row = host.addChild(new MockContainer());
    row.position.set(12, 48);
    row.scale.x = 2;
    row.scale.y = 2;

    // Corners in the host's space: (12, 48) and (12 + 80, 48 + 24) = (92, 72).
    const out = emptyRect();
    expect(
      readElementRect(asDisplay(host), makeElement(row, 80, 24), out),
    ).toBe(true);
    expect(out).toEqual({ x: 12, y: 48, width: 80, height: 24 });
  });

  it("scales the projected box by a scaled ancestor", () => {
    const host = new MockContainer();
    const panel = host.addChild(new MockContainer());
    panel.position.set(10, 20);
    panel.scale.x = 2;
    panel.scale.y = 2;
    const box = panel.addChild(new MockContainer());
    box.position.set(5, 5);

    const out = emptyRect();
    expect(
      readElementRect(asDisplay(host), makeElement(box, 40, 20), out),
    ).toBe(true);
    expect(out).toEqual({ x: 20, y: 30, width: 80, height: 40 });
  });

  it("follows the scroll offset its parent container carries", () => {
    const host = new MockContainer();
    const viewport = host.addChild(new MockContainer());
    const content = viewport.addChild(new MockContainer());
    const box = content.addChild(new MockContainer());
    box.position.set(0, 80);
    const element = makeElement(box, 100, 30);

    const out = emptyRect();
    readElementRect(asDisplay(host), element, out);
    expect(out).toEqual({ x: 0, y: 80, width: 100, height: 30 });

    content.position.set(0, -140);
    readElementRect(asDisplay(host), element, out);
    expect(out).toEqual({ x: 0, y: -60, width: 100, height: 30 });
  });

  it("normalises the corners under a mirrored ancestor", () => {
    const host = new MockContainer();
    const content = host.addChild(new MockContainer());
    content.scale.x = -1;
    const box = content.addChild(new MockContainer());

    const out = emptyRect();
    expect(
      readElementRect(asDisplay(host), makeElement(box, 40, 20), out),
    ).toBe(true);
    expect(out).toEqual({ x: -40, y: 0, width: 40, height: 20 });
  });

  it("reports a node that never laid out and leaves the rect alone", () => {
    const host = new MockContainer();
    const box = host.addChild(new MockContainer());

    const out = emptyRect();
    expect(
      readElementRect(asDisplay(host), makeElement(box, Number.NaN, 20), out),
    ).toBe(false);
    expect(
      readElementRect(
        asDisplay(host),
        makeElement(box, 40, Number.POSITIVE_INFINITY),
        out,
      ),
    ).toBe(false);
    expect(out).toEqual({ x: -1, y: -1, width: -1, height: -1 });
  });
});
