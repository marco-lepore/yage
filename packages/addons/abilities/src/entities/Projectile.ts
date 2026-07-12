import { Entity, Process, ProcessComponent, Transform, Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import type { ColliderShape } from "@yagejs/physics";
import { shouldConsumeProjectile } from "../core/hit/delivery.js";
import type {
  DeliveryColliderGroups,
  HitDelivery,
} from "../core/hit/delivery.js";

export interface ProjectileConfig {
  position: Vec2Like;
  /** Unit travel direction (the step passes the resolved aim). */
  direction: Vec2Like;
  /** Speed px/s. */
  speed: number;
  /** Collider shape. */
  shape: ColliderShape;
  /** Pre-built delivery (source/team/tags/data). */
  delivery: HitDelivery;
  /** Excluded from contact entirely — no deliver, no consume (survives its own body). */
  owner: Entity;
  /** Seconds before self-destruct. */
  lifetime: number;
  groups?: DeliveryColliderGroups;
}

/**
 * A dynamic zero-gravity sensor body: velocity is set once at spawn, and it
 * self-destructs on the bit-free consume rule (`shouldConsumeProjectile`) or
 * on its lifetime timer, whichever comes first. Exported for direct
 * spawning outside abilities (a game-thrown item with its own `HitDelivery`)
 * as well as via the `projectile` step.
 */
export class Projectile extends Entity {
  setup(config: ProjectileConfig): void {
    const position = new Vec2(config.position.x, config.position.y);
    this.add(new Transform({ position }));
    const body = this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        gravityScale: 0,
        ccd: true,
      }),
    );
    const collider = this.add(
      new ColliderComponent({
        shape: config.shape,
        sensor: true,
        ...(config.groups?.layers !== undefined ? { layers: config.groups.layers } : {}),
        ...(config.groups?.mask !== undefined ? { mask: config.groups.mask } : {}),
      }),
    );
    const dir = new Vec2(config.direction.x, config.direction.y);
    body.setVelocity(dir.scale(config.speed));

    const pc = this.add(new ProcessComponent());
    pc.run(Process.delay(config.lifetime, () => this.destroy()));

    let consumed = false;
    collider.onTrigger((ev) => {
      if (!ev.entered || consumed) return;
      if (ev.other === config.owner) return; // pass through the firer's own body
      const result = config.delivery.deliver(
        ev.other,
        this.get(Transform).worldPosition,
      );
      if (shouldConsumeProjectile(result, ev.otherCollider.config.sensor === true)) {
        consumed = true;
        this.destroy();
      }
    });
  }
}
