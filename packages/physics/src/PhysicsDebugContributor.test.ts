import { describe, it, expect, vi } from "vitest";
import type { DebugGraphics, WorldDebugApi } from "@yagejs/debug/api";
import { PhysicsDebugContributor } from "./PhysicsDebugContributor.js";
import type { PhysicsWorldManager } from "./PhysicsWorldManager.js";

const PPM = 50;

/** Rapier ShapeType values the contributor switches on. */
const CUBOID = 1;
const ROUND_CUBOID = 10;

function createMockGraphics(): DebugGraphics {
  const g: DebugGraphics = {
    position: { x: 0, y: 0 },
    rotation: 0,
    visible: true,
    clear: vi.fn(() => g),
    rect: vi.fn(() => g),
    roundRect: vi.fn(() => g),
    circle: vi.fn(() => g),
    moveTo: vi.fn(() => g),
    lineTo: vi.fn(() => g),
    stroke: vi.fn(() => g),
    fill: vi.fn(() => g),
  };
  return g;
}

interface ShapeStub {
  shapeType: number;
  /** Half-extents in meters. For a round cuboid these are the inner box. */
  halfExtents: { x: number; y: number };
  roundRadius?: number;
}

/**
 * Contributor driven over a single static collider, returning the graphics
 * node it drew into.
 */
function drawCollider(shape: ShapeStub): DebugGraphics {
  const collider = {
    isSensor: () => false,
    parent: () => ({ isDynamic: () => false, isKinematic: () => false }),
    translation: () => ({ x: 0, y: 0 }),
    rotation: () => 0,
    shapeType: () => shape.shapeType,
    halfExtents: () => shape.halfExtents,
    roundRadius: () => shape.roundRadius ?? 0,
  };
  const world = {
    pixelsPerMeter: PPM,
    colliderMap: new Map([[1, {}]]),
    getCollider: () => collider,
    _colliderComponents: new Map(),
  };
  const manager = {
    getAllContexts: () => [["scene", { world }]],
  } as unknown as PhysicsWorldManager;

  const g = createMockGraphics();
  const api: WorldDebugApi = {
    acquireGraphics: () => g,
    isFlagEnabled: () => true,
    cameraZoom: 1,
  };
  new PhysicsDebugContributor(manager).drawWorld(api);
  return g;
}

describe("PhysicsDebugContributor", () => {
  it("draws a plain box as a square-cornered rect", () => {
    const g = drawCollider({
      shapeType: CUBOID,
      halfExtents: { x: 6 / PPM, y: 22 / PPM },
    });

    expect(g.rect).toHaveBeenCalledWith(-6, -22, 12, 44);
    expect(g.roundRect).not.toHaveBeenCalled();
  });

  it("draws a rounded box at its outer footprint with rounded corners", () => {
    // A 12×44 box with a 2px border radius: Rapier stores the inner half
    // extents (4, 20) and the radius separately.
    const g = drawCollider({
      shapeType: ROUND_CUBOID,
      halfExtents: { x: 4 / PPM, y: 20 / PPM },
      roundRadius: 2 / PPM,
    });

    // Outer footprint matches the plain 12×44 box, so the two are drawn at
    // the same size and told apart by the corner radius.
    expect(g.roundRect).toHaveBeenCalledWith(-6, -22, 12, 44, 2);
    expect(g.rect).not.toHaveBeenCalled();
  });
});
