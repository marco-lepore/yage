import {
  Entity,
  Process,
  ProcessComponent,
  Transform,
  Vec2,
  trait,
} from "@yagejs/core";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import type { ColliderShape } from "@yagejs/physics";
import { AbilitySpawned } from "../core/AbilitySpawned.js";
import type { AbilitySpawnContext } from "../core/AbilitySpawned.js";
import { shouldConsumeProjectile } from "../core/hit/delivery.js";
import type { DeliveryColliderGroups } from "../core/hit/delivery.js";

export interface ProjectileConfig {
  /** Speed px/s. */
  speed: number;
  /** Collider shape. */
  shape: ColliderShape;
  /** Seconds before self-destruct. */
  lifetime: number;
  groups?: DeliveryColliderGroups;
}

/**
 * A dynamic zero-gravity sensor body: velocity is set once at spawn, and it
 * self-destructs on the bit-free consume rule (`shouldConsumeProjectile`) or
 * on its lifetime timer, whichever comes first. Use it as the entity class
 * for `spawn`, subclass it to add presentation, or pass an ability context to
 * `Scene.spawn` for an attack that has no ability timeline.
 */
@trait(AbilitySpawned)
export class Projectile extends Entity {
  abilitySpawnContext: AbilitySpawnContext<ProjectileConfig> | undefined;

  override setup(context: AbilitySpawnContext<ProjectileConfig>): void {
    this.abilitySpawnContext = context;
    const { params: config } = context;
    const { delivery } = context;
    if (!delivery) {
      throw new Error("Projectile requires an ability spawn delivery.");
    }
    const position = new Vec2(context.position.x, context.position.y);
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
        ...(config.groups?.layers !== undefined
          ? { layers: config.groups.layers }
          : {}),
        ...(config.groups?.mask !== undefined
          ? { mask: config.groups.mask }
          : {}),
      }),
    );
    const dir = new Vec2(context.aim.x, context.aim.y);
    body.setVelocity(dir.scale(config.speed));

    const pc = this.add(new ProcessComponent());
    pc.run(Process.delay(config.lifetime, () => this.destroy()));

    let consumed = false;
    collider.onTrigger((ev) => {
      if (!ev.entered || consumed) return;
      if (ev.other === context.caster) return; // pass through the firer's own body
      const result = delivery.deliver(
        ev.other,
        this.get(Transform).worldPosition,
      );
      if (
        shouldConsumeProjectile(result, ev.otherCollider.config.sensor === true)
      ) {
        consumed = true;
        this.destroy();
      }
    });
  }
}
