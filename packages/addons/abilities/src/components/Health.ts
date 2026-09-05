import { Component, defineEvent } from "@yagejs/core";

/** Damage landed on a `Health`. `amount` is the HP actually subtracted (post-clamp). */
export const HealthDamaged = defineEvent<{ amount: number; hp: number }>(
  "abilities:health:damaged",
);

/** Healing landed on a `Health`. `amount` is the HP actually restored (post-clamp). */
export const HealthHealed = defineEvent<{ amount: number; hp: number }>(
  "abilities:health:healed",
);

/** HP reached 0. Emitted once per death. */
export const HealthDied = defineEvent("abilities:health:died");

/**
 * HP tracker with entity events. Damage usually arrives through
 * `HitReceiver`'s damage step reading `StandardHitData.damage`; calling
 * `takeDamage` directly behaves the same. `hp` and `max` are plain mutable
 * fields for direct reads/tweaks — writing them directly skips the events
 * and clamping.
 */
export class Health extends Component {
  hp: number;
  max: number;

  constructor(options: { max: number; initial?: number }) {
    super();
    this.max = options.max;
    this.hp = options.initial ?? options.max;
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  /** Subtract HP (clamped at 0), emitting `HealthDamaged` and, on reaching 0, `HealthDied`. Dead entities take no further damage. Returns the HP actually subtracted (0 on a no-op). */
  takeDamage(amount: number): number {
    if (this.isDead || amount <= 0) return 0;
    const applied = Math.min(this.hp, amount);
    this.hp -= applied;
    this.entity.emit(HealthDamaged, { amount: applied, hp: this.hp });
    if (this.hp === 0) this.entity.emit(HealthDied);
    return applied;
  }

  /** Restore HP (clamped at `max`), emitting `HealthHealed`. Dead entities can't be healed back — revive by writing `hp` directly. Returns the HP actually restored (0 on a no-op). */
  heal(amount: number): number {
    if (this.isDead || amount <= 0) return 0;
    const applied = Math.min(this.max - this.hp, amount);
    if (applied <= 0) return 0;
    this.hp += applied;
    this.entity.emit(HealthHealed, { amount: applied, hp: this.hp });
    return applied;
  }
}
