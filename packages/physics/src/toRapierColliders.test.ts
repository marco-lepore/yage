import { describe, it, expect, vi } from "vitest";
import { toRapierColliders } from "./toRapierColliders.js";
import type { RapierModule, RapierColliderDesc } from "./toRapierColliders.js";
import type { ColliderConfig } from "./types.js";

function mockRapier(): RapierModule {
  const makeDesc = (): RapierColliderDesc => ({
    setTranslation: vi.fn().mockReturnThis(),
    setRotation: vi.fn().mockReturnThis(),
    setContactSkin: vi.fn().mockReturnThis(),
  });

  return {
    ColliderDesc: {
      cuboid: vi.fn(makeDesc),
      roundCuboid: vi.fn(makeDesc),
      ball: vi.fn(makeDesc),
      capsule: vi.fn(makeDesc),
      convexHull: vi.fn(makeDesc),
      polyline: vi.fn(makeDesc),
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

  it("converts a rounded box using inner half-extents", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      {
        shape: { type: "box", width: 12, height: 44, borderRadius: 2 },
      },
    ];

    toRapierColliders(rapier, configs, PPM);

    expect(rapier.ColliderDesc.roundCuboid).toHaveBeenCalledWith(
      0.08,
      0.4,
      0.04,
    );
    expect(rapier.ColliderDesc.cuboid).not.toHaveBeenCalled();
  });

  it("converts contact skin to meters", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      {
        shape: { type: "box", width: 10, height: 10 },
        contactSkin: 2,
      },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result[0]!.setContactSkin).toHaveBeenCalledWith(0.04);
  });

  it("converts vertical capsule (no rotation by default)", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      { shape: { type: "capsule", halfHeight: 50, radius: 25 } },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result).toHaveLength(1);
    expect(rapier.ColliderDesc.capsule).toHaveBeenCalledWith(1, 0.5); // 50/50, 25/50
    expect(result[0]!.setRotation).not.toHaveBeenCalled();
  });

  it("rotates capsule when axis is 'x'", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      { shape: { type: "capsule", halfHeight: 50, radius: 25, axis: "x" } },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result).toHaveLength(1);
    expect(rapier.ColliderDesc.capsule).toHaveBeenCalledWith(1, 0.5);
    expect(result[0]!.setRotation).toHaveBeenCalledWith(Math.PI / 2);
  });

  it("applies config rotation", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      {
        shape: { type: "box", width: 100, height: 50 },
        rotation: Math.PI / 6,
      },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result[0]!.setRotation).toHaveBeenCalledWith(Math.PI / 6);
  });

  it("adds config rotation on top of the horizontal-capsule axis rotation", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      {
        shape: { type: "capsule", halfHeight: 50, radius: 25, axis: "x" },
        rotation: Math.PI / 6,
      },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result[0]!.setRotation).toHaveBeenCalledWith(
      Math.PI / 2 + Math.PI / 6,
    );
  });

  it("does not call setRotation for rotation 0", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      { shape: { type: "box", width: 100, height: 50 }, rotation: 0 },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result[0]!.setRotation).not.toHaveBeenCalled();
  });

  it("converts polygon config to convex hull with offset", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      {
        shape: {
          type: "polygon",
          vertices: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
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

  it("converts polyline config without convex-hull processing", () => {
    const rapier = mockRapier();
    const configs: ColliderConfig[] = [
      {
        shape: {
          type: "polyline",
          vertices: [
            { x: 0, y: 0 },
            { x: 64, y: 0 },
            { x: 64, y: 16 },
            { x: 16, y: 16 },
            { x: 16, y: 48 },
          ],
        },
        offset: { x: 10, y: 20 },
      },
    ];

    const result = toRapierColliders(rapier, configs, PPM);

    expect(result).toHaveLength(1);
    expect(rapier.ColliderDesc.polyline).toHaveBeenCalledWith(
      new Float32Array([
        0,
        0,
        64 / 50,
        0,
        64 / 50,
        16 / 50,
        16 / 50,
        16 / 50,
        16 / 50,
        48 / 50,
      ]),
    );
    expect(rapier.ColliderDesc.convexHull).not.toHaveBeenCalled();
    expect(result[0]!.setTranslation).toHaveBeenCalledWith(10 / 50, 20 / 50);
  });

  it("throws on failed convex hull", () => {
    const rapier = mockRapier();
    (
      rapier.ColliderDesc.convexHull as ReturnType<typeof vi.fn>
    ).mockReturnValue(null);

    const configs: ColliderConfig[] = [
      {
        shape: {
          type: "polygon",
          vertices: [{ x: 0, y: 0 }],
        },
      },
    ];

    expect(() => toRapierColliders(rapier, configs, PPM)).toThrow(
      "Failed to create convex hull",
    );
  });

  it("rejects invalid box border radii and accepts zero or undefined", () => {
    const rapier = mockRapier();
    const convert = (borderRadius?: number) =>
      toRapierColliders(
        rapier,
        [
          {
            shape: {
              type: "box",
              width: 20,
              height: 10,
              ...(borderRadius === undefined ? {} : { borderRadius }),
            },
          },
        ],
        PPM,
      );

    expect(() => convert(5)).toThrow("Box border radius");
    expect(() => convert(-1)).toThrow("Box border radius");
    // A non-finite radius reaches roundCuboid and traps the wasm module,
    // which leaves the whole world unusable — reject it here instead.
    expect(() => convert(NaN)).toThrow("Box border radius");
    expect(() => convert(Infinity)).toThrow("Box border radius");
    expect(() => convert(0)).not.toThrow();
    expect(() => convert()).not.toThrow();
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
