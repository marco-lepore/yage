import { Component, Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import { RigidBodyComponent } from "@yagejs/physics";

const windowControls = new WeakMap<Stagger, (enabled: boolean) => void>();

/**
 * Hit-stun + knockback ride-along. While active it owns the body's
 * velocity: the knockback vector ramps linearly to zero across the stun
 * window (the "shove" feel without residual velocity for damping to bleed
 * off), so controllers and AI should check `active` and bail before writing
 * velocity themselves. Driven by the `staggerMotion` step (see
 * `src/components/steps/stagger.ts`), itself forced by `HitReceiver`'s
 * reaction step reading `StandardHitData.knockback`/`stun` — arbitration
 * against the entity's other abilities lives there, not here. Requires a
 * sibling `RigidBodyComponent`.
 */
export class Stagger extends Component {
  private readonly body = this.sibling(RigidBodyComponent);
  private remaining = 0;
  private total = 0;
  private vx = 0;
  private vy = 0;
  private windowEnabled = true;

  constructor() {
    super();
    windowControls.set(this, (enabled) => this.setWindowEnabled(enabled));
  }

  get active(): boolean {
    return this.remaining > 0;
  }

  /**
   * Start (or restart — last hit wins) a stun. `knockback` is the peak
   * speed in px/s at impact, decaying linearly to 0 across `stun` seconds.
   * Only `direction`'s direction matters; magnitude is ignored, and a
   * zero-length vector falls back to +x. A `stun` of 0 or less does nothing
   * — there is no window to ramp the knockback over.
   */
  begin(options: {
    direction: Vec2Like;
    knockback: number;
    stun: number;
  }): void {
    if (options.stun <= 0) return;
    const dir = new Vec2(options.direction.x, options.direction.y).normalize();
    const unit = dir.lengthSq() > 0 ? dir : new Vec2(1, 0);
    this.vx = unit.x * options.knockback;
    this.vy = unit.y * options.knockback;
    this.remaining = options.stun;
    this.total = options.stun;
    this.applyVelocity();
  }

  /** End the stun early, zeroing the body's velocity. */
  end(): void {
    this.remaining = 0;
    this.windowEnabled = true;
    this.body.setVelocity(Vec2.ZERO);
  }

  private setWindowEnabled(enabled: boolean): void {
    if (this.windowEnabled === enabled) return;
    if (!enabled && !this.active) return;
    this.windowEnabled = enabled;
    if (enabled) {
      this.applyVelocity();
    } else {
      this.body.setVelocity(Vec2.ZERO);
    }
  }

  onDisable(): void {
    if (this.active) this.body.setVelocity(Vec2.ZERO);
  }

  onEnable(): void {
    this.applyVelocity();
  }

  fixedUpdate(dt: number): void {
    if (!this.effectiveEnabled || !this.windowEnabled || this.remaining <= 0) {
      return;
    }
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.remaining === 0) {
      this.body.setVelocity(Vec2.ZERO);
      return;
    }
    this.applyVelocity();
  }

  private applyVelocity(): void {
    if (!this.effectiveEnabled || !this.windowEnabled || this.remaining <= 0) {
      return;
    }
    const t = this.remaining / this.total;
    this.body.setVelocity(new Vec2(this.vx * t, this.vy * t));
  }
}

/** @internal Controls the stagger effect owned by an open ability window. */
export function setStaggerWindowEnabled(
  stagger: Stagger,
  enabled: boolean,
): void {
  const control = windowControls.get(stagger);
  if (!control) {
    throw new Error("Stagger window control is unavailable.");
  }
  control(enabled);
}
