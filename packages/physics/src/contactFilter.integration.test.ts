import { describe, it, expect, vi } from "vitest";

// Real physics: which filter Rapier's hook consults first is its handle
// order, so the both-filters-run rule can only be checked against the real
// narrow phase. The `@dimforge/rapier2d` ESM build crashes when hooks are
// passed to `world.step` under vitest's transform, so the factory swaps in
// `@dimforge/rapier2d-compat` — the same library and version, instantiated
// at runtime.
vi.mock("@dimforge/rapier2d", async () => {
  const mod = (await import("@dimforge/rapier2d-compat")) as {
    default?: { init(): Promise<unknown> };
  };
  const RAPIER =
    mod.default ?? (mod as unknown as { init(): Promise<unknown> });
  await RAPIER.init();
  return { default: RAPIER };
});

import { Transform, Vec2 } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

const DT = 1 / 60;

function spawnFilteredBox(
  scene: Scene,
  name: string,
  filter: () => boolean,
): ColliderComponent {
  const entity = spawnEntityInScene(scene, name);
  entity.add(new Transform({ position: new Vec2(0, 0) }));
  entity.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
  const collider = entity.add(
    new ColliderComponent({ shape: { type: "box", width: 20, height: 20 } }),
  );
  collider.setContactFilter(filter);
  return collider;
}

describe("contact filters on both sides of a pair (real Rapier)", () => {
  it("identifies the participating compound shape", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const compoundEntity = spawnEntityInScene(scene, "compound");
    compoundEntity.add(new Transform());
    compoundEntity.add(
      new RigidBodyComponent({ type: "static", fixedRotation: true }),
    );
    const compound = compoundEntity.add(
      new ColliderComponent({
        parts: [
          {
            shape: { type: "box", width: 20, height: 20 },
            offset: { x: -100, y: 0 },
          },
          { shape: { type: "box", width: 20, height: 20 } },
        ],
      }),
    );
    const seen: Array<[number, number]> = [];
    compound.setContactFilter((contact) => {
      seen.push([contact.selfShapeIndex, contact.otherShapeIndex]);
      return true;
    });
    const other = spawnEntityInScene(scene, "other");
    other.add(new Transform());
    other.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    other.add(
      new ColliderComponent({ shape: { type: "box", width: 20, height: 20 } }),
    );

    physicsWorld.step(DT);

    expect(seen).toContainEqual([1, 0]);
    expect(seen).not.toContainEqual([0, 0]);
  });

  it.each(["first", "second"])(
    "runs both filters every step when the %s collider vetoes",
    async (vetoSide) => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
      });
      const first = vi.fn(() => vetoSide !== "first");
      const second = vi.fn(() => vetoSide !== "second");
      spawnFilteredBox(scene, "first", first);
      spawnFilteredBox(scene, "second", second);

      for (let i = 0; i < 5; i++) {
        physicsWorld.step(DT);
        physicsWorld.processCollisionEvents();
      }

      expect(first).toHaveBeenCalledTimes(5);
      expect(second).toHaveBeenCalledTimes(5);
    },
  );
});
