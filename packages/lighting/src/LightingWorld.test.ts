import {
  createMockEntity,
  createMockScene,
  Transform,
  Vec2,
} from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { LightOccluder } from "./LightOccluder.js";
import { LightSource } from "./LightSource.js";
import { LightingWorld } from "./LightingWorld.js";
import { LightingWorldKey } from "./types.js";

function addLight(
  world: LightingWorld,
  options: {
    x?: number;
    y?: number;
    radius?: number;
    intensity?: number;
    color?: number;
  } = {},
): LightSource {
  const entity = world.scene.spawn("light");
  entity.add(
    new Transform({
      position: new Vec2(options.x ?? 0, options.y ?? 0),
    }),
  );
  return entity.add(
    new LightSource({
      radius: options.radius ?? 100,
      intensity: options.intensity ?? 0.5,
      color: options.color ?? 0xffffff,
    }),
  );
}

describe("LightingWorld", () => {
  it("adds ambient and radial contributions with linear falloff", () => {
    const { scene } = createMockScene();
    const world = new LightingWorld(scene, { level: 0.1 });
    scene.registerScoped(LightingWorldKey, world);
    addLight(world);

    expect(world.levelAt(0, 0)).toBeCloseTo(0.6);
    expect(world.levelAt(50, 0)).toBeCloseTo(0.35);
    expect(world.levelAt(100, 0)).toBeCloseTo(0.1);
  });

  it("adds overlapping lights and clamps the result to one", () => {
    const { scene } = createMockScene();
    const world = new LightingWorld(scene, { level: 0.2 });
    scene.registerScoped(LightingWorldKey, world);
    addLight(world, { intensity: 0.7 });
    addLight(world, { intensity: 0.6 });

    expect(world.levelAt(0, 0)).toBe(1);
  });

  it("tracks component and entity activeness", () => {
    const { scene } = createMockScene();
    const world = new LightingWorld(scene, { level: 0 });
    scene.registerScoped(LightingWorldKey, world);
    const light = addLight(world, { intensity: 1 });

    expect(world.sources.has(light)).toBe(true);
    light.enabled = false;
    expect(world.sources.has(light)).toBe(false);
    expect(world.levelAt(0, 0)).toBe(0);

    light.enabled = true;
    light.entity.setActive(false);
    expect(world.sources.has(light)).toBe(false);
    light.entity.setActive(true);
    expect(world.sources.has(light)).toBe(true);
  });

  it("updates mutable source data and ambient light", () => {
    const { scene } = createMockScene();
    const world = new LightingWorld(scene, { level: 0 });
    scene.registerScoped(LightingWorldKey, world);
    const light = addLight(world, { intensity: 0.25 });

    light.intensity = 0.75;
    light.radius = 200;
    light.color = 0xff0000;
    world.setAmbient(0.1, 0x102030);

    expect(world.levelAt(0, 0)).toBeCloseTo(0.85);
    expect(world.ambientColor).toBe(0x102030);
  });

  it("registers occluders while they are effectively enabled", () => {
    const { scene } = createMockScene();
    const world = new LightingWorld(scene);
    scene.registerScoped(LightingWorldKey, world);
    const entity = scene.spawn("wall");
    entity.add(new Transform());
    const occluder = entity.add(
      new LightOccluder({
        shape: { type: "box", width: 40, height: 10 },
      }),
    );

    expect(world.occluders.has(occluder)).toBe(true);
    entity.setActive(false);
    expect(world.occluders.has(occluder)).toBe(false);
  });

  it("keeps source and occluder configuration available at runtime", () => {
    const { entity, scene } = createMockEntity();
    const world = new LightingWorld(scene);
    scene.registerScoped(LightingWorldKey, world);
    entity.add(new Transform());
    const light = entity.add(
      new LightSource({
        radius: 80,
        intensity: 0.4,
        color: 0xff8800,
        enabled: false,
      }),
    );
    const occluder = entity.add(
      new LightOccluder({
        shape: {
          type: "polygon",
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
        },
      }),
    );

    expect(light).toMatchObject({
      radius: 80,
      intensity: 0.4,
      color: 0xff8800,
      enabled: false,
    });
    expect(occluder.enabled).toBe(true);
    expect(occluder.shape).toEqual({
      type: "polygon",
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
    });
  });

  it("rejects invalid public configuration", () => {
    const { scene } = createMockScene();
    expect(() => new LightingWorld(scene, { level: -0.1 })).toThrow(RangeError);
    expect(() => new LightSource({ radius: 0 })).toThrow(RangeError);
    expect(
      () =>
        new LightOccluder({
          shape: { type: "polygon", vertices: [{ x: 0, y: 0 }] },
        }),
    ).toThrow(RangeError);
  });
});
