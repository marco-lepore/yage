import { Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

/** Where the ball is dropped from, in world pixels. */
const DROP_Y = 40;
/** The floor's top edge. */
const FLOOR_Y = 330;

/** What the physics case reports. */
export interface PhysicsReading extends CaseReading {
  startY: number;
  y: number;
  contacts: number;
}

/** Counts the ball's contacts with the floor and reads how far it fell. */
export class PhysicsProbe extends CaseProbe {
  private readonly transform = this.sibling(Transform);
  private readonly collider = this.sibling(ColliderComponent);
  private contacts = 0;

  onAdd(): void {
    this.collider.onCollision(({ started }) => {
      if (started) this.contacts += 1;
    });
  }

  get settled(): boolean {
    return this.contacts >= 1;
  }

  reading(): PhysicsReading {
    return {
      startY: DROP_Y,
      y: this.transform.position.y,
      contacts: this.contacts,
    };
  }
}

/** A dynamic ball that falls onto a static floor it spawns itself. */
export class PhysicsCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(80, DROP_Y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 12).fill({ color: 0x22c55e });
      }),
    );
    this.add(new RigidBodyComponent({ type: "dynamic" }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 12 },
        density: 1,
      }),
    );
    this.add(new PhysicsProbe());

    // A top-level entity, not a child: physics drives this entity's own
    // transform, and a child would be carried along by it.
    const floor = this.scene.spawn("baseline-floor");
    floor.add(new Transform({ position: new Vec2(80, FLOOR_Y) }));
    floor.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-60, 0, 120, 16).fill({ color: 0x3f3f46 });
      }),
    );
    floor.add(new RigidBodyComponent({ type: "static" }));
    floor.add(
      new ColliderComponent({ shape: { type: "box", width: 120, height: 16 } }),
    );
  }
}
