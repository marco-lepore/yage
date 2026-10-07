import { assert, describe, expect, it, vi } from "vitest";

vi.mock("@dimforge/rapier2d", async () => {
  const { default: rapier } = await import("@dimforge/rapier2d-compat");
  await rapier.init();
  return { default: rapier };
});

import { Transform } from "@yagejs/core";
import { ColliderComponent } from "./ColliderComponent.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import type { ColliderConfig, ColliderShape } from "./types.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import type { PhysicsTestContext } from "./test-helpers.js";

const DOWN = { x: 0, y: 1 };
const PLAYER = { type: "box", width: 16, height: 44, borderRadius: 3 } as const;
const ORIGIN = { x: 0, y: 277.999 };

function obstacle(
  ctx: PhysicsTestContext,
  name: string,
  x: number,
  y: number,
  config: ColliderConfig,
) {
  const entity = spawnEntityInScene(ctx.scene, name);
  entity.add(new Transform({ position: { x, y } }));
  entity.add(new RigidBodyComponent({ type: "static" }));
  const collider = entity.add(new ColliderComponent(config));
  return { entity, collider };
}

function floor(
  ctx: PhysicsTestContext,
  name = "floor",
  y = 316,
  extra: Partial<Pick<ColliderConfig, "layers" | "mask" | "sensor">> = {},
) {
  return obstacle(ctx, name, 0, y, {
    shape: { type: "box", width: 100, height: 32 },
    ...extra,
  });
}

describe("near-contact shape casts (real Rapier)", () => {
  it.each([25, 50, 100])(
    "finds floors and walls across the contact boundary at %s px/m",
    async (pixelsPerMeter) => {
      const ctx = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
        pixelsPerMeter,
      });
      const ground = floor(ctx);
      const wall = obstacle(ctx, "wall", 316, 0, {
        shape: { type: "box", width: 32, height: 100 },
      });
      const shapes: { shape: ColliderShape; halfHeight: number }[] = [
        { shape: PLAYER, halfHeight: 22 },
        { shape: { type: "box", width: 16, height: 44 }, halfHeight: 22 },
        { shape: { type: "box", width: 2, height: 2 }, halfHeight: 1 },
        { shape: { type: "circle", radius: 1 }, halfHeight: 1 },
        {
          shape: { type: "capsule", halfHeight: 19, radius: 3 },
          halfHeight: 22,
        },
        {
          shape: {
            type: "polygon",
            vertices: [
              { x: -8, y: -22 },
              { x: 8, y: -22 },
              { x: 8, y: 22 },
              { x: -8, y: 22 },
            ],
          },
          halfHeight: 22,
        },
      ];
      for (const { shape, halfHeight } of shapes) {
        for (const gap of [-0.004, -0.001, 0, 0.001, 0.004, 0.02]) {
          for (const horizontal of [false, true]) {
            const position = 300 - halfHeight - gap;
            const hit = ctx.physicsWorld.castShape(
              shape,
              horizontal ? { x: position, y: 0 } : { x: 0, y: position },
              horizontal ? { x: 1, y: 0 } : DOWN,
              3,
              { rotation: horizontal ? -Math.PI / 2 : 0 },
            );
            expect(
              hit?.entity.name,
              JSON.stringify({ shape, gap, horizontal }),
            ).toBe(horizontal ? wall.entity.name : ground.entity.name);
            assert(hit);
            expect(hit.distance).toBeGreaterThanOrEqual(0);
            expect(Math.abs(hit.distance - Math.max(0, gap))).toBeLessThan(
              0.005,
            );
            expect(horizontal ? hit.normal.x : hit.normal.y).toBeLessThan(
              -0.99,
            );
          }
        }
      }
      ctx.physicsWorld.destroy();
    },
  );

  it("returns the missed near surface instead of a farther hit", async () => {
    const ctx = await createPhysicsTestContext();
    const near = floor(ctx);
    floor(ctx, "farther", 366);
    expect(
      ctx.physicsWorld.castShape(PLAYER, ORIGIN, DOWN, 100)?.entity.name,
    ).toBe(near.entity.name);
    ctx.physicsWorld.destroy();
  });

  it("ignores an obstacle behind the original starting position", async () => {
    const ctx = await createPhysicsTestContext();
    const ground = floor(ctx);
    obstacle(ctx, "behind", 0, 255.95, {
      shape: { type: "box", width: 100, height: 0.01 },
    });
    const hit = ctx.physicsWorld.castShape(PLAYER, ORIGIN, DOWN, 3);
    expect(hit?.entity.name).toBe(ground.entity.name);
    assert(hit);
    expect(hit.distance).toBeLessThan(0.005);
    ctx.physicsWorld.destroy();
  });

  it("does not extend the requested distance", async () => {
    const ctx = await createPhysicsTestContext();
    floor(ctx);
    expect(ctx.physicsWorld.castShape(PLAYER, ORIGIN, DOWN, 0)).toBeNull();
    expect(
      ctx.physicsWorld.castShape(PLAYER, { x: 0, y: 277.98 }, DOWN, 0.01),
    ).toBeNull();
    ctx.physicsWorld.destroy();
  });

  it("keeps rotated contact normals and lets outward casts escape", async () => {
    const ctx = await createPhysicsTestContext();
    const angle = 0.37;
    const direction = { x: -Math.sin(angle), y: Math.cos(angle) };
    const ground = obstacle(
      ctx,
      "slope",
      direction.x * 316,
      direction.y * 316,
      {
        shape: { type: "box", width: 100, height: 32 },
        rotation: angle,
      },
    );
    for (const gap of [-0.001, 0.001]) {
      const origin = {
        x: direction.x * (278 - gap),
        y: direction.y * (278 - gap),
      };
      const hit = ctx.physicsWorld.castShape(PLAYER, origin, direction, 3, {
        rotation: angle,
      });
      expect(hit?.entity.name).toBe(ground.entity.name);
      assert(hit);
      expect(hit.normal.x).toBeCloseTo(-direction.x, 3);
      expect(hit.normal.y).toBeCloseTo(-direction.y, 3);
      expect(
        ctx.physicsWorld.castShape(
          PLAYER,
          origin,
          { x: -direction.x, y: -direction.y },
          3,
          {
            rotation: angle,
            stopAtPenetration: false,
          },
        ),
      ).toBeNull();
    }
    ctx.physicsWorld.destroy();
  });

  it("allows escape from shallow overlap while still stopping inward movement", async () => {
    const ctx = await createPhysicsTestContext();
    const ground = floor(ctx);
    const origin = { x: 0, y: 278.001 };
    expect(
      ctx.physicsWorld.castShape(PLAYER, origin, { x: 0, y: -1 }, 3, {
        stopAtPenetration: false,
      }),
    ).toBeNull();
    expect(
      ctx.physicsWorld.castShape(PLAYER, origin, DOWN, 3, {
        stopAtPenetration: false,
      })?.entity.name,
    ).toBe(ground.entity.name);
    ctx.physicsWorld.destroy();
  });

  it("keeps entity, sensor, layer and contact exclusions during recovery", async () => {
    const ctx = await createPhysicsTestContext();
    const ground = floor(ctx, "filtered", 316, { layers: 2, mask: 2 });
    expect(
      ctx.physicsWorld.castShape(PLAYER, ORIGIN, DOWN, 3, {
        excludeEntity: ground.entity,
      }),
    ).toBeNull();
    expect(
      ctx.physicsWorld.castShape(PLAYER, ORIGIN, DOWN, 3, {
        filterGroups: 0x00010001,
      }),
    ).toBeNull();
    ground.collider.setSensor(true);
    expect(ctx.physicsWorld.castShape(PLAYER, ORIGIN, DOWN, 3)).toBeNull();
    expect(
      ctx.physicsWorld.castShape(PLAYER, ORIGIN, DOWN, 3, { sensors: "only" })
        ?.entity.name,
    ).toBe(ground.entity.name);
    ground.collider.setSensor(false);
    const source = obstacle(ctx, "source", 0, 250, {
      shape: PLAYER,
      layers: 2,
      mask: 2,
    });
    ground.collider.setContactFilter(() => false);
    expect(
      ctx.physicsWorld.castShape(PLAYER, ORIGIN, DOWN, 3, {
        solidFor: source.collider,
      }),
    ).toBeNull();
    ctx.physicsWorld.destroy();
  });
});
