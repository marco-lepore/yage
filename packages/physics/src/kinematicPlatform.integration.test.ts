import { afterEach, describe, expect, it, vi } from "vitest";

// Real physics, not the usual mocks: these tests observe how a dynamic body
// resting on a kinematic platform moves with it. The `@dimforge/rapier2d`
// ESM build crashes when hooks are passed to `world.step` under vitest's
// transform, so the factory swaps in `@dimforge/rapier2d-compat` — the same
// library and version, instantiated at runtime.
vi.mock("@dimforge/rapier2d", async () => {
  const mod = (await import("@dimforge/rapier2d-compat")) as {
    default?: { init(): Promise<unknown> };
  };
  const RAPIER =
    mod.default ?? (mod as unknown as { init(): Promise<unknown> });
  await RAPIER.init();
  return { default: RAPIER };
});

import {
  advanceFrames,
  Component,
  createTestEngine,
  Entity,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { Engine } from "@yagejs/core";
import { ColliderComponent } from "./ColliderComponent.js";
import { PhysicsPlugin } from "./PhysicsPlugin.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { PhysicsWorldKey } from "./types.js";

class TestScene extends Scene {
  readonly name = "kinematic-platform";
}

/** Moves its entity's Transform vertically at `speed` px/s (negative rises). */
class Drive extends Component {
  private readonly transform = this.sibling(Transform);

  constructor(private readonly speed: number) {
    super();
  }

  fixedUpdate(dt: number): void {
    this.transform.translate(0, this.speed * dt);
  }
}

/** Adds a collider far away each update and queries, so the query index is rebuilt between steps. */
class ColliderChurn extends Component {
  fixedUpdate(): void {
    this.scene.spawn(Crate, { x: 5000, y: 5000, type: "static" });
    this.use(PhysicsWorldKey).queryShape(
      { type: "box", width: 10, height: 10 },
      { x: 5000, y: 5000 },
    );
  }
}

class Lift extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(0, 100) }));
    this.add(new RigidBodyComponent({ type: "kinematic" }));
    this.add(
      new ColliderComponent({ shape: { type: "box", width: 400, height: 20 } }),
    );
  }
}

class Crate extends Entity {
  setup({
    x,
    y,
    type,
  }: {
    x: number;
    y: number;
    type: "dynamic" | "static";
  }): void {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new RigidBodyComponent({ type, fixedRotation: true }));
    this.add(
      new ColliderComponent({ shape: { type: "box", width: 20, height: 20 } }),
    );
  }
}

let engine: Engine | undefined;
afterEach(() => {
  engine?.destroy();
  engine = undefined;
});

async function liftWithCrate() {
  engine = await createTestEngine({}, [new PhysicsPlugin()]);
  const scene = new TestScene();
  await engine.scenes.push(scene);
  const lift = scene.spawn(Lift);
  const crate = scene.spawn(Crate, { x: 0, y: 80, type: "dynamic" });
  const tick = (frames = 1) => {
    for (let i = 0; i < frames; i++) if (engine) advanceFrames(engine, 1);
  };
  tick(60);
  const liftBody = lift.get(RigidBodyComponent);
  const crateBody = crate.get(RigidBodyComponent);
  const gap = () => liftBody.positionY - crateBody.positionY;
  return { scene, lift, gap, tick };
}

describe("kinematic platforms (real Rapier)", () => {
  it.each([0.5, 1.5, 2.5, 3.3, 10])(
    "carries a resting box on a rising lift at time scale %s",
    async (scale) => {
      const { scene, lift, gap, tick } = await liftWithCrate();
      const rest = gap();
      lift.add(new Drive(-120));
      scene.timeScale = scale;
      for (let i = 0; i < 120; i++) {
        tick();
        expect(gap()).toBeCloseTo(rest, 1);
      }
    },
  );

  it.each([0.5, 1, 2.5])(
    "keeps a box on a lowering lift while queries rebuild between steps at time scale %s",
    async (scale) => {
      const { scene, lift, gap, tick } = await liftWithCrate();
      lift.add(new Drive(60));
      scene.timeScale = scale;
      tick(60);
      const riding = gap();
      lift.add(new ColliderChurn());
      for (let i = 0; i < 60; i++) {
        tick();
        expect(gap()).toBeCloseTo(riding, 1);
      }
    },
  );
});
