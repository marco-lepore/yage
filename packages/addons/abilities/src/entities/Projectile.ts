import {
  Entity,
  ErrorBoundaryKey,
  Process,
  ProcessComponent,
  Transform,
  Vec2,
  trait,
} from "@yagejs/core";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import type {
  ColliderShape,
  CollisionEvent,
  TriggerEvent,
} from "@yagejs/physics";
import { AbilitySpawned } from "../core/AbilitySpawned.js";
import type { AbilitySpawnContext } from "../core/AbilitySpawned.js";
import { shouldConsumeProjectile } from "../core/hit/delivery.js";
import type { DeliveryColliderGroups } from "../core/hit/delivery.js";
import type { HitResult } from "../core/hit/types.js";

export interface ProjectileConfig {
  /** Speed px/s. */
  speed: number;
  /** Collider shape. */
  shape: ColliderShape;
  /** Seconds before self-destruct. */
  lifetime: number;
  groups?: DeliveryColliderGroups;
  /** Sensor overlaps by default. Set false for solid collision response. */
  sensor?: boolean;
  /** Gravity multiplier. Default 0. */
  gravityScale?: number;
  /** Whether a contact consumes the projectile. Default shouldConsumeProjectile. */
  consume?: (result: HitResult, otherIsSensor: boolean) => boolean;
}

/**
 * A dynamic body, with a zero-gravity sensor by default. Velocity is set once
 * at spawn. It self-destructs on its consume rule (`shouldConsumeProjectile` by default) or
 * on its lifetime timer, whichever comes first. Use it as the entity class
 * for `spawn`, subclass it to add presentation, or pass an ability context to
 * `Scene.spawn` for an attack that has no ability timeline.
 */
@trait(AbilitySpawned)
export class Projectile extends Entity {
  abilitySpawnContext: AbilitySpawnContext<ProjectileConfig> | undefined;

  override setup(context: AbilitySpawnContext<ProjectileConfig>): void {
    const { params: config } = context;
    if (!Number.isFinite(config.speed)) {
      throw new Error(
        `Projectile.setup: speed must be finite, got ${config.speed}.`,
      );
    }
    if (!Number.isFinite(config.lifetime) || config.lifetime < 0) {
      throw new Error(
        `Projectile.setup: lifetime must be finite and >= 0, got ${config.lifetime}.`,
      );
    }
    const { delivery } = context;
    if (!delivery) {
      throw new Error("Projectile requires an ability spawn delivery.");
    }
    this.abilitySpawnContext = context;
    const position = new Vec2(context.position.x, context.position.y);
    this.add(new Transform({ position }));
    const body = this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        gravityScale: config.gravityScale ?? 0,
        ccd: true,
      }),
    );
    const collider = this.add(
      new ColliderComponent({
        shape: config.shape,
        sensor: config.sensor ?? true,
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
    // Lifetime is game logic gating a physics body: fixed clock, so range
    // (speed × lifetime) holds when frame time and simulation time diverge.
    pc.run(
      Process.delay(config.lifetime, () => this.destroy()),
      {
        clock: "fixed",
      },
    );

    let consumed = false;
    const contact = (ev: TriggerEvent | CollisionEvent): void => {
      if (consumed) return;
      if (ev.other === context.caster) return; // pass through the firer's own body
      const result = delivery.deliver(
        ev.other,
        this.get(Transform).worldPosition,
      );
      const otherIsSensor = ev.otherCollider.config.sensor === true;
      let consume = false;
      if (config.consume) {
        this.scene.context.resolve(ErrorBoundaryKey).wrapCallback(
          () => {
            consume = config.consume!(result, otherIsSensor);
          },
          {
            kind: "Projectile consume callback",
            entity: this.name,
            scene: this.scene.name,
          },
        );
      } else {
        consume = shouldConsumeProjectile(result, otherIsSensor);
      }
      if (consume) {
        consumed = true;
        this.destroy();
      }
    };
    if (config.sensor ?? true) {
      collider.onTrigger((ev) => {
        if (ev.entered) contact(ev);
      });
    } else {
      collider.onCollision((ev) => {
        if (ev.started) contact(ev);
      });
    }
  }
}
