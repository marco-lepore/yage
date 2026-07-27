import { Component, Transform, Vec2 } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { ColliderComponent } from "@yagejs/physics";
import {
  resolveAbilitySource,
  resolveAbilityTeam,
} from "../core/AbilitySpawned.js";
import type { HitDelivery } from "../core/hit/delivery.js";
import type { StandardHitData } from "../core/hit/types.js";
import { HitReceiver } from "./HitReceiver.js";
import { createReportingDelivery } from "./reportedDelivery.js";

export interface TouchDamageOptions {
  /** Hit payload delivered on contact. Static — touch is continuous, no StepContext. */
  hit: StandardHitData;
  /** Team stamped into the hit; omit to inherit the sibling `HitReceiver.team`. */
  team?: string;
  tags?: readonly string[];
  /** Seconds between re-hits on a target held in contact. Default 1. */
  interval?: number;
}

/**
 * Contact damage with a per-target re-hit interval, delivered through the
 * `Hittable` trait (`createHitDelivery`) rather than reading a receiver's
 * `Health` directly — the sibling `HitReceiver`'s i-frames/guards apply the
 * same as any other delivery. Reads its **sibling** `ColliderComponent`
 * (the host entity already has one); it creates no collider of its own, so
 * there is no `layers`/`mask` here. Subscribes `onTrigger` or `onCollision`
 * depending on the sibling collider's own `sensor` flag — a solid enemy
 * body damages on physical contact, a sensor aura damages on overlap.
 */
export class TouchDamage extends Component {
  private readonly collider = this.sibling(ColliderComponent);
  private readonly last = new Map<Entity, number>();
  private readonly interval: number;
  private elapsed = 0;
  private delivery!: HitDelivery;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly options: TouchDamageOptions) {
    super();
    this.interval = options.interval ?? 1;
  }

  onAdd(): void {
    const team =
      this.options.team ??
      resolveAbilityTeam(this.entity) ??
      this.entity.tryGet(HitReceiver)?.team;
    this.delivery = createReportingDelivery({
      source: resolveAbilitySource(this.entity),
      data: this.options.hit,
      ...(team !== undefined ? { team } : {}),
      ...(this.options.tags ? { tags: this.options.tags } : {}),
    });
  }

  onEnable(): void {
    if (this.unsubscribe) return;
    this.unsubscribe =
      this.collider.config.sensor === true
        ? this.collider.onTrigger((ev) => this.contact(ev.other, ev.entered))
        : this.collider.onCollision((ev) => this.contact(ev.other, ev.started));
  }

  onDisable(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.last.clear();
  }

  onDestroy(): void {
    this.onDisable();
  }

  update(dt: number): void {
    this.elapsed += dt;
    for (const [other, t] of this.last) {
      if (other.isDestroyed) {
        this.last.delete(other);
        continue;
      }
      if (this.elapsed - t >= this.interval) {
        this.deliver(other);
        this.last.set(other, this.elapsed);
      }
    }
  }

  private contact(other: Entity, begin: boolean): void {
    if (!this.effectiveEnabled) return;
    if (begin) {
      this.deliver(other);
      this.last.set(other, this.elapsed);
    } else {
      this.last.delete(other);
    }
  }

  private deliver(other: Entity): void {
    const from = this.entity.tryGet(Transform)?.worldPosition ?? Vec2.ZERO;
    this.delivery.deliver(other, from); // Hittable-gated; non-receivers no-op
  }
}
