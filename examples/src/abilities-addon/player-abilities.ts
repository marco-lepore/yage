import { Component, Transform, Vec2 } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { RigidBodyComponent } from "@yagejs/physics";
import {
  Facing,
  Health,
  Projectile,
  REACTION_PRIORITY,
  block,
  hitbox,
  parry,
  slowmo,
  spawn,
} from "@yagejs-addons/abilities";
import type {
  AbilityDef,
  AbilitySpawnContext,
  ProjectileConfig,
} from "@yagejs-addons/abilities";
import { PLAYER_TINT } from "./constants.js";
import {
  CAST_DURATION,
  CAST_RELEASE_AT,
  castHandPosition,
} from "./boxer-sprites.js";
import {
  dashMove,
  heal,
  invulnerableWithFlash,
  lungeMove,
  punchMove,
  spriteAnim,
  spriteHold,
} from "./steps.js";
import { byAtk, hasten } from "./stats.js";
import { INVULN_FLASH_INTERVAL } from "./feedback.js";

export function nearestLivingEnemy(scene: Scene, position: Vec2): Entity | null {
  let nearest: Entity | null = null;
  let nearestDistance = Infinity;
  for (const enemy of scene.findEntitiesByTag("enemy")) {
    if (enemy.tryGet(Health)?.isDead ?? true) continue;
    const distance = enemy.get(Transform).worldPosition.sub(position).length();
    if (distance < nearestDistance) {
      nearest = enemy;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Re-aims the projectile at the nearest living enemy each update. The
 *  projectile keeps its last velocity while no target exists. */
export class HomingProjectileMotion extends Component {
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly transform = this.sibling(Transform);

  constructor(private readonly speed: number) {
    super();
  }

  update(): void {
    const target = nearestLivingEnemy(this.scene, this.transform.worldPosition);
    if (!target) return;
    const aim = target
      .get(Transform)
      .worldPosition.sub(this.transform.worldPosition)
      .normalize();
    if (aim !== Vec2.ZERO) this.rb.setVelocity(aim.scale(this.speed));
  }
}

export class HomingFireballProjectile extends Projectile {
  override setup(context: AbilitySpawnContext<ProjectileConfig>): void {
    super.setup(context);
    this.add(new HomingProjectileMotion(context.params.speed));
    this.add(
      new GraphicsComponent().draw((graphics) => {
        graphics.circle(0, 0, 9).fill({ color: 0xef4444, alpha: 0.5 });
        graphics.circle(0, 0, 6).fill({ color: 0xf97316 });
        graphics.circle(0, 0, 2.5).fill({ color: 0xfef3c7 });
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Ability defs — every timeline below is windup → active → recovery:
// `duration` extends past the last hitbox/effect window so committing to an
// attack leaves the lane busy (and the caster exposed) for a beat after the
// damage window closes, not just until it does. Hitbox/telegraph windows are
// timed against the ~12%-slowed attack speeds in `BOXER_ANIM_SPECS` above, so
// contact still lands on the visible extension frame.
//
// `SUPER_ARMOR_PRIORITY` (above the built-in stagger reaction's own
// `REACTION_PRIORITY`) marks every committed player attack phase below as
// uninterruptible: a landed hit still deals damage, but `HitReceiver`'s
// reaction step forcing the stagger reaction onto this def's lane is refused
// (lower priority), so neither the flinch nor the knockback ramp it carries
// ever starts. The enemy's `melee`/`shoot` carry no `priority` at all
// (default 0, below `REACTION_PRIORITY`) — a landed hit always interrupts a
// telegraphed swing, punishing the tell instead of just chipping through it.
// See `07-reactions.md`'s evidence note for the diagnosis that led here: the
// two were symmetric until a playtest pass found enemy attacks never
// flinching or losing ground even when hit mid-telegraph.
// ---------------------------------------------------------------------------

export const SUPER_ARMOR_PRIORITY = REACTION_PRIORITY + 10;
export const FIST_ATTACK_INTENT = "fists/attack";
export const FIST_RELEASE_INTENT = "fists/attack-release";
export const KICK_ATTACK_INTENT = "kicks/attack";
export const KICK_RELEASE_INTENT = "kicks/attack-release";
export const CHARGE_SLOWMO_SCALE = 0.3;
export const CHARGE_SLOWMO_DURATION = 1.5;

/** Seconds a combo transition window stays open from the stage's end, so a
 *  tap in the recovery gap still advances through the runner's linger before
 *  the entry resets. A touch more forgiving than the animations' pace. */
export const COMBO_WINDOW = 0.6;

/** The FISTS 1-2-3 combo: one def, one phase per stage.
 *  `send("fists/attack")` enters at `jab` when the lane is idle and advances
 *  `jab` → `cross` → `hook` through each stage's
 *  `on: { "fists/attack" }` transition window — fully post-end with
 *  `from: "end"`, staying open for `COMBO_WINDOW`, so a tap advances the
 *  instant a swing finishes and through the recovery gap after it (the
 *  runner's linger). `AbilityDriver` owns tap-vs-charge classification and
 *  the buffered intent.
 *
 *  Stage timings, all phase-local:
 *  - `jab`: LeftJab's one-shot at this speed runs ~0.36s; the hitbox sits on
 *    the punch's extension and recovery stretches ~0.2s past it. `punchMove`
 *    rides the same window as the hitbox — a step into the punch, ~31px, so
 *    the jab reads as weight thrown forward rather than a stationary arm
 *    swing.
 *  - `cross`: RightJab's shorter one-shot (~0.26s) lands its contact frame
 *    earlier; recovery still runs ~0.19s past it. `punchMove`'s window is
 *    narrower than the jab's (the cross's hitbox window is itself narrower)
 *    at a higher speed, landing a comparable ~28px step.
 *  - `hook`, the finisher: RightHook reaches full extension around frames
 *    7-9. A stronger lunge carries the body through that contact pose, while
 *    `follow: true` keeps the active hitbox attached through the travel.
 *
 *  Per-phase `cancels`: a buffered dash may cancel each stage's recovery
 *  once its hit has landed. */
export const FIST_COMBO: AbilityDef = {
  id: FIST_ATTACK_INTENT,
  priority: SUPER_ARMOR_PRIORITY,
  phases: {
    jab: {
      duration: 0.448,
      on: {
        [FIST_ATTACK_INTENT]: {
          to: "cross",
          from: "end",
          for: COMBO_WINDOW,
        },
      },
      cancels: [{ from: 0.246, into: ["dash"] }],
      timeline: [
        spriteAnim({ at: 0, name: "attack1" }),
        punchMove({ from: 0.123, to: 0.246, speed: 250 }),
        hitbox({
          from: 0.123,
          to: 0.246,
          shape: { type: "capsule", halfHeight: 24, radius: 14, axis: "x" },
          offset: { x: 39, y: 0 },
          hit: byAtk({ damage: 10, knockback: 240, stun: 0.16, hitstop: 0.05 }),
        }),
      ],
    },
    cross: {
      duration: 0.358,
      on: {
        [FIST_ATTACK_INTENT]: {
          to: "hook",
          from: "end",
          for: COMBO_WINDOW,
        },
      },
      cancels: [{ from: 0.168, into: ["dash"] }],
      timeline: [
        spriteAnim({ at: 0, name: "attack2" }),
        punchMove({ from: 0.078, to: 0.168, speed: 310 }),
        hitbox({
          from: 0.078,
          to: 0.168,
          shape: { type: "capsule", halfHeight: 24, radius: 14, axis: "x" },
          offset: { x: 37, y: 0 },
          hit: byAtk({ damage: 12, knockback: 265, stun: 0.18, hitstop: 0.05 }),
        }),
      ],
    },
    hook: {
      duration: 0.72,
      cancels: [{ from: 0.36, into: ["dash"] }],
      timeline: [
        spriteAnim({ at: 0, name: "powerPunch" }),
        lungeMove({ from: 0.14, to: 0.38, speed: 620 }),
        hitbox({
          from: 0.212,
          to: 0.36,
          shape: { type: "capsule", halfHeight: 26, radius: 16, axis: "x" },
          offset: { x: 48, y: 0 },
          follow: true,
          hit: byAtk({ damage: 28, knockback: 560, stun: 0.48, hitstop: 0.13 }),
        }),
      ],
    },
  },
};

/** FISTS hold release: keep the same vulnerable charge pose, then cast a
 *  homing fireball. Frame 29 is where the Fireball sheet joins both gloves,
 *  so the projectile appears at the measured per-direction socket there. */
export const FIST_CHARGE: AbilityDef = {
  id: "fists/charge",
  tags: ["charge"],
  entry: { [FIST_RELEASE_INTENT]: "cast" },
  phases: {
    charge: {
      hold: { max: 10 },
      next: "cast",
      on: { [FIST_RELEASE_INTENT]: "cast" },
      timeline: [spriteHold({ from: 0, to: "end", name: "chargeHold" })],
    },
    cast: {
      priority: SUPER_ARMOR_PRIORITY,
      duration: CAST_DURATION,
      cancels: [{ from: CAST_RELEASE_AT, into: ["dash"] }],
      timeline: [
        spriteAnim({ at: 0, name: "cast" }),
        spawn({
          at: CAST_RELEASE_AT,
          entity: HomingFireballProjectile,
          position: (ctx) => castHandPosition(ctx.entity),
          aim: (ctx) => {
            const position = castHandPosition(ctx.entity);
            const target = nearestLivingEnemy(ctx.entity.scene, position);
            return target
              ? target.get(Transform).worldPosition.sub(position).normalize()
              : ctx.entity.get(Facing).unit;
          },
          params: {
            speed: 285,
            lifetime: 3.5,
            shape: { type: "circle", radius: 9 },
          },
          hit: byAtk({
            damage: 30,
            knockback: 460,
            stun: 0.5,
            hitstop: 0.12,
          }),
        }),
      ],
    },
  },
};

/** The KICKS tap-vs-hold charge attack: one def, three phases.
 *
 *  `charge` is the windup hold — `chargeHold`'s single-frame sprite sits on
 *  an open-ended `to: "end"` window until the input driver sends
 *  `kicks/attack-release` on key-up. The active phase handles that intent in
 *  `on:`; the matching `entry:` door can deliver the release after an
 *  interruption. `hold.max` is a generous cap the gesture never reaches in
 *  practice — it exists so a stuck key can't hold the lane forever. No
 *  `priority` on the phase: the windup is staggerable; the bullet-time
 *  lead-in and kick carry super armor once the release commits.
 *
 *  `bulletTime` starts the timed scale request, then waits 0.06 seconds before
 *  entering `kick`. The slowdown therefore has a visible lead instead of
 *  starting after the kick animation. `kick` is the heavy payoff: a bigger
 *  hitbox, more damage, and a longer
 *  stun/knockback than any combo stage, plus the longest recovery in the
 *  kit (~0.41s past the hit). The hold already reads as the windup, so the
 *  kick shouldn't wind up a second time — `spriteAnim`'s `startFrame: 6`
 *  opens HighKick already 6 frames into its own coil (~0.18s of the sheet's
 *  real frames at this speed) instead of at frame 0, and `hitbox.from`/`to`
 *  are shifted back by the same amount so contact still lands on the same
 *  visual extension frame — ~0.18s after release (measured end-to-end from
 *  a real keyup event to the hit landing: ~0.19-0.22s, the extra few ms
 *  being real dispatch/physics-step latency on top of the timeline's own
 *  0.18s). `lockDuration` matches the trimmed total so
 *  `AnimationController.locked` clears on schedule instead of holding for
 *  the un-skipped clip's full length. `lungeMove` covers the kick's drive
 *  (starting a touch before the hitbox opens, closing a touch after it
 *  does) so the heavy release closes distance instead of landing on a
 *  stationary-legged kick — ~72px in free space at this speed (measured
 *  frozen-clock: `Transform` before/after with `scene.timeScale` at 0 and
 *  single `Process` ticks), less against a colliding target the same way
 *  the combo finisher's lunge is. `hitbox`'s `follow: true` keeps the
 *  sensor over the caster through that same travel. */
export const KICK_CHARGE: AbilityDef = {
  id: "kicks/charge",
  tags: ["charge"],
  entry: { [KICK_RELEASE_INTENT]: "bulletTime" },
  phases: {
    charge: {
      hold: { max: 10 },
      next: "bulletTime",
      on: { [KICK_RELEASE_INTENT]: "bulletTime" },
      timeline: [spriteHold({ from: 0, to: "end", name: "chargeHold" })],
    },
    bulletTime: {
      priority: SUPER_ARMOR_PRIORITY,
      duration: 0.08,
      after: { at: 0.06, to: "kick" },
      timeline: [
        slowmo({
          at: 0,
          for: CHARGE_SLOWMO_DURATION,
          scale: CHARGE_SLOWMO_SCALE,
          key: "charge-bullet-time",
        }),
      ],
    },
    kick: {
      priority: SUPER_ARMOR_PRIORITY,
      duration: 0.751,
      cancels: [{ from: 0.337, into: ["dash"] }],
      timeline: [
        spriteAnim({
          at: 0,
          name: "chargeRelease",
          startFrame: 6,
          lockDuration: 0.751,
        }),
        lungeMove({ from: 0.08, to: 0.32, speed: 300 }),
        hitbox({
          from: 0.18,
          to: 0.337,
          shape: { type: "capsule", halfHeight: 34, radius: 24, axis: "x" },
          offset: { x: 60, y: 0 },
          follow: true,
          hit: byAtk({ damage: 32, knockback: 645, stun: 0.55, hitstop: 0.12 }),
        }),
      ],
    },
  },
};

/** Force-only melee response to a successful parry. The short lunge closes
 *  the gap to the attacker before the flying-kick hitbox opens. The parry
 *  itself only negates the incoming hit; this is the single source of the
 *  counter's damage, knockback, and stagger. */
export const COUNTER: AbilityDef = {
  id: "counter",
  priority: SUPER_ARMOR_PRIORITY,
  duration: 0.381,
  timeline: [
    spriteAnim({ at: 0, name: "attack3" }),
    ...invulnerableWithFlash({
      from: 0,
      to: 0.213,
      every: INVULN_FLASH_INTERVAL,
      baseTint: PLAYER_TINT,
    }),
    lungeMove({ from: 0, to: 0.18, speed: 420 }),
    hitbox({
      from: 0.101,
      to: 0.213,
      shape: { type: "capsule", halfHeight: 26, radius: 16, axis: "x" },
      offset: { x: 42, y: 0 },
      follow: true,
      hit: byAtk({ damage: 16, knockback: 420, stun: 0.35, hitstop: 0.08 }),
    }),
  ],
};

export const DASH: AbilityDef = {
  id: "dash",
  cooldown: hasten(1.15),
  duration: 0.36,
  timeline: [
    spriteAnim({ at: 0, name: "dash" }),
    // A brief 0.03s startup before the roll (and its invulnerability) takes
    // over — dash still reads as fast, but doesn't erase input-to-motion
    // entirely — and a ~0.12s landing recovery afterward, so the roll can't
    // be chained frame-perfectly into the next action. `invulnerableWithFlash`
    // pairs the same window with a visible pale strobe (see its doc).
    ...invulnerableWithFlash({
      from: 0.03,
      to: 0.24,
      every: INVULN_FLASH_INTERVAL,
      baseTint: PLAYER_TINT,
    }),
    dashMove({ from: 0.03, to: 0.24, speed: 480 }),
  ],
};

/** Hold-block: a single hold phase that starts the instant the guard key is
 *  pressed and stays open for as long as it's held (`to: "end"` windows on
 *  the elastic phase, completed by the input driver's automatic release on
 *  key-up) — nothing in this def ever forces a higher-priority activation
 *  onto the lane, so the window stays open across as many hits as land
 *  while the key is down. `block` reduces every landed hit in place rather
 *  than negating it: damage and knockback both survive at a fraction
 *  (`damageScale`/`knockbackScale`), and stun stays at its default 0 so a
 *  blocked hit never triggers the stagger reaction. No parry punish — see
 *  `PARRY` below for the tap-release counter-punishing window this cancels
 *  into. The input driver owns the press/tap/release gesture. */
export const GUARD_HOLD_ID = "guardHold";
export const GUARD_HOLD: AbilityDef = {
  id: GUARD_HOLD_ID,
  cooldown: hasten(0.4),
  phases: {
    hold: {
      hold: true,
      timeline: [
        spriteHold({ from: 0, to: "end", name: "guard" }),
        block({ from: 0, to: "end", damageScale: 0.3, knockbackScale: 0.4 }),
      ],
    },
  },
};

/** A quick guard release opens a full-negate parry window. `HitGuarded`
 *  starts either the melee `COUNTER` or a projectile reflection; the guard
 *  has no separate punish delivery, so the response cannot damage or stagger
 *  an attacker before its matching animation and hitbox. */
export const PARRY_ID = "parry";
export const PARRY_ACTIVE_WINDOW = 0.35;
export const PARRY: AbilityDef = {
  id: PARRY_ID,
  cooldown: hasten(0.85),
  duration: 0.44,
  timeline: [
    spriteHold({ from: 0, to: PARRY_ACTIVE_WINDOW, name: "guard" }),
    parry({ from: 0, to: PARRY_ACTIVE_WINDOW }),
  ],
};

/** Item-lane: plays concurrently with whatever the main lane is doing
 *  (attacking, dashing, even stunned) — that's the point of the lane. The
 *  explicit duration roughly matches the drink animation's own length. */
export const POTION: AbilityDef = {
  id: "potion",
  lane: "item",
  cooldown: hasten(5),
  duration: 0.85,
  timeline: [
    heal({ at: 0, amount: 30 }),
    spriteAnim({ at: 0, name: "potion" }),
  ],
};

/** KICKS 1-2-3 combo: trim the run-up from FrontKick and the opening coil
 *  from HighKick, then finish with the former combo's full FlyingKick lunge. */
export const KICK_COMBO: AbilityDef = {
  id: KICK_ATTACK_INTENT,
  priority: SUPER_ARMOR_PRIORITY,
  phases: {
    front: {
      duration: 0.65,
      on: {
        [KICK_ATTACK_INTENT]: {
          to: "high",
          from: "end",
          for: COMBO_WINDOW,
        },
      },
      cancels: [{ from: 0.34, into: ["dash"] }],
      timeline: [
        spriteAnim({ at: 0, name: "melee", startFrame: 7, lockDuration: 0.65 }),
        lungeMove({ from: 0.1, to: 0.34, speed: 240 }),
        hitbox({
          from: 0.17,
          to: 0.34,
          shape: { type: "capsule", halfHeight: 26, radius: 16, axis: "x" },
          offset: { x: 47, y: 0 },
          follow: true,
          hit: byAtk({ damage: 10, knockback: 250, stun: 0.17, hitstop: 0.05 }),
        }),
      ],
    },
    high: {
      duration: 0.66,
      on: {
        [KICK_ATTACK_INTENT]: {
          to: "flying",
          from: "end",
          for: COMBO_WINDOW,
        },
      },
      cancels: [{ from: 0.34, into: ["dash"] }],
      timeline: [
        spriteAnim({
          at: 0,
          name: "chargeRelease",
          startFrame: 6,
          lockDuration: 0.66,
        }),
        lungeMove({ from: 0.1, to: 0.34, speed: 270 }),
        hitbox({
          from: 0.18,
          to: 0.34,
          shape: { type: "capsule", halfHeight: 30, radius: 18, axis: "x" },
          offset: { x: 50, y: 0 },
          follow: true,
          hit: byAtk({ damage: 13, knockback: 300, stun: 0.2, hitstop: 0.06 }),
        }),
      ],
    },
    flying: {
      duration: 1.12,
      cancels: [{ from: 0.515, into: ["dash"] }],
      timeline: [
        spriteAnim({ at: 0, name: "attack3" }),
        lungeMove({ from: 0.32, to: 0.54, speed: 820 }),
        hitbox({
          from: 0.403,
          to: 0.515,
          shape: { type: "capsule", halfHeight: 26, radius: 16, axis: "x" },
          offset: { x: 46, y: 0 },
          follow: true,
          hit: byAtk({ damage: 26, knockback: 530, stun: 0.45, hitstop: 0.12 }),
        }),
      ],
    },
  },
};

export interface PlayerLoadout {
  readonly name: string;
  readonly attackIntent: string;
  readonly charge: AbilityDef;
  readonly releaseIntent: string;
  readonly defs: readonly AbilityDef[];
}

export const PLAYER_LOADOUTS: readonly PlayerLoadout[] = [
  {
    name: "FISTS",
    attackIntent: FIST_ATTACK_INTENT,
    charge: FIST_CHARGE,
    releaseIntent: FIST_RELEASE_INTENT,
    defs: [FIST_COMBO, FIST_CHARGE, DASH, GUARD_HOLD, PARRY, POTION],
  },
  {
    name: "KICKS",
    attackIntent: KICK_ATTACK_INTENT,
    charge: KICK_CHARGE,
    releaseIntent: KICK_RELEASE_INTENT,
    defs: [KICK_COMBO, KICK_CHARGE, DASH, GUARD_HOLD, PARRY, POTION],
  },
];

/** The player abilities that share the attack hotbar slot, keyed by id.
 *  `attackSlotState` only checks id membership against this table; it reads
 *  the active run's `phaseElapsed`/`phaseDuration` off
 *  `Abilities.active("main")`. */
export const PLAYER_MAIN_DEFS: Readonly<Record<string, AbilityDef>> = {
  [FIST_COMBO.id]: FIST_COMBO,
  [FIST_CHARGE.id]: FIST_CHARGE,
  [KICK_COMBO.id]: KICK_COMBO,
  [KICK_CHARGE.id]: KICK_CHARGE,
  [COUNTER.id]: COUNTER,
};
