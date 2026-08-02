import { describe, it, expect } from "vitest";
import { createOneWayFilter } from "./oneWay.js";
import type { ColliderComponent } from "./ColliderComponent.js";
import type { ColliderConfig, ContactCandidate } from "./types.js";

/**
 * Pure geometry tests for the one-way rule: the filter only reads
 * `self.config`, the candidate's scalars, and the other collider's config
 * and drop-through flag, so both sides can be plain objects.
 */

function fakeSelf(
  config: ColliderConfig,
  landed?: Set<number>,
): ColliderComponent {
  return {
    config,
    _oneWayLanded: landed ?? new Set<number>(),
  } as unknown as ColliderComponent;
}

interface CandidateInit {
  selfX?: number;
  selfY?: number;
  selfRotation?: number;
  selfVelocityX?: number;
  selfVelocityY?: number;
  otherX?: number;
  otherY?: number;
  otherRotation?: number;
  otherVelocityX?: number;
  otherVelocityY?: number;
  dt?: number;
  otherShape?: ColliderConfig["shape"];
  otherDropping?: boolean;
}

function fakeCandidate(init: CandidateInit): ContactCandidate {
  return {
    other: {} as ContactCandidate["other"],
    otherCollider: {
      config: {
        shape: init.otherShape ?? { type: "box", width: 20, height: 20 },
      },
      isDroppingThrough: init.otherDropping ?? false,
      _colliderHandle: 7,
    } as unknown as ColliderComponent,
    dt: init.dt ?? 1 / 60,
    selfX: init.selfX ?? 0,
    selfY: init.selfY ?? 0,
    selfRotation: init.selfRotation ?? 0,
    selfVelocityX: init.selfVelocityX ?? 0,
    selfVelocityY: init.selfVelocityY ?? 0,
    otherX: init.otherX ?? 0,
    otherY: init.otherY ?? 0,
    otherRotation: init.otherRotation ?? 0,
    otherVelocityX: init.otherVelocityX ?? 0,
    otherVelocityY: init.otherVelocityY ?? 0,
  };
}

// Platform: 100×10 box at the origin. Solid face (default direction) at
// y = -5; a 20×20 rider resting on it has its center at y = -15.
const PLATFORM: ColliderConfig = {
  shape: { type: "box", width: 100, height: 10 },
  oneWay: {},
};

describe("createOneWayFilter", () => {
  it("is solid for a body resting on the solid side", () => {
    const filter = createOneWayFilter(fakeSelf(PLATFORM));
    expect(filter(fakeCandidate({ otherY: -15 }))).toBe(true);
  });

  it("is solid for a body slightly inside, within the margin", () => {
    const filter = createOneWayFilter(fakeSelf(PLATFORM));
    // 3px into the face; default margin is 4.
    expect(filter(fakeCandidate({ otherY: -12 }))).toBe(true);
  });

  it("passes a body past the margin or fully below", () => {
    const filter = createOneWayFilter(fakeSelf(PLATFORM));
    expect(filter(fakeCandidate({ otherY: -10 }))).toBe(false);
    expect(filter(fakeCandidate({ otherY: 15 }))).toBe(false);
  });

  it("catches a fast approacher that crossed the face since last step", () => {
    const filter = createOneWayFilter(fakeSelf(PLATFORM));
    // 5px past the resting depth, but it was above the face 1/60s ago.
    const falling = fakeCandidate({ otherY: -10, otherVelocityY: 2000 });
    expect(filter(falling)).toBe(true);
    // Same overlap moving upward: it came from below, so it passes.
    const rising = fakeCandidate({ otherY: -10, otherVelocityY: -2000 });
    expect(filter(rising)).toBe(false);
  });

  it("uses relative velocity, not the rider's alone", () => {
    const filter = createOneWayFilter(fakeSelf(PLATFORM));
    // Both sides moving down together: no approach, no extension back.
    const together = fakeCandidate({
      otherY: -10,
      otherVelocityY: 2000,
      selfVelocityY: 2000,
    });
    expect(filter(together)).toBe(false);
  });

  it("stays solid for a landed rider regardless of the position rule", () => {
    // Rider handle 7 has a live contact with the platform: even a position
    // well past the face (a deep first impact mid-resolution) stays solid.
    const filter = createOneWayFilter(fakeSelf(PLATFORM, new Set([7])));
    expect(filter(fakeCandidate({ otherY: 0 }))).toBe(true);
  });

  it("drop-through overrides a landed contact", () => {
    const filter = createOneWayFilter(fakeSelf(PLATFORM, new Set([7])));
    expect(filter(fakeCandidate({ otherY: -15, otherDropping: true }))).toBe(
      false,
    );
  });

  it("passes a body with an active drop-through window", () => {
    const filter = createOneWayFilter(fakeSelf(PLATFORM));
    expect(filter(fakeCandidate({ otherY: -15, otherDropping: true }))).toBe(
      false,
    );
  });

  it("rotates the direction with the platform body", () => {
    const filter = createOneWayFilter(fakeSelf(PLATFORM));
    // Platform body rotated 90°: the solid face now points along +x, at
    // x = +5 (the 10px thickness lies along world x).
    const side = { selfRotation: Math.PI / 2 };
    expect(filter(fakeCandidate({ ...side, otherX: 20 }))).toBe(true);
    expect(filter(fakeCandidate({ ...side, otherX: -20 }))).toBe(false);
    // A resting body from the old "above" is now on a passable side.
    expect(filter(fakeCandidate({ ...side, otherY: -20 }))).toBe(false);
  });

  it("honors a custom direction", () => {
    const filter = createOneWayFilter(
      fakeSelf({
        shape: { type: "box", width: 100, height: 10 },
        oneWay: { direction: { x: 0, y: 1 } },
      }),
    );
    // Solid face points down: bodies land from below.
    expect(filter(fakeCandidate({ otherY: 15 }))).toBe(true);
    expect(filter(fakeCandidate({ otherY: -15 }))).toBe(false);
  });

  it("honors a custom margin", () => {
    const filter = createOneWayFilter(
      fakeSelf({
        shape: { type: "box", width: 100, height: 10 },
        oneWay: { margin: 0 },
      }),
    );
    // 3px inside the face: solid under the default margin, passable at 0.
    expect(filter(fakeCandidate({ otherY: -12 }))).toBe(false);
  });

  it("measures the rider by its shape's reach toward the face", () => {
    const filter = createOneWayFilter(fakeSelf(PLATFORM));
    // Horizontal capsule: vertical reach is just its radius (4).
    const capsule = {
      otherShape: {
        type: "capsule",
        halfHeight: 6,
        radius: 4,
        axis: "x",
      } as const,
      // Rapier reports the axis:"x" turn as part of the collider rotation.
      otherRotation: Math.PI / 2,
    };
    expect(filter(fakeCandidate({ ...capsule, otherY: -9 }))).toBe(true);
    expect(filter(fakeCandidate({ ...capsule, otherY: -4 }))).toBe(false);

    // Asymmetric polygon: reach toward the face is the support distance of
    // the vertices, not a symmetric half-extent.
    const polygonShape: ColliderConfig["shape"] = {
      type: "polygon",
      vertices: [
        { x: 0, y: 20 },
        { x: 10, y: -10 },
        { x: -10, y: -10 },
      ],
    };
    const polygon = { otherShape: polygonShape };
    // Downward reach is 20: resting center is at y = -25.
    expect(filter(fakeCandidate({ ...polygon, otherY: -25 }))).toBe(true);
    expect(filter(fakeCandidate({ ...polygon, otherY: -18 }))).toBe(false);
  });

  it("stays solid when the oneWay config was removed", () => {
    const config: ColliderConfig = {
      shape: { type: "box", width: 100, height: 10 },
      oneWay: {},
    };
    const filter = createOneWayFilter(fakeSelf(config));
    delete config.oneWay;
    expect(filter(fakeCandidate({ otherY: 15 }))).toBe(true);
  });
});
