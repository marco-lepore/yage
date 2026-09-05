import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import type { ColliderShape } from "@yagejs/physics";
import type {
  DeliveryColliderGroups,
  HitDelivery,
} from "../core/hit/delivery.js";

export interface HitboxConfig {
  /** Body world position; also the delivery `from` (knockback origin). */
  position: Vec2Like;
  /** Body rotation (radians) = the aim angle; rotates the local shape + offset. */
  rotation: number;
  /** Collider shape in the +x facing-local frame. */
  shape: ColliderShape;
  /** Local offset from the body in the +x facing-local frame (px). */
  offset?: Vec2Like;
  /** Pre-built delivery (already carries source/team/tags/data). */
  delivery: HitDelivery;
  /** Physics-level pruning; unset = member-of-all (receiver-side filter only). */
  groups?: DeliveryColliderGroups;
  /** Re-anchors the body's position to this entity every fixed step, keeping
   *  the spawn-time rotation and local `offset` fixed. Stops updating once
   *  the caster is destroyed — the hitbox keeps its last position. Required
   *  when `follow` is true. */
  caster?: Entity;
  /** Track `caster`'s position every fixed step instead of a fire-time snapshot. Default false. */
  follow?: boolean;
}

/**
 * A detached kinematic sensor spawned by the `hitbox` window step (not
 * itself exported — games author swings through the step). Delivers once
 * per target for its whole life; the step's window IS its lifetime, so a
 * cancelled swing destroys it via the step's `exit` hook rather than a
 * timer of its own.
 */
export class Hitbox extends Entity {
  private delivery!: HitDelivery;
  private from!: Vec2;
  private readonly hit = new Set<Entity>();
  private readonly overlapping = new Set<Entity>();
  private repeats = false;

  setup(config: HitboxConfig): void {
    this.delivery = config.delivery;
    this.from = new Vec2(config.position.x, config.position.y);
    this.add(new Transform({ position: this.from, rotation: config.rotation }));
    this.add(new RigidBodyComponent({ type: "kinematic", gravityScale: 0 }));
    const collider = this.add(
      new ColliderComponent({
        shape: config.shape,
        sensor: true,
        ...(config.offset
          ? { offset: { x: config.offset.x, y: config.offset.y } }
          : {}),
        ...(config.groups?.layers !== undefined
          ? { layers: config.groups.layers }
          : {}),
        ...(config.groups?.mask !== undefined
          ? { mask: config.groups.mask }
          : {}),
      }),
    );
    collider.onTrigger((ev) => {
      if (!ev.entered) {
        this.overlapping.delete(ev.other);
        if (this.repeats) this.hit.delete(ev.other);
        return;
      }
      this.overlapping.add(ev.other);
      if (this.hit.has(ev.other)) return;
      this.hit.add(ev.other); // once per target per window; deliver() re-excludes source
      this.delivery.deliver(ev.other, this.from);
    });
    if (config.follow) {
      if (!config.caster) {
        throw new Error(
          "Abilities: Hitbox config has follow=true but no caster to track.",
        );
      }
      this.add(new HitboxFollow(config.caster, this));
    }
  }

  /** Re-anchors the body position and the delivery's knockback origin to
   *  `pos`, leaving rotation and the collider's local offset untouched —
   *  used by `HitboxFollow` to track a moving caster each fixed step. */
  moveTo(pos: Vec2): void {
    this.from = pos;
    this.get(Transform).setPosition(pos.x, pos.y);
  }

  /** Deliver another hit to every target that still overlaps this hitbox. */
  repeatHits(): void {
    for (const target of this.overlapping) {
      this.delivery.deliver(target, this.from);
    }
  }

  /** @internal Allow contact re-entry to count as a new immediate hit. */
  enableRepeatHits(): void {
    this.repeats = true;
  }
}

/** Re-anchors a `follow`-enabled `Hitbox`'s position to its caster every
 *  frame. Position tracking only — the hitbox's rotation and local offset
 *  (the aim/shape snapshot taken at spawn) never change. Once the caster is
 *  destroyed, `update` becomes a no-op and the hitbox keeps its last
 *  position rather than snapping anywhere. */
export class HitboxFollow extends Component {
  constructor(
    private readonly caster: Entity,
    private readonly hitbox: Hitbox,
  ) {
    super();
  }

  fixedUpdate(): void {
    if (this.caster.isDestroyed) return;
    const transform = this.caster.tryGet(Transform);
    if (!transform) return;
    this.hitbox.moveTo(transform.worldPosition);
  }
}
