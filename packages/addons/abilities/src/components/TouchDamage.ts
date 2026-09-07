import { Component, Transform, Vec2 } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { ColliderComponent } from "@yagejs/physics";
import type { CollisionEvent, TriggerEvent } from "@yagejs/physics";
import {
  resolveAbilitySource,
  resolveAbilityTeam,
} from "../core/AbilitySpawned.js";
import type { HitDelivery } from "../core/hit/delivery.js";
import type { HitContact, StandardHitData } from "../core/hit/types.js";
import { HitReceiver } from "./HitReceiver.js";
import { createReportingDelivery } from "./reportedDelivery.js";
import { queryHitContact, resolveHitContact } from "./hitContact.js";
import type { HitContactPair } from "./hitContact.js";

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
  /** Targets in contact: last delivery time and the shape pair that fired. */
  private readonly last = new Map<
    Entity,
    { at: number; pair: HitContactPair }
  >();
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
        ? this.collider.onTrigger((ev) => this.contact(ev, ev.entered))
        : this.collider.onCollision((ev) => this.contact(ev, ev.started));
  }

  onDisable(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.last.clear();
  }

  onDestroy(): void {
    this.onDisable();
  }

  fixedUpdate(dt: number): void {
    this.elapsed += dt;
    for (const [other, entry] of this.last) {
      if (other.isDestroyed) {
        this.last.delete(other);
        continue;
      }
      if (this.elapsed - entry.at >= this.interval) {
        this.deliver(other, queryHitContact(this.collider, entry.pair));
        entry.at = this.elapsed;
      }
    }
  }

  private contact(ev: TriggerEvent | CollisionEvent, begin: boolean): void {
    if (!this.effectiveEnabled) return;
    if (begin) {
      this.deliver(ev.other, resolveHitContact(this.collider, ev));
      this.last.set(ev.other, { at: this.elapsed, pair: ev });
    } else {
      this.last.delete(ev.other);
    }
  }

  private deliver(other: Entity, contact: HitContact | undefined): void {
    const from = this.entity.tryGet(Transform)?.worldPosition ?? Vec2.ZERO;
    this.delivery.deliver(other, from, contact); // Hittable-gated; non-receivers no-op
  }
}
