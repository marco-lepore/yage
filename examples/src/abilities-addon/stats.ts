import { Component } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { Health, defaultHitSteps } from "@yagejs-addons/abilities";
import type {
  HitReceiver,
  HitSpec,
  HitStage,
  Scalar,
  StandardHitData,
} from "@yagejs-addons/abilities";

// ---------------------------------------------------------------------------
// Stats boundary demo — a deliberately game-side stat block, wired into the
// abilities addon through its four integration hooks. This is NOT a portable
// stats system: no formulas, no modifiers, no buff engine — those are a
// separate future addon per the package charter. It exists to show where a
// real stats package plugs in and how each addon numeric hook is reached.
// Only the player carries `Stats`; enemies stay plain. Each stat drives one
// hook:
//   atk      -> fire-time `hit` builder (a `HitSpec`): `byAtk` scales a base
//               attack's damage, snapshot when the hitbox fires.
//   def      -> game-authored fold `HitStage`: `defenseStage` subtracts armor
//               from a landed hit in place, ahead of the addon's damage step.
//   maxHp    -> push into `Health.max`: `pushMaxHp` writes the derived cap and
//               heals the headroom a raise opens. The addon reads the plain
//               field — no provider protocol.
//   atkSpeed -> `Scalar` cooldown: `hasten` divides a base cooldown by the
//               stat, re-resolved each activation so the hotbar tracks it.
// ---------------------------------------------------------------------------

/** Attack damage is authored "at `BASE_ATK`"; `byAtk` scales relative to it. */
export const BASE_ATK = 10;

export type StatKind = "atk" | "def" | "maxHp" | "atkSpeed";

/** Game-side derived stats. Plain mutable fields — a real stats addon would
 *  compute these from equipment and buffs; here pickups and level-ups add to
 *  them directly. */
export class Stats extends Component {
  atk: number;
  def: number;
  maxHp: number;
  atkSpeed: number; // 1 = base cooldowns; higher shortens them
  level = 1;
  kills = 0;

  constructor(init: {
    atk: number;
    def: number;
    maxHp: number;
    atkSpeed?: number;
  }) {
    super();
    this.atk = init.atk;
    this.def = init.def;
    this.maxHp = init.maxHp;
    this.atkSpeed = init.atkSpeed ?? 1;
  }
}

export function statsOf(entity: Entity): Stats | undefined {
  return entity.tryGet(Stats);
}

export function scaleHitByAtk(entity: Entity, base: StandardHitData): StandardHitData {
  const atk = statsOf(entity)?.atk ?? BASE_ATK;
  return {
    ...base,
    damage: Math.round((base.damage ?? 0) * (atk / BASE_ATK)),
  };
}

/** atk hook: a fire-time `hit` builder scaling `base.damage` by the caster's
 *  atk relative to `BASE_ATK`; knockback/stun stay as authored. */
export function byAtk(base: StandardHitData): HitSpec {
  return (ctx) => scaleHitByAtk(ctx.entity, base);
}

/** atkSpeed hook: a `Scalar` cooldown of `base` seconds divided by the
 *  caster's attack-speed stat (1 = base), re-resolved at each activation. */
export function hasten(base: number): Scalar {
  return (ctx) => base / (statsOf(ctx.entity)?.atkSpeed ?? 1);
}

/** def hook: a fold `HitStage` subtracting the receiver's armor from a landed
 *  hit's damage, in place, before the addon's damage step. Blessed mutation —
 *  the delivery has already copied `hit.data` per victim. */
export const defenseStage: HitStage<StandardHitData, HitReceiver> = (
  hit,
  receiver,
) => {
  const def = statsOf(receiver.entity)?.def ?? 0;
  if (def > 0 && hit.data.damage !== undefined) {
    hit.data.damage = Math.max(0, hit.data.damage - def);
  }
  return undefined;
};

/** The player's apply-stage list: armor first, then the addon defaults
 *  (damage, reaction). */
export const playerHitSteps: readonly HitStage<StandardHitData, HitReceiver>[] = [
  defenseStage,
  ...defaultHitSteps,
];

/** maxHp hook: push the derived cap into `Health.max`, healing the headroom a
 *  raise opened (a level-up reads as a bigger, fuller bar) or clamping hp
 *  under a lowered cap. The addon reads the plain field — nothing to notify. */
export function pushMaxHp(entity: Entity): void {
  const stats = statsOf(entity);
  const health = entity.tryGet(Health);
  if (!stats || !health) return;
  const gained = stats.maxHp - health.max;
  health.max = stats.maxHp;
  if (gained > 0) health.heal(gained);
  else health.hp = Math.min(health.hp, health.max);
}
