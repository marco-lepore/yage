import { describe, it, expect } from "vitest";
import { Graphics, Matrix } from "pixi.js";
import type { Container } from "pixi.js";
import { computeRenderFacet } from "./renderFacet.js";

// This suite deliberately does NOT mock pixi.js. The per-component test mocks
// are identity passthroughs by design, so they cannot exercise the two things
// that actually make the facet correct: the world-space coordinate mapping
// (real `Matrix` math, including rotation) and `getLocalBounds()`'s "measure
// the root regardless of its visibility" semantics. Those are covered here
// against real Pixi.

/**
 * Minimal display-object stand-in whose `getLocalBounds()` returns a fixed
 * local box and whose `localTransform` is a real Pixi {@link Matrix}. Lets each
 * test pin an exact local box and transform, then assert the derived
 * world-space AABB — the part the mocks can't reach.
 */
function fakeDisplayObject(opts: {
  localBounds: { x: number; y: number; width: number; height: number };
  localTransform?: Matrix;
  visible?: boolean;
}): Container {
  const { localBounds, localTransform = new Matrix(), visible = true } = opts;
  return {
    visible,
    getLocalBounds: () => localBounds,
    updateLocalTransform: () => {},
    localTransform,
  } as unknown as Container;
}

describe("computeRenderFacet — coordinate-space mapping", () => {
  it("passes a local box straight through under an identity transform", () => {
    const facet = computeRenderFacet(
      fakeDisplayObject({ localBounds: { x: 4, y: 8, width: 16, height: 16 } }),
    );
    expect(facet.bounds).toEqual({ x: 4, y: 8, width: 16, height: 16 });
  });

  it("maps local bounds into world space under scale + translation", () => {
    // a=2, d=2, tx=100, ty=50 → apply(x,y) = (2x + 100, 2y + 50)
    const facet = computeRenderFacet(
      fakeDisplayObject({
        localBounds: { x: -10, y: -10, width: 20, height: 20 },
        localTransform: new Matrix(2, 0, 0, 2, 100, 50),
      }),
    );
    // corners (-10,-10)..(10,10) → (80,30)..(120,70)
    expect(facet.bounds).toEqual({ x: 80, y: 30, width: 40, height: 40 });
  });

  it("maps the bounds origin under a non-uniform scale", () => {
    const facet = computeRenderFacet(
      fakeDisplayObject({
        localBounds: { x: 0, y: 0, width: 10, height: 10 },
        localTransform: new Matrix(3, 0, 0, 0.5, 5, 7),
      }),
    );
    // (0,0)→(5,7), (10,10)→(35,12) → x5 y7 w30 h5
    expect(facet.bounds).toEqual({ x: 5, y: 7, width: 30, height: 5 });
  });

  it("derives the enclosing AABB under rotation (a single-corner map would be wrong)", () => {
    const c = Math.SQRT1_2; // cos 45° = sin 45°
    const facet = computeRenderFacet(
      fakeDisplayObject({
        localBounds: { x: -10, y: -10, width: 20, height: 20 },
        localTransform: new Matrix(c, c, -c, c, 0, 0), // rotate 45°
      }),
    );
    // A 20×20 box centred at the origin rotated 45° → AABB half-extent = 10√2.
    const half = Math.SQRT2 * 10;
    expect(facet.bounds).not.toBeNull();
    expect(facet.bounds!.x).toBeCloseTo(-half);
    expect(facet.bounds!.y).toBeCloseTo(-half);
    expect(facet.bounds!.width).toBeCloseTo(2 * half);
    expect(facet.bounds!.height).toBeCloseTo(2 * half);
  });

  it("reports geometry-truthful bounds for a hidden object (bounds survive visible:false)", () => {
    const facet = computeRenderFacet(
      fakeDisplayObject({
        localBounds: { x: 0, y: 0, width: 16, height: 16 },
        visible: false,
      }),
    );
    expect(facet.visible).toBe(false);
    // The whole point of #114: hidden ≠ null. The box is still reported.
    expect(facet.bounds).toEqual({ x: 0, y: 0, width: 16, height: 16 });
  });

  it("returns null only for genuinely empty geometry", () => {
    expect(
      computeRenderFacet(
        fakeDisplayObject({ localBounds: { x: 0, y: 0, width: 0, height: 0 } }),
      ).bounds,
    ).toBeNull();
  });

  it("returns null when either axis is collapsed (zero-area)", () => {
    // A line / zero-height shape has zero area and paints nothing fillable, so
    // it is null per the "zero-area object" contract — not just a zero-size point.
    expect(
      computeRenderFacet(
        fakeDisplayObject({ localBounds: { x: 0, y: 0, width: 40, height: 0 } }),
      ).bounds,
    ).toBeNull();
    expect(
      computeRenderFacet(
        fakeDisplayObject({ localBounds: { x: 0, y: 0, width: 0, height: 25 } }),
      ).bounds,
    ).toBeNull();
  });
});

describe("computeRenderFacet — real Pixi Graphics", () => {
  it("measures a real, sized Graphics in world space", () => {
    const gfx = new Graphics().rect(0, 0, 40, 25).fill(0xff0000);
    gfx.position.set(100, 50);

    const facet = computeRenderFacet(gfx as unknown as Container);
    expect(facet.bounds).toEqual({ x: 100, y: 50, width: 40, height: 25 });
    expect(facet.visible).toBe(true);
  });

  it("applies the object's own scale to world bounds", () => {
    const gfx = new Graphics().rect(0, 0, 10, 10).fill(0xffffff);
    gfx.position.set(100, 50);
    gfx.scale.set(2, 2);

    const facet = computeRenderFacet(gfx as unknown as Container);
    expect(facet.bounds).toEqual({ x: 100, y: 50, width: 20, height: 20 });
  });

  it("measures a HIDDEN real Graphics geometry-truthfully (the #114 regression)", () => {
    // Real proof that we bypass Pixi's visibility gate: getBounds() would report
    // an empty box here, collapsing to bounds:null. getLocalBounds() does not.
    const gfx = new Graphics().rect(0, 0, 40, 25).fill(0xff0000);
    gfx.visible = false;

    const facet = computeRenderFacet(gfx as unknown as Container);
    expect(facet.visible).toBe(false);
    expect(facet.bounds).toEqual({ x: 0, y: 0, width: 40, height: 25 });
  });

  it("returns null for a real empty Graphics", () => {
    const gfx = new Graphics();
    expect(computeRenderFacet(gfx as unknown as Container).bounds).toBeNull();
  });
});
