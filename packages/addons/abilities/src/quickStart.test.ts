import { describe, expect, it, vi } from "vitest";
import {
  Entity,
  ProcessComponent,
  Transform,
  createMockScene,
  trait,
} from "@yagejs/core";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { Abilities } from "./core/Abilities.js";
import { Hittable } from "./core/hit/types.js";
import type { Hit, HitResult } from "./core/hit/types.js";
import { Facing } from "./components/Facing.js";
import { Health } from "./components/Health.js";
import { HitReceiver } from "./components/HitReceiver.js";
import { Stagger } from "./components/Stagger.js";
import { hitbox } from "./components/steps/hitbox.js";
import { Hitbox } from "./entities/Hitbox.js";

vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");
  class RigidBodyComponent extends core.Component {
    setVelocity(): void {}
  }
  class ColliderComponent extends core.Component {
    constructor(readonly config: object) {
      super();
    }
    onTrigger(): () => void {
      return () => {};
    }
  }
  return { ColliderComponent, RigidBodyComponent };
});

const SLASH = {
  id: "slash",
  duration: 0.35,
  timeline: [
    hitbox({
      from: 0.08,
      to: 0.2,
      shape: {
        type: "capsule" as const,
        halfHeight: 18,
        radius: 10,
        axis: "x" as const,
      },
      offset: { x: 30, y: 0 },
      hit: { damage: 18, knockback: 260, stun: 0.3 },
    }),
  ],
};

@trait(Hittable)
class Fighter extends Entity {
  receiveHit(hit: Hit): HitResult {
    return this.get(HitReceiver).receive(hit);
  }

  override setup(): void {
    this.add(new Transform());
    this.add(new ProcessComponent());
    this.add(new RigidBodyComponent({ type: "dynamic" }));
    this.add(new ColliderComponent({ shape: { type: "circle", radius: 12 } }));
    this.add(new Facing());
    this.add(new Health({ max: 100 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "player", iframes: 0.15 }));
    this.add(new Abilities([SLASH]));
  }
}

describe("documented quick start", () => {
  it("mounts and opens its default-aim hitbox", () => {
    const { scene } = createMockScene();
    const fighter = scene.spawn(Fighter);

    fighter.get(Abilities).send("slash");
    fighter.get(ProcessComponent)._tick(0.08);

    const spawned = scene
      .findEntities()
      .find((entity): entity is Hitbox => entity instanceof Hitbox);
    expect(spawned).toBeDefined();
    expect(spawned?.get(Transform).rotation).toBe(0);
  });
});
