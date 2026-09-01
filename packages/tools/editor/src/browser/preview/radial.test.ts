import { describe, expect, it } from "vitest";
import type { GizmoAnchor } from "../store/index.js";
import { TURN_BAND_PIXELS } from "./box.js";
import { ARM_PIXELS, UNIFORM_FRACTION } from "./gizmo.js";
import {
  RADIAL_BODY_PIXELS,
  RADIAL_EDGE_PIXELS,
  nearRadial,
  radialHandleAt,
} from "./radial.js";

const AT_ORIGIN: GizmoAnchor = { position: { x: 0, y: 0 }, rotation: 0 };

describe("radialHandleAt", () => {
  it("moves the placement from the centre", () => {
    // Both arms begin here and their whole length is grabbable, so without the
    // disc the one press the developer is most likely to make would scale.
    expect(radialHandleAt(AT_ORIGIN, 1, { x: 0, y: 0 })).toBe("body");
    expect(
      radialHandleAt(AT_ORIGIN, 1, { x: RADIAL_BODY_PIXELS - 1, y: 0 }),
    ).toBe("body");
  });

  it("scales from an arm and from the grip on the diagonal", () => {
    expect(radialHandleAt(AT_ORIGIN, 1, { x: ARM_PIXELS, y: 0 })).toBe("x");
    expect(radialHandleAt(AT_ORIGIN, 1, { x: 0, y: ARM_PIXELS })).toBe("y");
    const uniform = (ARM_PIXELS * UNIFORM_FRACTION) / Math.SQRT2;
    expect(radialHandleAt(AT_ORIGIN, 1, { x: uniform, y: uniform })).toBe("xy");
  });

  it("leaves the uniform grip its own reach past the disc", () => {
    // The disc stops short of where that grip starts taking presses, so
    // neither swallows the other.
    const along = (ARM_PIXELS * UNIFORM_FRACTION) / Math.SQRT2;
    const inside = RADIAL_BODY_PIXELS / Math.SQRT2;

    expect(radialHandleAt(AT_ORIGIN, 1, { x: inside, y: inside })).toBe("body");
    expect(radialHandleAt(AT_ORIGIN, 1, { x: along, y: along })).toBe("xy");
  });

  it("moves the placement from anywhere else inside the boundary", () => {
    // The same promise the box gizmo's interior makes, on a circle instead of
    // a rectangle. Well off both arms, so no grip claims it.
    const away = RADIAL_EDGE_PIXELS / 2;

    expect(radialHandleAt(AT_ORIGIN, 1, { x: -away, y: away })).toBe("body");
  });

  it("turns the placement in the band outside the boundary", () => {
    expect(
      radialHandleAt(AT_ORIGIN, 1, { x: 0, y: RADIAL_EDGE_PIXELS + 20 }),
    ).toBe("turn");
    expect(
      radialHandleAt(AT_ORIGIN, 1, {
        x: 0,
        y: RADIAL_EDGE_PIXELS + TURN_BAND_PIXELS + 1,
      }),
    ).toBeNull();
  });

  it("keeps every size on screen as the camera zooms", () => {
    // Two world units per screen pixel puts everything twice as far out in
    // world space and leaves it the same distance on screen. The point is off
    // both arms, so the region it lands in is what is being measured.
    const off = { x: -60, y: 60 };

    expect(radialHandleAt(AT_ORIGIN, 2, off)).toBe("body");
    expect(radialHandleAt(AT_ORIGIN, 1, off)).toBe("turn");
    expect(radialHandleAt(AT_ORIGIN, 2, { x: ARM_PIXELS * 2, y: 0 })).toBe("x");
  });

  it("follows the placement's own axes", () => {
    const turned: GizmoAnchor = {
      position: { x: 100, y: 50 },
      rotation: Math.PI / 2,
    };

    // A quarter turn puts the x arm where the y arm would otherwise be.
    expect(radialHandleAt(turned, 1, { x: 100, y: 50 + ARM_PIXELS })).toBe("x");
  });
});

describe("nearRadial", () => {
  it("reads a press just past the band as a missed grab", () => {
    expect(
      nearRadial(AT_ORIGIN, 1, {
        x: RADIAL_EDGE_PIXELS + TURN_BAND_PIXELS + 4,
        y: 0,
      }),
    ).toBe(true);
  });

  it("reads a press well outside it as a press on what is behind", () => {
    expect(nearRadial(AT_ORIGIN, 1, { x: RADIAL_EDGE_PIXELS * 4, y: 0 })).toBe(
      false,
    );
  });
});
