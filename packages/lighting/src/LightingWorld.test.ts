import {
  createMockEntity,
  createMockScene,
  Transform,
  Vec2,
  Vec2Buffer,
} from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { LightOccluder } from "./LightOccluder.js";
import { LightSource } from "./LightSource.js";
import { LightingWorld } from "./LightingWorld.js";
import { LightingWorldKey } from "./types.js";
import type { LightOccluderShape } from "./types.js";

function addLight(
  world: LightingWorld,
  options: {
    x?: number;
    y?: number;
    radius?: number;
    intensity?: number;
    color?: number;
    size?: number;
    cone?: number;
    rotation?: number;
    castShadows?: boolean;
  } = {},
): LightSource {
  const entity = world.scene.spawn("light");
  entity.add(
    new Transform({
      position: new Vec2(options.x ?? 0, options.y ?? 0),
      rotation: options.rotation ?? 0,
    }),
  );
  return entity.add(
    new LightSource({
      radius: options.radius ?? 100,
      intensity: options.intensity ?? 0.5,
      color: options.color ?? 0xffffff,
      size: options.size ?? 0,
      ...(options.cone === undefined ? {} : { cone: { angle: options.cone } }),
      castShadows: options.castShadows ?? true,
    }),
  );
}

/**
 * Share of a lamp at the origin that reaches a point, for a world with no
 * ambient light and a single source of full intensity.
 */
function coverageAt(
  world: LightingWorld,
  radius: number,
  x: number,
  y: number,
): number {
  return world.levelAt(x, y) / (1 - Math.hypot(x, y) / radius);
}

/**
 * How wide the partly lit band of a shadow is along a vertical line, in world
 * pixels, for a lamp at the origin. The scan stops at `x` above the axis,
 * short of the rim where the falloff leaves too little light to read a share
 * from.
 */
function borderWidth(world: LightingWorld, radius: number, x: number): number {
  const tolerance = 1e-9;
  let first = Number.NaN;
  let last = Number.NaN;
  for (let y = 0; y <= x; y += 0.5) {
    const coverage = coverageAt(world, radius, x, y);
    if (coverage <= tolerance || coverage >= 1 - tolerance) continue;
    if (Number.isNaN(first)) first = y;
    last = y;
  }
  return last - first;
}

function addOccluder(
  world: LightingWorld,
  shape: LightOccluderShape,
  options: {
    x?: number;
    y?: number;
    rotation?: number;
    scale?: number | { x: number; y: number };
  } = {},
): LightOccluder {
  const entity = world.scene.spawn("occluder");
  const scale = options.scale ?? 1;
  entity.add(
    new Transform({
      position: new Vec2(options.x ?? 0, options.y ?? 0),
      rotation: options.rotation ?? 0,
      scale: typeof scale === "number" ? new Vec2(scale, scale) : scale,
    }),
  );
  return entity.add(new LightOccluder({ shape }));
}

/** A world with no ambient light, so a level reads as one light's reach. */
function createWorld(): LightingWorld {
  const { scene } = createMockScene();
  const world = new LightingWorld(scene, { level: 0 });
  scene.registerScoped(LightingWorldKey, world);
  return world;
}

describe("LightingWorld", () => {
  it("copies parented light and occluder positions into retained outputs", () => {
    const { scene } = createMockScene();
    const world = new LightingWorld(scene, { level: 0 });
    scene.registerScoped(LightingWorldKey, world);
    const parent = scene.spawn("parent");
    const transform = parent.add(
      new Transform({ position: { x: 10, y: 20 }, scale: { x: 2, y: 3 } }),
    );
    const source = addLight(world, { x: 4, y: 5, intensity: 1 });
    parent.addChild("source", source.entity);
    const occluder = source.entity.add(
      new LightOccluder({ shape: { type: "box", width: 10, height: 10 } }),
    );
    const out = new Vec2Buffer();
    expect(source.getPositionInto(out)).toBe(out);
    expect([out.x, out.y]).toEqual([18, 35]);
    expect(occluder.getPositionInto(out)).toBe(out);
    expect([out.x, out.y]).toEqual([source.position.x, source.position.y]);
    transform.setPosition(30, 40);
    expect([out.x, out.y]).toEqual([18, 35]);
    expect(world.levelAt(38, 55)).toBe(1);
    expect(source.getPositionInto(out)).toEqual(new Vec2Buffer(38, 55));
  });

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

describe("LightingWorld occlusion", () => {
  it("drops a light's contribution behind a box and keeps it beside one", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1 });
    addOccluder(world, { type: "box", width: 20, height: 100 }, { x: 50 });

    expect(world.levelAt(100, 0)).toBe(0);
    expect(world.levelAt(0, 100)).toBeCloseTo(0.5);
  });

  it("blocks a circle's and a polygon's shadow alike", () => {
    const circleWorld = createWorld();
    addLight(circleWorld, { radius: 200, intensity: 1 });
    addOccluder(circleWorld, { type: "circle", radius: 20 }, { x: 50 });
    expect(circleWorld.levelAt(100, 0)).toBe(0);
    expect(circleWorld.levelAt(100, 60)).toBeGreaterThan(0);

    const polygonWorld = createWorld();
    addLight(polygonWorld, { radius: 200, intensity: 1 });
    addOccluder(
      polygonWorld,
      {
        type: "polygon",
        vertices: [
          { x: -10, y: -50 },
          { x: 10, y: -50 },
          { x: 10, y: 50 },
          { x: -10, y: 50 },
        ],
      },
      { x: 50 },
    );
    expect(polygonWorld.levelAt(100, 0)).toBe(0);
    expect(polygonWorld.levelAt(0, 100)).toBeGreaterThan(0);
  });

  it("turns an occluder with its entity", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1 });
    const bar = addOccluder(
      world,
      { type: "box", width: 80, height: 10 },
      { x: 60 },
    );

    expect(world.levelAt(60, 40)).toBeGreaterThan(0);
    bar.entity.get(Transform).setRotation(Math.PI / 2);
    expect(world.levelAt(60, 40)).toBe(0);
  });

  it("grows an occluder with its entity's scale", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1 });
    const wall = addOccluder(
      world,
      { type: "box", width: 10, height: 20 },
      { x: 50 },
    );

    expect(world.levelAt(100, 30)).toBeGreaterThan(0);
    wall.entity.get(Transform).setScale(2, 2);
    expect(world.levelAt(100, 30)).toBe(0);
  });

  it("leaves no gap where two occluders touch", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1 });
    addOccluder(
      world,
      { type: "box", width: 20, height: 50 },
      { x: 50, y: -25 },
    );
    addOccluder(
      world,
      { type: "box", width: 20, height: 50 },
      { x: 50, y: 25 },
    );

    expect(world.levelAt(100, 0)).toBe(0);
  });

  it("lights the room from a lamp standing inside an occluder", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1 });
    addOccluder(world, { type: "box", width: 40, height: 40 });

    expect(world.levelAt(100, 0)).toBeCloseTo(0.5);
  });

  it("darkens a point inside an occluder", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1 });
    addOccluder(world, { type: "box", width: 40, height: 40 }, { x: 60 });

    expect(world.levelAt(60, 0)).toBe(0);
  });

  it("reports a lamp's own position as lit", () => {
    const world = createWorld();
    addLight(world, { x: 12, y: 38, radius: 50, intensity: 1 });
    addOccluder(
      world,
      { type: "box", width: 60, height: 60 },
      { x: 50, rotation: Math.PI / 4 },
    );

    expect(world.levelAt(12, 38)).toBe(1);
    expect(world.levelAt(12.0001, 38)).toBeCloseTo(1);
  });

  it("lights the room from a lamp resting against a wall", () => {
    const world = createWorld();
    // The lamp sits exactly on the wall's face, where a grid-aligned level
    // leaves a wall-mounted light. The wall it rests on holds it.
    addLight(world, { x: 130, y: 0, radius: 120, intensity: 1 });
    addOccluder(world, { type: "box", width: 60, height: 200 }, { x: 100 });

    expect(world.levelAt(180, 0)).toBeCloseTo(1 - 50 / 120);
    expect(world.levelAt(20, 0)).toBeCloseTo(1 - 110 / 120);
  });

  it("stretches an occluder under a non-uniform scale", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1 });
    const wall = addOccluder(
      world,
      { type: "circle", radius: 10 },
      { x: 50, scale: { x: 1, y: 4 } },
    );

    expect(world.levelAt(100, 120)).toBeGreaterThan(0);
    wall.entity.get(Transform).setScale(1, 8);
    expect(world.levelAt(100, 120)).toBe(0);
  });

  it("mirrors an occluder under a negative scale", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1 });
    addOccluder(
      world,
      {
        type: "polygon",
        vertices: [
          { x: 20, y: -60 },
          { x: 40, y: -60 },
          { x: 40, y: 60 },
          { x: 20, y: 60 },
        ],
      },
      { scale: -1 },
    );

    // The authored slab sits to the right of the entity; a scale of -1 puts
    // it to the left, where it blocks the light instead.
    expect(world.levelAt(100, 0)).toBeGreaterThan(0);
    expect(world.levelAt(-100, 0)).toBe(0);
  });

  it("lets a light ignore occluders", () => {
    const world = createWorld();
    const light = addLight(world, {
      radius: 200,
      intensity: 1,
      castShadows: false,
    });
    addOccluder(world, { type: "box", width: 20, height: 100 }, { x: 50 });

    expect(world.levelAt(100, 0)).toBeCloseTo(0.5);
    light.castShadows = true;
    expect(world.levelAt(100, 0)).toBe(0);
  });
});

describe("LightingWorld lamp size", () => {
  it("dims the border by the share of the lamp a blocker hides", () => {
    const world = createWorld();
    const light = addLight(world, { radius: 300, intensity: 1, size: 40 });
    addOccluder(world, { type: "box", width: 20, height: 40 }, { x: 60 });

    // (150, 60) sits on the line from the lamp's centre past the blocker's
    // corner, which leaves exactly half the lamp visible.
    expect(coverageAt(world, 300, 150, 60)).toBeCloseTo(0.5);
    // Deep behind the blocker and well clear of it, nothing changes.
    expect(world.levelAt(150, 0)).toBe(0);
    expect(coverageAt(world, 300, 150, 160)).toBeCloseTo(1);

    // A point lamp switches the same point off outright.
    light.size = 0;
    expect(world.levelAt(150, 60)).toBe(0);
  });

  it("widens the border with the distance from the blocker", () => {
    const world = createWorld();
    addLight(world, { radius: 600, intensity: 1, size: 40 });
    addOccluder(world, { type: "box", width: 20, height: 40 }, { x: 60 });

    expect(borderWidth(world, 600, 400)).toBeGreaterThan(
      borderWidth(world, 600, 150) * 2,
    );
  });

  it("softens a circle's border too", () => {
    const world = createWorld();
    addLight(world, { radius: 300, intensity: 1, size: 40 });
    addOccluder(world, { type: "circle", radius: 20 }, { x: 60 });

    expect(borderWidth(world, 300, 200)).toBeGreaterThan(20);
    expect(world.levelAt(150, 0)).toBe(0);
  });

  it("takes one stretch of a lamp away once when two occluders hide it", () => {
    const single = createWorld();
    addLight(single, { radius: 300, intensity: 1, size: 40 });
    addOccluder(single, { type: "box", width: 20, height: 40 }, { x: 60 });

    const doubled = createWorld();
    addLight(doubled, { radius: 300, intensity: 1, size: 40 });
    addOccluder(doubled, { type: "box", width: 20, height: 40 }, { x: 60 });
    addOccluder(doubled, { type: "box", width: 20, height: 40 }, { x: 60 });

    for (const y of [40, 55, 60, 65, 80]) {
      expect(doubled.levelAt(150, y)).toBe(single.levelAt(150, y));
    }
  });

  it("keeps a point inside an occluder dark for a wide lamp", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1, size: 60 });
    addOccluder(world, { type: "box", width: 40, height: 40 }, { x: 60 });

    expect(world.levelAt(60, 0)).toBe(0);
  });

  it("lights the room from a wide lamp standing inside an occluder", () => {
    const world = createWorld();
    addLight(world, { radius: 200, intensity: 1, size: 60 });
    addOccluder(world, { type: "box", width: 40, height: 40 });

    expect(world.levelAt(100, 0)).toBeCloseTo(0.5);
  });
});

describe("LightingWorld cone", () => {
  it("reaches only the directions its entity faces", () => {
    const world = createWorld();
    const light = addLight(world, {
      radius: 200,
      intensity: 1,
      cone: Math.PI / 2,
    });

    expect(world.levelAt(100, 0)).toBeCloseTo(0.5);
    expect(world.levelAt(100, 60)).toBeCloseTo(1 - Math.hypot(100, 60) / 200);
    expect(world.levelAt(100, 140)).toBe(0);
    expect(world.levelAt(-100, 0)).toBe(0);

    light.entity.get(Transform).setRotation(Math.PI);
    expect(world.levelAt(100, 0)).toBe(0);
    expect(world.levelAt(-100, 0)).toBeCloseTo(0.5);
  });

  it("widens to the whole turn when the cone is opened up", () => {
    const world = createWorld();
    const light = addLight(world, {
      radius: 200,
      intensity: 1,
      cone: Math.PI / 2,
    });

    expect(world.levelAt(-100, 0)).toBe(0);
    light.coneAngle = Math.PI * 2;
    expect(world.levelAt(-100, 0)).toBeCloseTo(0.5);
  });

  it("reports a lamp's own position as lit whichever way it faces", () => {
    const world = createWorld();
    addLight(world, {
      x: 12,
      y: 38,
      radius: 50,
      intensity: 1,
      cone: Math.PI / 6,
      rotation: Math.PI,
    });

    expect(world.levelAt(12, 38)).toBe(1);
  });
});

describe("LightingWorld.levelGridInto", () => {
  it("fills every cell with what levelAt reports for its centre", () => {
    const { scene } = createMockScene();
    const world = new LightingWorld(scene, { level: 0.1 });
    scene.registerScoped(LightingWorldKey, world);
    addLight(world, { x: 40, y: 30, radius: 120, intensity: 0.9 });
    addLight(world, { x: 160, y: 90, radius: 90, intensity: 0.7 });
    addOccluder(
      world,
      { type: "box", width: 16, height: 80 },
      { x: 90, y: 40 },
    );
    addOccluder(world, { type: "circle", radius: 18 }, { x: 140, y: 30 });

    const grid = {
      x: -20,
      y: -10,
      cols: 24,
      rows: 16,
      cellWidth: 10,
      cellHeight: 8,
    };
    const out = new Float32Array(grid.cols * grid.rows);
    expect(world.levelGridInto(out, grid)).toBe(out);

    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const x = grid.x + (col + 0.5) * grid.cellWidth;
        const y = grid.y + (row + 0.5) * grid.cellHeight;
        expect(out[row * grid.cols + col]).toBe(
          Math.fround(world.levelAt(x, y)),
        );
      }
    }
  });

  it("matches levelAt for wide lamps and cones alike", () => {
    const { scene } = createMockScene();
    const world = new LightingWorld(scene, { level: 0.05 });
    scene.registerScoped(LightingWorldKey, world);
    addLight(world, {
      x: 40,
      y: 30,
      radius: 140,
      intensity: 0.9,
      size: 30,
    });
    addLight(world, {
      x: 170,
      y: 90,
      radius: 120,
      intensity: 0.8,
      size: 18,
      cone: Math.PI / 2,
      rotation: Math.PI,
    });
    addOccluder(
      world,
      { type: "box", width: 16, height: 80 },
      { x: 90, y: 40 },
    );
    addOccluder(world, { type: "circle", radius: 18 }, { x: 140, y: 30 });

    const grid = {
      x: -20,
      y: -10,
      cols: 24,
      rows: 16,
      cellWidth: 10,
      cellHeight: 8,
    };
    const out = new Float32Array(grid.cols * grid.rows);
    world.levelGridInto(out, grid);

    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const x = grid.x + (col + 0.5) * grid.cellWidth;
        const y = grid.y + (row + 0.5) * grid.cellHeight;
        expect(out[row * grid.cols + col]).toBe(
          Math.fround(world.levelAt(x, y)),
        );
      }
    }
  });

  it("rejects a grid it cannot fill", () => {
    const world = createWorld();
    const grid = {
      x: 0,
      y: 0,
      cols: 4,
      rows: 4,
      cellWidth: 10,
      cellHeight: 10,
    };

    expect(() => world.levelGridInto(new Float32Array(15), grid)).toThrow(
      /out must hold cols \* rows samples \(16\), got 15/,
    );
    expect(() =>
      world.levelGridInto(new Float32Array(16), { ...grid, cols: 4.5 }),
    ).toThrow(/cols must be a positive integer/);
    expect(() =>
      world.levelGridInto(new Float32Array(16), { ...grid, cellHeight: 0 }),
    ).toThrow(/cellHeight must be a finite number greater than 0/);
    expect(() =>
      world.levelGridInto(new Float32Array(16), { ...grid, x: NaN }),
    ).toThrow(/x must be a finite number/);
  });
});
