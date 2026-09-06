import type {
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import { describe, expect, it } from "vitest";
import {
  dilated,
  nextScale,
  orbited,
  parentFrame,
  parentWorld,
  scaledTo,
  toLocal,
  toWorld,
  worldDeltaToLocal,
  WORLD_ORIGIN,
} from "./pose.js";

/** A small deterministic generator, so a failure names a seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomScale(next: () => number): number {
  const magnitude = 0.1 + next() * 4;
  return next() < 0.5 ? -magnitude : magnitude;
}

function randomTransform(next: () => number): LevelTransform {
  return {
    position: { x: next() * 200 - 100, y: next() * 200 - 100 },
    rotation: next() * Math.PI * 2 - Math.PI,
    scale: { x: randomScale(next), y: randomScale(next) },
  };
}

function expectClose(actual: LevelTransform, expected: LevelTransform): void {
  expectRelativeClose(actual.position.x, expected.position.x);
  expectRelativeClose(actual.position.y, expected.position.y);
  expectRelativeClose(actual.rotation, expected.rotation);
  expectRelativeClose(actual.scale.x, expected.scale.x);
  expectRelativeClose(actual.scale.y, expected.scale.y);
}

function expectRelativeClose(actual: number, expected: number): void {
  const tolerance = Math.max(1, Math.abs(expected)) * 1e-10;
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function placement(
  id: string,
  transform: LevelTransform,
  parent?: string,
): LevelPlacement {
  return {
    id,
    type: "game.crate",
    typeVersion: 1,
    active: true,
    transform,
    params: {},
    extensions: {},
    ...(parent === undefined ? {} : { parent }),
  };
}

function document(...placements: LevelPlacement[]): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    entities: placements,
    extensions: {},
  };
}

/** Parent at (10, 20), a quarter turn, scaled (2, 3). */
const QUARTER_TURN: LevelTransform = {
  position: { x: 10, y: 20 },
  rotation: Math.PI / 2,
  scale: { x: 2, y: 3 },
};

describe("toWorld and toLocal", () => {
  it("scale the local position, rotate it, then add the parent's position", () => {
    // Local (1, 1) scaled → (2, 3); a quarter turn → (-3, 2); plus (10, 20).
    // Rotations add and scales multiply, which is what `Transform` does.
    const world = toWorld(
      {
        position: { x: 1, y: 1 },
        rotation: 0.25,
        scale: { x: 0.5, y: -1 },
      },
      QUARTER_TURN,
    );
    expectClose(world, {
      position: { x: 7, y: 22 },
      rotation: Math.PI / 2 + 0.25,
      scale: { x: 1, y: -3 },
    });
  });

  it("round-trip through rotated, non-uniform, and negative-scale parents", () => {
    const next = random(0x5eed);
    for (let index = 0; index < 500; index += 1) {
      const parent = randomTransform(next);
      const local = randomTransform(next);
      expectClose(toLocal(toWorld(local, parent), parent, local), local);
    }
  });

  it("leave a transform alone against the origin", () => {
    const local = randomTransform(random(7));
    expect(toWorld(local, WORLD_ORIGIN)).toEqual(local);
    expect(toLocal(local, WORLD_ORIGIN, local)).toEqual(local);
  });
});

describe("parentWorld", () => {
  it("is the origin for a placement with no parent", () => {
    expect(parentWorld(document(), undefined)).toBe(WORLD_ORIGIN);
  });

  it("composes the chain root-first, whatever order the document lists it in", () => {
    const grandparent = QUARTER_TURN;
    const parent: LevelTransform = {
      position: { x: 1, y: 1 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    };
    // Child-first listing, so the walk cannot rely on document order.
    const doc = document(
      placement("child", WORLD_ORIGIN, "parent"),
      placement("parent", parent, "grandparent"),
      placement("grandparent", grandparent),
    );
    // The parent sits where its local (1, 1) lands under the grandparent, and
    // inherits the turn and the scale.
    expectClose(parentWorld(doc, "parent"), {
      position: { x: 7, y: 22 },
      rotation: Math.PI / 2,
      scale: { x: 2, y: 3 },
    });
  });

  it("stops where a chain loops rather than hanging", () => {
    const a = placement("a", WORLD_ORIGIN, "b");
    const b = placement("b", WORLD_ORIGIN, "a");
    expect(parentWorld(document(a, b), "a")).toEqual(WORLD_ORIGIN);
  });
});

describe("parentFrame", () => {
  it("is the identity object for an unparented placement", () => {
    const doc = document(placement("crate", WORLD_ORIGIN));
    expect(parentFrame(doc, "crate")).toBe(parentFrame(doc, "missing"));
  });

  it("carries the parent chain's rotation and scale, never its position", () => {
    const doc = document(
      placement("root", QUARTER_TURN),
      placement("child", WORLD_ORIGIN, "root"),
    );
    expect(parentFrame(doc, "child")).toEqual({
      rotation: Math.PI / 2,
      scale: { x: 2, y: 3 },
    });
  });
});

/** A placement out along the x axis, square to the world. */
const AT_100: LevelTransform = {
  position: { x: 100, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
};
const ORIGIN = { x: 0, y: 0 };

describe("orbited", () => {
  it("swings the placement round the pivot and turns it by the same angle", () => {
    const turned = orbited(AT_100, ORIGIN, Math.PI / 2);

    expect(turned.position.x).toBeCloseTo(0, 9);
    expect(turned.position.y).toBeCloseTo(100, 9);
    expect(turned.rotation).toBeCloseTo(Math.PI / 2, 9);
    expect(turned.scale).toEqual({ x: 1, y: 1 });
  });

  it("keeps an arrangement's shape", () => {
    // Two placements a hundred apart stay a hundred apart, whatever the pivot.
    const pivot = { x: 37, y: -12 };
    const a = orbited(AT_100, pivot, 0.7);
    const b = orbited({ ...AT_100, position: { x: 200, y: 0 } }, pivot, 0.7);

    expect(
      Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y),
    ).toBeCloseTo(100, 9);
  });

  it("leaves a placement sitting on the pivot where it is", () => {
    const turned = orbited(AT_100, { x: 100, y: 0 }, 1.1);

    expect(turned.position.x).toBeCloseTo(100, 9);
    expect(turned.position.y).toBeCloseTo(0, 9);
    expect(turned.rotation).toBeCloseTo(1.1, 9);
  });
});

describe("dilated", () => {
  it("stretches the distance from the pivot and the placement together", () => {
    const grown = dilated(AT_100, ORIGIN, { x: 1, y: 1 }, 0);

    expect(grown.position).toEqual({ x: 200, y: 0 });
    expect(grown.scale).toEqual({ x: 2, y: 2 });
    expect(grown.rotation).toBe(0);
  });

  it("measures along the axes it is given, not the world's", () => {
    // A quarter turn of the axis frame swaps which number acts on which world
    // direction, so a placement out along x moves by the y one.
    const grown = dilated(AT_100, ORIGIN, { x: 0, y: 2 }, Math.PI / 2);

    expect(grown.position.x).toBeCloseTo(300, 9);
    expect(grown.position.y).toBeCloseTo(0, 9);
  });

  it("changes nothing for a gesture that has not moved", () => {
    // A press and release must write nothing, whatever the placement holds.
    const tiny: LevelTransform = { ...AT_100, scale: { x: 1e-5, y: 1 } };

    expect(dilated(tiny, ORIGIN, { x: 0, y: 0 }, 0)).toBe(tiny);
  });

  it("takes a member of a selection through zero into a mirror", () => {
    // One shared number for everyone is what keeps an arrangement's shape, so
    // it multiplies: the sign follows the number rather than the placement.
    const mirrored: LevelTransform = { ...AT_100, scale: { x: -2, y: 2 } };

    expect(dilated(mirrored, ORIGIN, { x: -1.5, y: 0 }, 0).scale.x).toBeCloseTo(
      1,
      12,
    );
  });

  it("grows a member already at zero by the reach itself", () => {
    // The one value a factor cannot leave, so that axis adds. Three reference
    // lengths of travel is a scale of three, which is what an arm at zero
    // would have written.
    const flat: LevelTransform = { ...AT_100, scale: { x: 0, y: 1 } };

    expect(dilated(flat, ORIGIN, { x: 3, y: 0 }, 0).scale.x).toBe(3);
  });

  it("leaves a member at zero alone when the selection is shrinking", () => {
    // Otherwise asking a selection for less would bring a placement resting at
    // nothing into view, mirrored, at half size.
    const flat: LevelTransform = { ...AT_100, scale: { x: 0, y: 1 } };

    expect(dilated(flat, ORIGIN, { x: -0.5, y: 0 }, 0).scale.x).toBe(0);
  });

  it("keeps the shared factor for a member below one", () => {
    // Multiplication serves every scale but zero, and one factor for everyone
    // is what holds an arrangement's shape together.
    const small: LevelTransform = { ...AT_100, scale: { x: 0.3, y: 1 } };

    expect(dilated(small, ORIGIN, { x: 1, y: 0 }, 0).scale.x).toBeCloseTo(
      0.6,
      12,
    );
  });

  it("spreads a member at zero by the shared factor even as it grows it", () => {
    // The position term never changes: one factor moves every member of the
    // arrangement the same way, whatever its own scale does.
    const flat: LevelTransform = { ...AT_100, scale: { x: 0, y: 0 } };

    const grown = dilated(flat, ORIGIN, { x: 1, y: 0 }, 0);

    expect(grown.position.x).toBeCloseTo(200, 9);
    expect(grown.scale.x).toBe(1);
  });
});

describe("nextScale", () => {
  it("adds an extent reach to the scale, whatever the scale was", () => {
    // A box handle divides by the side's own offset at a scale of one, so the
    // fraction it produces is the change in scale itself.
    expect(nextScale(0, 0.5, "extent")).toBe(0.5);
    expect(nextScale(2, 0.5, "extent")).toBe(2.5);
    expect(nextScale(0.25, -1.25, "extent")).toBe(-1);
  });

  it("matches a multiplication for an arm at or above a scale of one", () => {
    // The rule this replaces was `base * (1 + reach)`, and no placement at or
    // above one may change behaviour.
    for (const base of [0, 0.5, 1, 2, -2]) {
      if (Math.abs(base) < 1) continue;
      for (const reach of [-1.5, -0.25, 0.25, 3]) {
        expect(nextScale(base, reach, "length")).toBeCloseTo(
          base * (1 + reach),
          12,
        );
      }
    }
  });

  it("gives an arm a whole unit per arm length below a scale of one", () => {
    // Where the multiplication has no traction: a fraction of nearly nothing
    // is nothing, so a small placement could never be dragged back up.
    expect(nextScale(0, 1, "length")).toBe(1);
    expect(nextScale(0, 0.5, "length")).toBe(0.5);
    expect(nextScale(0.5, 1, "length")).toBe(1.5);
    expect(nextScale(-0.5, 1, "length")).toBe(-1.5);
    // And it crosses zero into a mirror like any other value.
    expect(nextScale(0.5, -2, "length")).toBe(-1.5);
  });

  it("changes nothing when the gesture has not moved", () => {
    for (const kind of ["extent", "length"] as const) {
      expect(nextScale(0, 0, kind)).toBe(0);
      expect(nextScale(-3, 0, kind)).toBe(-3);
    }
  });
});

describe("scaledTo", () => {
  it("leaves the transform alone for a gesture that has not moved", () => {
    expect(scaledTo(AT_100, { x: 0, y: 0 }, "extent")).toBe(AT_100);
  });

  it("brings a placement at zero back and leaves the rest of the pose", () => {
    const flat: LevelTransform = { ...AT_100, scale: { x: 0, y: 0 } };
    const grown = scaledTo(flat, { x: 1, y: 0.5 }, "extent");

    expect(grown.scale).toEqual({ x: 1, y: 0.5 });
    expect(grown.position).toEqual(AT_100.position);
    expect(grown.rotation).toBe(AT_100.rotation);
  });
});

describe("a parent flattened to zero", () => {
  const flat: LevelTransform = {
    position: { x: 10, y: 20 },
    rotation: 0,
    scale: { x: 0, y: 4 },
  };

  it("keeps the local components toLocal cannot recover", () => {
    const kept: LevelTransform = {
      position: { x: 7, y: 3 },
      rotation: 0.5,
      scale: { x: 1.5, y: 2 },
    };
    const local = toLocal(toWorld(kept, flat), flat, kept);

    // The flattened axis draws every local value at the parent's origin, so
    // there is nothing to divide and the authored numbers stay.
    expect(local.position.x).toBe(7);
    expect(local.scale.x).toBe(1.5);
    // The axis that is not flattened is worked out as usual.
    expect(local.position.y).toBeCloseTo(3, 12);
    expect(local.scale.y).toBeCloseTo(2, 12);
    for (const value of [
      local.position.x,
      local.position.y,
      local.rotation,
      local.scale.x,
      local.scale.y,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("keeps both components when both axes are flattened", () => {
    const both: LevelTransform = { ...flat, scale: { x: 0, y: 0 } };
    const kept: LevelTransform = {
      position: { x: -2, y: 9 },
      rotation: 0,
      scale: { x: 3, y: 3 },
    };

    expect(toLocal(toWorld(kept, both), both, kept)).toEqual(kept);
  });

  it("covers no local distance with a world one", () => {
    const moved = worldDeltaToLocal(
      { rotation: 0, scale: flat.scale },
      { x: 50, y: 8 },
    );

    // Nothing on screen moves along a flattened axis, so a drag along it is a
    // move of nothing rather than an infinity in the file.
    expect(moved.x).toBe(0);
    expect(moved.y).toBe(2);
  });

  it("covers nothing on either axis when both are flattened", () => {
    expect(
      worldDeltaToLocal({ rotation: 0, scale: { x: 0, y: 0 } }, { x: 5, y: 5 }),
    ).toEqual({ x: 0, y: 0 });
  });
});
