import { Vec2 } from "@yage/core";
import { describe, it, expect, vi } from "vitest";
import { toRapierColliders } from "./toRapierColliders.js";
import type { RapierModule, RapierColliderDesc } from "./toRapierColliders.js";
import type { ColliderConfig } from "./types.js";

function mockRapier(): RapierModule {
  const makeDesc = (): RapierColliderDesc => ({
    setTranslation: vi.fn().mockReturnThis(),
  });

  return {
    ColliderDesc: {
      cuboid: vi.fn(makeDesc),
      ball: vi.fn(makeDesc),
      capsule: vi.fn(makeDesc),
      convexHull: vi.fn(makeDesc),
    },
  };
}

const PPM = 50;

describe("toRapierColliders", () => {
  it("converts box config to cuboid with offset", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      {
        shape: { type: "box", width: 100, height: 50 },
        offset: { x: 200, y: 300 },
      },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result).toHaveLength(1);
    expect(rapier.ColliderDesc.cuboid).toHaveBeenCalledWith(1, 0.5); // halfW=100/2/50, halfH=50/2/50
    expect(result[0]!.setTranslation).toHaveBeenCalledWith(4, 6); // 200/50, 300/50
  });

  it("converts circle config to ball", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      { shape: { type: "circle", radius: 25 } },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result).toHaveLength(1);
    expect(rapier.ColliderDesc.ball).toHaveBeenCalledWith(0.5); // 25/50
  });

  it("converts capsule config", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      { shape: { type: "capsule", halfHeight: 50, radius: 25 } },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result).toHaveLength(1);
    expect(rapier.ColliderDesc.capsule).toHaveBeenCalledWith(1, 0.5); // 50/50, 25/50
  });

  it("converts polygon config to convex hull with offset", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      {
        shape: {
          type: "polygon",
          vertices: [
            new Vec2(0, 0),
            new Vec2(50, 0),
            new Vec2(50, 50),
          ],
        },
        offset: { x: 100, y: 200 },
      },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result).toHaveLength(1);
    expect(rapier.ColliderDesc.convexHull).toHaveBeenCalledWith(
      new Float32Array([0, 0, 1, 0, 1, 1]),
    );
    expect(result[0]!.setTranslation).toHaveBeenCalledWith(2, 4);
  });

  it("throws on failed convex hull", () => {
    const rapier = mockRapier();
    (rapier.ColliderDesc.convexHull as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const configs: ColliderConfig[] = [
      {
        shape: {
          type: "polygon",
          vertices: [new Vec2(0, 0)],
        },
      },
    ];

    expect(() => toRapierColliders(rapier, configs, PPM)).toThrow(
      "Failed to create convex hull",
    );
  });

  it("does not call setTranslation when no offset", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      { shape: { type: "box", width: 64, height: 32 } },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result).toHaveLength(1);
    expect(result[0]!.setTranslation).not.toHaveBeenCalled();
  });

  it("returns empty array for empty input", () => {
    const rapier = mockRapier();
    expect(toRapierColliders(rapier, [], PPM)).toEqual([]);
  });
});
