import { describe, expect, it } from "vitest";
import type { GizmoAnchor, HandleId } from "../store/index.js";
import { ARM_PIXELS, CROSSHAIR_PIXELS, RING_PIXELS } from "./gizmo.js";
import { RADIAL_BODY_PIXELS, RADIAL_EDGE_PIXELS } from "./radial.js";
import { MARK_PIXELS } from "./marks.js";
import {
  CASING_COLOR,
  LINK_DASH_PIXELS,
  drawOverlay,
  type OverlayTarget,
  type OverlayView,
} from "./overlay.js";

/** One drawing call, as the recorder saw it. */
type Call = readonly [string, ...number[]];

/**
 * A `Graphics` reduced to what it was asked to draw.
 *
 * The overlay's whole output is a picture, and this is the only way to assert
 * one without a canvas: record the calls and check what reached them. Strokes
 * and fills are recorded as their colour and width, because the casing under
 * each coloured stroke is a difference in style rather than in shape.
 */
function recorder(): OverlayTarget & { calls: Call[] } {
  const calls: Call[] = [];
  const target: OverlayTarget & { calls: Call[] } = {
    calls,
    clear() {
      calls.push(["clear"]);
      return target;
    },
    moveTo(x, y) {
      calls.push(["moveTo", x, y]);
      return target;
    },
    lineTo(x, y) {
      calls.push(["lineTo", x, y]);
      return target;
    },
    rect(x, y, width, height) {
      calls.push(["rect", x, y, width, height]);
      return target;
    },
    circle(x, y, radius) {
      calls.push(["circle", x, y, radius]);
      return target;
    },
    stroke(style) {
      calls.push(["stroke", style.color, style.width, style.alpha ?? 1]);
      return target;
    },
    fill(style) {
      calls.push(["fill", style.color]);
      return target;
    },
  };
  return target;
}

const EMPTY: OverlayView = { boxes: [], perScreenPixel: 1 };

/** Every grip, for a case that is not about which ones a box offers. */
const ALL_GRIPS: readonly HandleId[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];
const AT_ORIGIN: GizmoAnchor = { position: { x: 0, y: 0 }, rotation: 0 };
const ORIGIN = { x: 0, y: 0 };

function calls(view: OverlayView): Call[] {
  const target = recorder();
  drawOverlay(target, view);
  return target.calls;
}

function named(all: Call[], name: string): Call[] {
  return all.filter((call) => call[0] === name);
}

function same(a: Call, b: Call): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * How strongly the first coloured stroke is drawn — what tells a quieter shape
 * from a fully drawn one without naming either colour.
 *
 * First, because both views below draw the shape under test before anything
 * else: a covering outline goes down before the gizmo, and a selection marker
 * before both.
 */
function colouredAlpha(all: Call[]): number {
  const alpha = named(all, "stroke").find(
    (call) => call[1] !== CASING_COLOR,
  )?.[3];
  if (alpha === undefined) throw new Error("nothing was stroked in colour");
  return alpha;
}

/**
 * The distinct shapes of one kind.
 *
 * Every stroked shape is drawn twice — once for the casing, once for the
 * colour over it — with the same geometry both times, so folding the repeats
 * out leaves what the picture is of.
 */
function shapes(all: Call[], name: string): Call[] {
  const seen = new Set<string>();
  return named(all, name).filter((call) => {
    const key = JSON.stringify(call);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every straight piece the picture is made of, in the order it was drawn: each
 * `moveTo` and the `lineTo` that follows it. A dashed line is several of them,
 * which is the whole difference from a solid one.
 */
function pieces(all: Call[]): { from: number[]; to: number[] }[] {
  const found: { from: number[]; to: number[] }[] = [];
  let start: number[] | undefined;
  for (const call of all) {
    if (call[0] === "moveTo") start = call.slice(1) as number[];
    else if (call[0] === "lineTo" && start) {
      found.push({ from: start, to: call.slice(1) as number[] });
    }
  }
  return found;
}

/** The dashes of a link, without the two barbs of its arrowhead. */
function dashes(all: Call[]): { from: number[]; to: number[] }[] {
  return pieces(all).slice(0, -2);
}

/** The two barbs, which are the last two pieces a link draws. */
function barbs(all: Call[]): { from: number[]; to: number[] }[] {
  return pieces(all).slice(-2);
}

const TRANSLATE: OverlayView = {
  ...EMPTY,
  gizmo: { kind: "arms", mode: "translate", anchor: AT_ORIGIN },
};

describe("drawOverlay", () => {
  it("outlines a whole selection, quieter than the placements in it", () => {
    const covering = {
      center: { x: 100, y: 0 },
      axisX: { x: 1, y: 0 },
      axisY: { x: 0, y: 1 },
      halfX: 150,
      halfY: 50,
    };
    const outlined = calls({
      ...TRANSLATE,
      gizmo: { kind: "arms", mode: "translate", anchor: AT_ORIGIN, covering },
    });
    const marked = calls({
      ...TRANSLATE,
      boxes: [{ minX: -50, minY: -50, maxX: 50, maxY: 50 }],
    });

    // The outline's own corner, which nothing else in the view is drawn at.
    expect(shapes(outlined, "lineTo")).toContainEqual(["lineTo", 250, 50]);
    // Drawn under the placements it encloses: it says what is selected
    // together, it is not another thing selected.
    expect(colouredAlpha(outlined)).toBeLessThan(colouredAlpha(marked));
  });

  it("crosses every selected placement's origin", () => {
    const without = calls(TRANSLATE);
    const all = calls({
      ...TRANSLATE,
      origins: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
    });

    // A crosshair each — and each is traced twice, once for the casing and
    // once for the colour, like every other mark the overlay draws.
    const added = named(all, "moveTo").filter(
      (call) => !named(without, "moveTo").some((one) => same(one, call)),
    );
    const cross = (x: number): Call[] => [
      ["moveTo", x - CROSSHAIR_PIXELS, 0],
      ["moveTo", x, -CROSSHAIR_PIXELS],
    ];
    expect(added).toEqual([
      ...cross(0),
      ...cross(0),
      ...cross(200),
      ...cross(200),
    ]);
  });

  it("draws no pivot where a box gizmo has none", () => {
    const box = {
      center: { x: 0, y: 0 },
      axisX: { x: 1, y: 0 },
      axisY: { x: 0, y: 1 },
      halfX: 100,
      halfY: 100,
    };
    const withPivot = calls({
      ...EMPTY,
      gizmo: { kind: "box", box, grips: ALL_GRIPS, pivot: { x: 0, y: 0 } },
    });
    const without = calls({
      ...EMPTY,
      gizmo: { kind: "box", box, grips: ALL_GRIPS },
    });

    // Under the each pivot there is no one point the placements turn about,
    // and a dot drawn anyway would name one.
    expect(named(withPivot, "circle")).toHaveLength(1);
    expect(named(without, "circle")).toHaveLength(0);
  });

  it("starts from nothing every frame", () => {
    // The picture is redrawn rather than moved, because a zoom changes what
    // its pixel sizes are worth.
    expect(calls(EMPTY)[0]).toEqual(["clear"]);
  });

  it("draws nothing else when nothing is selected", () => {
    expect(calls(EMPTY)).toEqual([["clear"]]);
  });

  it("boxes each selected placement", () => {
    const all = calls({
      ...EMPTY,
      boxes: [
        { minX: 0, minY: 0, maxX: 10, maxY: 4 },
        { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      ],
    });

    expect(shapes(all, "rect")).toEqual([
      ["rect", 0, 0, 10, 4],
      ["rect", -5, -5, 10, 10],
    ]);
  });

  it("crosses every selected placement's origin, where it sits", () => {
    const all = calls({ ...EMPTY, origins: [{ x: 20, y: -7 }] });

    // Two strokes through the point, so a placement drawing nothing still
    // says where it is.
    expect(shapes(all, "moveTo")).toEqual([
      ["moveTo", 20 - CROSSHAIR_PIXELS, -7],
      ["moveTo", 20, -7 - CROSSHAIR_PIXELS],
    ]);
    expect(shapes(all, "lineTo")).toEqual([
      ["lineTo", 20 + CROSSHAIR_PIXELS, -7],
      ["lineTo", 20, -7 + CROSSHAIR_PIXELS],
    ]);
  });

  it("draws the rotate gizmo as one ring and no arms", () => {
    const all = calls({
      ...EMPTY,
      gizmo: { kind: "arms", mode: "rotate", anchor: AT_ORIGIN },
    });

    expect(shapes(all, "circle")).toEqual([["circle", 0, 0, RING_PIXELS]]);
    expect(named(all, "lineTo")).toEqual([]);
  });

  it("gives translate round tips and scale square ones", () => {
    const translate = calls(TRANSLATE);
    const scale = calls({
      ...EMPTY,
      gizmo: { kind: "arms", mode: "scale", anchor: AT_ORIGIN },
    });

    // Both draw two arms; the shape at the end is what tells them apart.
    expect(shapes(translate, "lineTo")).toHaveLength(2);
    expect(shapes(scale, "lineTo")).toHaveLength(2);
    expect(shapes(translate, "circle")).toHaveLength(2);
    expect(shapes(scale, "circle")).toHaveLength(0);
    // Two arm tips plus the centre square.
    expect(shapes(scale, "rect")).toHaveLength(3);
  });

  it("draws the radial gizmo as a boundary, a disc, and scale arms", () => {
    const all = calls({
      ...EMPTY,
      gizmo: { kind: "radial", anchor: AT_ORIGIN },
    });

    // The boundary is what a press inside moves and a press outside turns, and
    // the disc says where the move target is under the arms crossing it.
    expect(shapes(all, "circle")).toEqual([
      ["circle", 0, 0, RADIAL_EDGE_PIXELS],
      ["circle", 0, 0, RADIAL_BODY_PIXELS],
    ]);
    // Two arms with square tips, and the square on the diagonal — the scale
    // gizmo's own shapes, because the grips do what its grips do.
    expect(shapes(all, "lineTo")).toHaveLength(2);
    expect(shapes(all, "rect")).toHaveLength(3);
  });

  it("stretches everything by the zoom", () => {
    const far = calls({
      ...EMPTY,
      perScreenPixel: 3,
      gizmo: { kind: "arms", mode: "translate", anchor: AT_ORIGIN },
    });

    const arms = shapes(far, "lineTo");
    // Close rather than exact: the y axis comes from `cos(pi/2)`, which is not
    // quite zero, and the arm length multiplies it.
    expect(arms[0]?.[1]).toBeCloseTo(ARM_PIXELS * 3, 9);
    expect(arms[0]?.[2]).toBeCloseTo(0, 9);
    expect(arms[1]?.[1]).toBeCloseTo(0, 9);
    expect(arms[1]?.[2]).toBeCloseTo(ARM_PIXELS * 3, 9);
  });

  it("draws the marker and the gizmo together", () => {
    const all = calls({
      boxes: [{ minX: 0, minY: 0, maxX: 2, maxY: 2 }],
      perScreenPixel: 1,
      gizmo: { kind: "arms", mode: "translate", anchor: AT_ORIGIN },
    });

    // The marker is drawn first, so the gizmo sits over it.
    expect(all[1]?.[0]).toBe("rect");
    expect(shapes(all, "lineTo")).toHaveLength(2);
  });

  it("puts a wider dark casing under every coloured stroke", () => {
    // A project chooses the preview's background, so a red arm may be drawn
    // over red scenery. The casing is what makes the same gizmo readable on
    // any of them, and it has to be under the colour rather than over it.
    const all = calls({
      boxes: [{ minX: 0, minY: 0, maxX: 2, maxY: 2 }],
      origins: [{ x: 9, y: 9 }],
      perScreenPixel: 1,
      gizmo: { kind: "arms", mode: "translate", anchor: AT_ORIGIN },
    });
    const strokes = named(all, "stroke");

    expect(strokes.length).toBeGreaterThan(0);
    for (const [index, stroke] of strokes.entries()) {
      if (stroke[1] === CASING_COLOR) continue;
      const under = strokes[index - 1];
      expect(under?.[1]).toBe(CASING_COLOR);
      expect(under?.[2] ?? 0).toBeGreaterThan(stroke[2] ?? 0);
    }
  });

  it("outlines every filled handle", () => {
    // A handle is a solid dot on whatever is behind it. Without an outline it
    // disappears into a placement of the same colour.
    const all = calls(TRANSLATE);
    const fills = all
      .map((call, index) => ({ call, index }))
      .filter((entry) => entry.call[0] === "fill");

    // Two arm tips and the centre.
    expect(fills).toHaveLength(3);
    for (const { index } of fills) {
      expect(all[index + 1]?.[0]).toBe("stroke");
      expect(all[index + 1]?.[1]).toBe(CASING_COLOR);
    }
  });

  it("outlines what a drag of the selection would carry with it", () => {
    // A child can be drawn far outside its parent's box, so nothing on screen
    // says why it moved. Both are marked; only the weight differs.
    const all = calls({
      ...EMPTY,
      boxes: [{ minX: 0, minY: 0, maxX: 4, maxY: 4 }],
      carried: {
        boxes: [{ minX: 40, minY: 40, maxX: 46, maxY: 44 }],
        points: [{ x: -8, y: 3 }],
      },
    });

    expect(shapes(all, "rect")).toEqual([
      ["rect", 40, 40, 6, 4],
      ["rect", 0, 0, 4, 4],
    ]);
    expect(shapes(all, "moveTo")).toEqual([
      ["moveTo", -8 - CROSSHAIR_PIXELS, 3],
      ["moveTo", -8, 3 - CROSSHAIR_PIXELS],
    ]);
  });

  it("marks what is carried more quietly than the selection", () => {
    const carried = named(
      calls({
        ...EMPTY,
        carried: {
          boxes: [{ minX: 0, minY: 0, maxX: 4, maxY: 4 }],
          points: [],
        },
      }),
      "stroke",
    );
    const selected = named(
      calls({ ...EMPTY, boxes: [{ minX: 0, minY: 0, maxX: 4, maxY: 4 }] }),
      "stroke",
    );

    expect(carried).toHaveLength(selected.length);
    for (const [index, stroke] of carried.entries()) {
      const louder = selected[index];
      expect(stroke[1]).toBe(louder?.[1]);
      expect(stroke[2] ?? 0).toBeLessThan(louder?.[2] ?? 0);
      expect(stroke[3] ?? 0).toBeLessThan(louder?.[3] ?? 0);
    }
  });

  it("draws what is carried under the selection", () => {
    // A selected parent and its child overlap; the selection is the one that
    // has to stay readable.
    const all = calls({
      ...EMPTY,
      boxes: [{ minX: 0, minY: 0, maxX: 4, maxY: 4 }],
      carried: { boxes: [{ minX: 1, minY: 1, maxX: 3, maxY: 3 }], points: [] },
    });

    expect(shapes(all, "rect")[0]).toEqual(["rect", 1, 1, 2, 2]);
  });

  it("draws nothing extra when the selection carries nothing", () => {
    expect(calls({ ...EMPTY, carried: { boxes: [], points: [] } })).toEqual([
      ["clear"],
    ]);
  });

  it("plates every mark, so it reads over whatever the level draws", () => {
    const all = calls({
      ...EMPTY,
      marks: [{ type: "LightSource", kind: "light", at: { x: 30, y: 12 } }],
    });
    const plate = shapes(all, "rect")[0];

    // A square of the mark's own size, centred where the row put it.
    expect(plate).toEqual([
      "rect",
      30 - MARK_PIXELS / 2,
      12 - MARK_PIXELS / 2,
      MARK_PIXELS,
      MARK_PIXELS,
    ]);
    expect(named(all, "fill")[0]?.[1]).toBe(CASING_COLOR);
  });

  it("draws a different picture for each kind", () => {
    const drawings = new Set(
      (["ui", "particles", "light", "occluder", "other"] as const).map((kind) =>
        JSON.stringify(
          calls({ ...EMPTY, marks: [{ type: kind, kind, at: ORIGIN }] }),
        ),
      ),
    );

    expect(drawings.size).toBe(5);
  });

  it("keeps every mark the same size on screen", () => {
    const mark = { type: "LightSource", kind: "light", at: ORIGIN } as const;
    const near = calls({ ...EMPTY, marks: [mark] });
    const far = calls({ ...EMPTY, marks: [mark], perScreenPixel: 4 });

    expect(shapes(far, "rect")[0]).toEqual([
      "rect",
      -MARK_PIXELS * 2,
      -MARK_PIXELS * 2,
      MARK_PIXELS * 4,
      MARK_PIXELS * 4,
    ]);
    expect(far).toHaveLength(near.length);
  });

  it("draws nothing extra when no placement carries one", () => {
    expect(calls({ ...EMPTY, marks: [] })).toEqual([["clear"]]);
  });

  it("scales the casing with the zoom, like everything else", () => {
    const near = named(calls(TRANSLATE), "stroke");
    const far = named(calls({ ...TRANSLATE, perScreenPixel: 4 }), "stroke");

    expect(far).toHaveLength(near.length);
    for (const [index, stroke] of far.entries()) {
      expect(stroke[2]).toBeCloseTo((near[index]?.[2] ?? 0) * 4, 9);
    }
  });
});

describe("a reference line", () => {
  function link(from: number, to: number, perScreenPixel = 1): Call[] {
    return calls({
      ...EMPTY,
      perScreenPixel,
      links: [{ from: { x: from, y: 0 }, to: { x: to, y: 0 } }],
    });
  }

  it("draws the span as separate dashes", () => {
    const drawn = dashes(link(0, 200));

    // Several pieces with space between them: a solid line would read as an
    // edge of something.
    expect(drawn.length).toBeGreaterThan(1);
    expect(drawn[1]?.from[0]).toBeGreaterThan(drawn[0]?.to[0] ?? 0);
  });

  it("keeps one dash length on screen at any zoom", () => {
    const lengthOf = (perScreenPixel: number): number => {
      const first = dashes(link(0, 200, perScreenPixel))[0];
      if (!first) throw new Error("nothing was dashed");
      return ((first.to[0] ?? 0) - (first.from[0] ?? 0)) / perScreenPixel;
    };

    expect(lengthOf(1)).toBeCloseTo(LINK_DASH_PIXELS, 9);
    expect(lengthOf(4)).toBeCloseTo(LINK_DASH_PIXELS, 9);
  });

  it("draws one piece over a span shorter than a dash", () => {
    const drawn = dashes(link(0, LINK_DASH_PIXELS / 2));

    // Two placements a few pixels apart are still joined by something.
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.to[0]).toBeCloseTo(LINK_DASH_PIXELS / 2, 9);
  });

  it("puts the arrowhead on the target", () => {
    const forward = barbs(link(0, 200));
    const backward = barbs(link(200, 0));

    // A reference runs one way, and two placements can point at each other.
    expect(forward.map((barb) => barb.from[0])).toEqual([200, 200]);
    expect(backward.map((barb) => barb.from[0])).toEqual([0, 0]);
    // Both barbs reach back along the line rather than past its end.
    for (const barb of forward) expect(barb.to[0]).toBeLessThan(200);
  });

  it("draws nothing between two ends at one point", () => {
    // No direction, so no line to dash and no way to aim a head.
    expect(link(30, 30)).toEqual([["clear"]]);
  });
});
