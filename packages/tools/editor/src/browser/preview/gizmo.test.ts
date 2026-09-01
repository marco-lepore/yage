import { describe, expect, it } from "vitest";
import type {
  EditorPoint,
  GizmoAnchor,
  GizmoMode,
  HandleId,
} from "../store/index.js";
import {
  ARM_PIXELS,
  GRAB_PIXELS,
  HANDLE_PIXELS,
  MISS_PIXELS,
  RING_PIXELS,
  handleAt,
  handleDirection,
  handlesFor,
  nearGizmo,
  nearestHandle,
} from "./gizmo.js";

const AT_ORIGIN: GizmoAnchor = { position: { x: 0, y: 0 }, rotation: 0 };

describe("handlesFor", () => {
  it("puts the arms along the placement's own axes", () => {
    const turned: GizmoAnchor = {
      position: { x: 100, y: 50 },
      rotation: Math.PI / 2,
    };

    const handles = handlesFor("translate", turned, 1);
    const x = handles.find((handle) => handle.id === "x");
    const y = handles.find((handle) => handle.id === "y");

    // A quarter turn puts the x arm where the y arm would otherwise be.
    expect(x?.at.x).toBeCloseTo(100, 9);
    expect(x?.at.y).toBeCloseTo(50 + ARM_PIXELS, 9);
    expect(y?.at.x).toBeCloseTo(100 - ARM_PIXELS, 9);
    expect(y?.at.y).toBeCloseTo(50, 9);
  });

  it("keeps one size on screen as the camera zooms", () => {
    const near = handlesFor("translate", AT_ORIGIN, 1);
    const far = handlesFor("translate", AT_ORIGIN, 4);

    // Four world units per pixel means the arm covers four times the world to
    // occupy the same pixels.
    expect(near.find((handle) => handle.id === "x")?.at.x).toBeCloseTo(
      ARM_PIXELS,
      9,
    );
    expect(far.find((handle) => handle.id === "x")?.at.x).toBeCloseTo(
      ARM_PIXELS * 4,
      9,
    );
  });

  it("gives rotate one handle, at the centre", () => {
    expect(handlesFor("rotate", AT_ORIGIN, 1)).toEqual([
      { id: "ring", at: { x: 0, y: 0 } },
    ]);
  });
});

describe("handleAt", () => {
  it("finds each arm tip and the centre", () => {
    expect(handleAt("translate", AT_ORIGIN, 1, { x: ARM_PIXELS, y: 0 })).toBe(
      "x",
    );
    expect(handleAt("translate", AT_ORIGIN, 1, { x: 0, y: ARM_PIXELS })).toBe(
      "y",
    );
    expect(handleAt("translate", AT_ORIGIN, 1, { x: 0, y: 0 })).toBe("xy");
  });

  it("grabs an arm anywhere along it, not only at the tip", () => {
    // What both documentation surfaces promise: drag an arm.
    expect(
      handleAt("translate", AT_ORIGIN, 1, { x: ARM_PIXELS / 2, y: 0 }),
    ).toBe("x");
  });

  it("finds nothing in the space beside the arms", () => {
    expect(
      handleAt("translate", AT_ORIGIN, 1, {
        x: ARM_PIXELS / 2,
        y: ARM_PIXELS / 2,
      }),
    ).toBeNull();
    expect(
      handleAt("translate", AT_ORIGIN, 1, { x: ARM_PIXELS * 2, y: 0 }),
    ).toBeNull();
  });

  it("gives the pivot to the both-axes handle, and the rest to the arms", () => {
    // Translate's arms begin at the pivot, where its free-move handle sits, so
    // the two overlap by construction and the order they are tested in is what
    // decides. A press on the pivot means "move freely".
    for (const perPixel of [1 / 1000, 1, 1000]) {
      expect(handleAt("translate", AT_ORIGIN, perPixel, { x: 0, y: 0 })).toBe(
        "xy",
      );
      expect(
        handleAt("translate", AT_ORIGIN, perPixel, {
          x: ARM_PIXELS * perPixel,
          y: 0,
        }),
      ).toBe("x");
    }
  });

  it("gives the scale gizmo's uniform handle a place of its own", () => {
    // Both arms begin at the pivot and their whole length is grabbable, so a
    // uniform handle sitting there would take every press meant for an arm's
    // base. How far out it sits does not affect the factor a drag produces.
    const uniform = handlesFor("scale", AT_ORIGIN, 1).find(
      (handle) => handle.id === "xy",
    );
    const at = uniform?.at ?? { x: 0, y: 0 };

    expect(Math.hypot(at.x, at.y)).toBeGreaterThan(HANDLE_PIXELS * 3);
    expect(handleAt("scale", AT_ORIGIN, 1, at)).toBe("xy");
  });

  it("grabs the ring at its radius and not inside it", () => {
    expect(handleAt("rotate", AT_ORIGIN, 1, { x: RING_PIXELS, y: 0 })).toBe(
      "ring",
    );
    expect(handleAt("rotate", AT_ORIGIN, 1, { x: 0, y: 0 })).toBeNull();
  });

  it("allows the ring the tolerance it declares, and no more", () => {
    const inside = RING_PIXELS - GRAB_PIXELS + 0.5;
    const outside = RING_PIXELS + GRAB_PIXELS + 0.5;

    expect(handleAt("rotate", AT_ORIGIN, 1, { x: inside, y: 0 })).toBe("ring");
    expect(handleAt("rotate", AT_ORIGIN, 1, { x: outside, y: 0 })).toBeNull();
  });

  it("scales its reach with the zoom", () => {
    // Half a handle's width away in pixels is a hit at every zoom, and the
    // world distance that represents changes with it.
    // Beside the y arm rather than along it, so only the reach decides.
    const beside = { x: (GRAB_PIXELS / 2) * 8, y: ARM_PIXELS * 8 };

    expect(handleAt("translate", AT_ORIGIN, 8, beside)).toBe("y");
    expect(handleAt("translate", AT_ORIGIN, 1, beside)).toBeNull();
  });

  it("follows a turned gizmo's arms", () => {
    const turned: GizmoAnchor = {
      position: { x: 0, y: 0 },
      rotation: Math.PI / 2,
    };

    expect(handleAt("scale", turned, 1, { x: 0, y: ARM_PIXELS })).toBe("x");
    expect(handleAt("scale", turned, 1, { x: ARM_PIXELS, y: 0 })).toBeNull();
  });
});

/**
 * How far a press can stray from `spot` along `direction` and still grab
 * `want`, in screen pixels. Bisection rather than a stepped scan, so the
 * answer is the boundary itself rather than the step it fell inside.
 */
function grabRadius(
  mode: GizmoMode,
  want: HandleId,
  spot: EditorPoint,
  direction: EditorPoint,
  perScreenPixel: number,
): number {
  let held = 0;
  let past = 1000;
  for (let step = 0; step < 60; step += 1) {
    const middle = (held + past) / 2;
    const at = {
      x: spot.x + direction.x * middle * perScreenPixel,
      y: spot.y + direction.y * middle * perScreenPixel,
    };
    if (handleAt(mode, AT_ORIGIN, perScreenPixel, at) === want) held = middle;
    else past = middle;
  }
  return held;
}

/**
 * The grab measured in the pixels the developer's pointer moves in.
 *
 * `perScreenPixel` carries both the camera's zoom and the scale a fit draws
 * the canvas at, so one number covers a zoomed-in view and a canvas showing a
 * 1280-wide virtual viewport in a 760-wide pane. Zoom 0.05 to 20 is the range
 * the view state allows.
 */
describe("the grab, in screen pixels", () => {
  const CANVAS_SCALES = [1, 760 / 1280];
  /** A handle's dot is part of the handle, so its reach starts at the edge. */
  const AT_A_DOT = GRAB_PIXELS + HANDLE_PIXELS / 2;

  for (const zoom of [0.05, 1, 20]) {
    for (const canvasScale of CANVAS_SCALES) {
      const perScreenPixel = 1 / (zoom * canvasScale);
      const label = `zoom ${String(zoom)}, canvas ×${canvasScale.toFixed(3)}`;

      it(`reaches ${String(GRAB_PIXELS)} screen pixels beside an arm at ${label}`, () => {
        // Halfway along, where only the line is near.
        const middle = { x: (ARM_PIXELS / 2) * perScreenPixel, y: 0 };

        expect(
          grabRadius("translate", "x", middle, { x: 0, y: 1 }, perScreenPixel),
        ).toBeCloseTo(GRAB_PIXELS, 6);
      });

      it(`reaches ${String(AT_A_DOT)} screen pixels around an arm's dot at ${label}`, () => {
        const tip = { x: ARM_PIXELS * perScreenPixel, y: 0 };

        expect(
          grabRadius("translate", "x", tip, { x: 0, y: 1 }, perScreenPixel),
        ).toBeCloseTo(AT_A_DOT, 6);
        expect(
          grabRadius("translate", "x", tip, { x: 1, y: 0 }, perScreenPixel),
        ).toBeCloseTo(AT_A_DOT, 6);
      });

      it(`reaches ${String(GRAB_PIXELS)} screen pixels outside the ring at ${label}`, () => {
        // The ring carries no dot, so its reach is the tolerance alone.
        const on = { x: RING_PIXELS * perScreenPixel, y: 0 };

        expect(
          grabRadius("rotate", "ring", on, { x: 1, y: 0 }, perScreenPixel),
        ).toBeCloseTo(GRAB_PIXELS, 6);
      });
    }
  }

  it("gives the pivot its own dot, which the arms run underneath", () => {
    // Diagonally off the pivot, so both arms are nearer to it than the pivot
    // is. What the developer sees there is the centre handle, and pressing it
    // means moving freely.
    const onTheDot = { x: 3, y: 3 };
    const offTheDot = { x: 9, y: 3 };

    expect(handleAt("translate", AT_ORIGIN, 1, onTheDot)).toBe("xy");
    expect(handleAt("translate", AT_ORIGIN, 1, offTheDot)).toBe("x");
  });
});

describe("nearestHandle", () => {
  it("answers in screen pixels, whatever the world is scaled by", () => {
    // Twenty world units beside the y arm, and further than that from either
    // of the other two handles.
    const away = { x: 20, y: 32 };

    const near = nearestHandle("translate", AT_ORIGIN, 1, away);
    expect(near.id).toBe("y");
    expect(near.away).toBeCloseTo(20, 9);
    // The same world point, with the world drawn twice as small: the same
    // distance is half the pointer travel.
    const far = nearestHandle("translate", AT_ORIGIN, 2, away);
    expect(far.id).toBe("y");
    expect(far.away).toBeCloseTo(10, 9);
  });

  it("takes the nearer of two overlapping handles", () => {
    // Between the pivot and the scale gizmo's uniform handle, a touch nearer
    // the uniform one. Both are in reach; the nearer wins rather than
    // whichever is tested first.
    const uniform = handlesFor("scale", AT_ORIGIN, 1).find(
      (handle) => handle.id === "xy",
    );
    if (!uniform) throw new Error("the scale gizmo has no uniform handle");
    const closer = {
      x: uniform.at.x - GRAB_PIXELS / 2,
      y: uniform.at.y - GRAB_PIXELS / 2,
    };

    expect(handleAt("scale", AT_ORIGIN, 1, closer)).toBe("xy");
  });

  it("reaches every handle the gizmo draws", () => {
    // The overlay draws what `handlesFor` returns and the pointer grabs what
    // this finds. A handle added to one and not the other would be visible and
    // dead, or grabbable and invisible. Rotate is left out because its one
    // entry carries the ring's centre rather than a point on the ring.
    for (const mode of ["translate", "scale"] as const) {
      for (const handle of handlesFor(mode, AT_ORIGIN, 1)) {
        const found = nearestHandle(mode, AT_ORIGIN, 1, handle.at);
        expect([mode, found.id, found.away]).toEqual([mode, handle.id, 0]);
      }
    }
  });
});

describe("nearGizmo", () => {
  it("covers the miss around a handle and stops", () => {
    // Beside the middle of an arm, where the reach is the threshold itself
    // rather than the threshold plus a dot.
    const beside = (y: number) => ({ x: ARM_PIXELS / 2, y });

    expect(nearGizmo("translate", AT_ORIGIN, 1, beside(0))).toBe(true);
    expect(nearGizmo("translate", AT_ORIGIN, 1, beside(MISS_PIXELS))).toBe(
      true,
    );
    expect(nearGizmo("translate", AT_ORIGIN, 1, beside(MISS_PIXELS + 1))).toBe(
      false,
    );
  });

  it("reaches further than the grab does", () => {
    // The band between them is the missed grab: near enough to have been
    // aimed at the gizmo, not near enough to have hit it.
    const between = {
      x: ARM_PIXELS / 2,
      y: (GRAB_PIXELS + MISS_PIXELS) / 2,
    };

    expect(handleAt("translate", AT_ORIGIN, 1, between)).toBeNull();
    expect(nearGizmo("translate", AT_ORIGIN, 1, between)).toBe(true);
  });

  it("does not cover the empty quadrant behind the arms", () => {
    // Both arms reach out along the positive axes. Nothing is drawn the other
    // way, so a press there is a press on the level.
    expect(
      nearGizmo("translate", AT_ORIGIN, 1, {
        x: -ARM_PIXELS,
        y: -ARM_PIXELS,
      }),
    ).toBe(false);
  });
});

describe("handleDirection", () => {
  it("points each scale handle along where it is drawn", () => {
    const turn = Math.PI / 2;

    const x = handleDirection("scale", turn, "x");
    expect(x?.x ?? 1).toBeCloseTo(0, 12);
    expect(x?.y ?? 0).toBeCloseTo(1, 12);

    const y = handleDirection("scale", turn, "y");
    expect(y?.x ?? 0).toBeCloseTo(-1, 12);
    expect(y?.y ?? 1).toBeCloseTo(0, 12);

    // The uniform handle sits out on the diagonal between the two.
    const uniform = handleDirection("scale", 0, "xy");
    expect(uniform?.x ?? 0).toBeCloseTo(Math.SQRT1_2, 12);
    expect(uniform?.y ?? 0).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it("gives move and turn no direction", () => {
    expect(handleDirection("translate", 0, "x")).toBeUndefined();
    expect(handleDirection("rotate", 0, "ring")).toBeUndefined();
  });
});
