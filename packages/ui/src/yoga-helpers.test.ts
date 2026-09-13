import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import Yoga, { Align, Direction, MeasureMode } from "yoga-layout";
import type { Node as YogaNode } from "yoga-layout";
import { createYogaNode, setYoga, warnChildOverflow } from "./yoga-helpers.js";
import type { UIElement } from "./types.js";

beforeAll(() => {
  setYoga(Yoga);
});

// A failing assertion would otherwise skip an inline restore and leave the
// console spy installed for the next test.
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A child that reports a fractional measured width, which is what makes Yoga
 * treat it as a text node. No Pixi here: the point is Yoga's pixel-grid
 * rounding, and a display object would only add noise.
 */
class MeasuredLeaf {
  readonly yogaNode: YogaNode;
  readonly displayObject = {} as UIElement["displayObject"];

  constructor(width: number, height = 20) {
    this.yogaNode = createYogaNode();
    this.yogaNode.setMeasureFunc((w, widthMode) => ({
      width: widthMode === MeasureMode.Exactly ? w : width,
      height,
    }));
  }

  asElement(): UIElement {
    return this as unknown as UIElement;
  }
}

/**
 * Root padded by a fractional amount, a parent inside it, and one measured
 * child inside that. The root's padding puts the parent at a fractional
 * absolute position, which is the condition the two rounding rules disagree
 * on. Omit `parentWidth` to let the parent shrink to fit its child.
 */
function buildRoundingTree(
  childWidth: number,
  parentWidth?: number,
): { root: YogaNode; parent: YogaNode; child: MeasuredLeaf } {
  const root = createYogaNode();
  root.setWidth(400);
  root.setHeight(100);
  root.setPadding(Yoga.EDGE_LEFT, 10.7);
  // Without this the column stretches the parent to the root's content width
  // and it is no longer shrink-to-fit.
  root.setAlignItems(Align.FlexStart);

  const parent = createYogaNode();
  // Same reason as above, one level down: a stretched child would be handed
  // an exact width and its measured width would never reach the layout.
  parent.setAlignItems(Align.FlexStart);
  if (parentWidth !== undefined) parent.setWidth(parentWidth);
  root.insertChild(parent, 0);

  const child = new MeasuredLeaf(childWidth);
  parent.insertChild(child.yogaNode, 0);

  root.calculateLayout(undefined, undefined, Direction.LTR);
  return { root, parent, child };
}

function overflowWarnings(warn: ReturnType<typeof vi.spyOn>): unknown[] {
  return warn.mock.calls.filter((c) =>
    String(c[0]).includes("overflows its container"),
  );
}

describe("overflow warning tolerance for Yoga's pixel rounding", () => {
  it("stays quiet when only Yoga's text rounding puts the child past the edge", () => {
    // Installing a measure function makes a node a text node to Yoga. A text
    // node's width is measured from a floored left edge to a ceiled right
    // edge; every other node's edges round to nearest. At a left edge of 10.7
    // and a measured width of 258.76 the parent's absolute edges are 10.7 and
    // 269.46, so the parent computes round(269.46) - round(10.7) = 258 and the
    // child computes ceil(269.46) - floor(10.7) = 260. The child sits two
    // points past its parent without a single layout prop being wrong. Yoga
    // rounds the child's relative position separately and it stays 0, so the
    // whole two points land on one edge rather than splitting across two.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root, parent, child } = buildRoundingTree(258.76);

    expect(parent.getComputedWidth()).toBe(258);
    expect(child.yogaNode.getComputedWidth()).toBe(260);
    expect(child.yogaNode.getComputedLeft()).toBe(0);

    warnChildOverflow(parent, [child.asElement()]);

    expect(overflowWarnings(warn)).toHaveLength(0);
    root.freeRecursive();
  });

  it("still reports a spill past the rounding artifact", () => {
    // The same tree with the child three points wider and the parent pinned
    // to the width the case above computed. Two of the five points are the
    // rounding artifact; three are a real spill.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root, parent, child } = buildRoundingTree(258.76 + 3, 258);

    expect(parent.getComputedWidth()).toBe(258);
    expect(child.yogaNode.getComputedWidth()).toBe(263);

    warnChildOverflow(parent, [child.asElement()]);

    expect(overflowWarnings(warn)).toHaveLength(1);
    root.freeRecursive();
  });
});
