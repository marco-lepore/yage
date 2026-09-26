import { Component, Transform, Vec2 } from "@yagejs/core";
import type { Entity, SceneTime } from "@yagejs/core";
import { AnimatedSpriteComponent } from "@yagejs/renderer";
import { RigidBodyComponent } from "@yagejs/physics";
import {
  Facing,
  Health,
  defineStep,
  invulnerable,
} from "@yagejs-addons/abilities";
import type { WindowStep } from "@yagejs-addons/abilities";
import { playBoxerAnim } from "./boxer-sprites.js";
import type { BoxerAnim } from "./boxer-sprites.js";
import { INVULN_FLASH_TINT, fxOf } from "./feedback.js";

// ---------------------------------------------------------------------------
// Game-defined steps — the extension mechanism `defineStep` is meant for.
// None of these belong in the addon: dashing is movement, healing is an
// item, sprite animation is a presentation choice the addon can't see, and
// the enemy windup tell is bespoke game feel.
// ---------------------------------------------------------------------------

/** Physics has no per-entity time exclusions (one shared Rapier world), so
 *  an entity excluded from a slowmo channel still integrates its velocity at
 *  the slowed world rate. Velocity writes multiply by this ratio — the
 *  entity's update speed over the world's physics speed — so an excluded
 *  entity covers ground at its own unslowed pace. 1 for entities the slowmo
 *  applies to and whenever no slowmo is active; 1 while frozen too (nothing
 *  integrates, and it avoids dividing by zero). */
export function slowmoVelocityCompensation(
  time: SceneTime,
  entity: Entity,
): number {
  const world = time.effectiveScale;
  if (world <= 0) return 1;
  return time.effectiveScaleForUpdates(entity) / world;
}

/** Builds a step that owns the body's velocity for its window, in the
 *  caster's `Facing`, at a fixed speed — the mechanism shared by `dashMove`
 *  (the dash roll), `lungeMove` (the combo finisher's forward kick), and
 *  `punchMove` (the jabs' forward step). All three share the `velocity`
 *  kind so presenters can query ownership through the active activation. */
export function velocityStep() {
  return defineStep<{ speed: number }>("velocity", {
    enter(params, ctx) {
      const facing = ctx.entity.get(Facing);
      const speed =
        params.speed * slowmoVelocityCompensation(ctx.time, ctx.entity);
      ctx.entity.get(RigidBodyComponent).setVelocity(facing.unit.scale(speed));
    },
    exit(_params, ctx) {
      ctx.entity.get(RigidBodyComponent).setVelocity(Vec2.ZERO);
    },
  });
}

export const dashMove = velocityStep();
/** A forward lunge — both combo finishers and the charge kick ride this step
 *  kind at
 *  their own speed/window. */
export const lungeMove = velocityStep();
/** The fist combo's first two punches step forward through this window. */
export const punchMove = velocityStep();

/** A point step: restore HP through the sibling `Health`. */
export const heal = defineStep<{ amount: number }>("heal", {
  fire(params, ctx) {
    ctx.entity.get(Health).heal(params.amount);
  },
});

/** Point step: plays a one-shot boxer animation, direction-aware. The
 *  sibling `AnimationController` (built by `buildBoxerAnimDefs`) must
 *  include `name` for every direction. `startFrame`/`lockDuration` are the
 *  windup-skip escape hatch `CHARGE_RELEASE` uses — see `playBoxerAnim`. */
export const spriteAnim = defineStep<{
  name: BoxerAnim;
  startFrame?: number;
  lockDuration?: number;
}>("spriteAnim", {
  fire(params, ctx) {
    playBoxerAnim(ctx.entity, params.name, {
      oneShot: true,
      ...(params.startFrame !== undefined
        ? { startFrame: params.startFrame }
        : {}),
      ...(params.lockDuration !== undefined
        ? { lockDuration: params.lockDuration }
        : {}),
    });
  },
});

/** Window step: holds a boxer animation (its first frame, for the one-frame
 *  `guard`/`chargeHold` stand-ins) for the window's duration. Used where an
 *  ability needs a sustained pose rather than a one-shot. */
export const spriteHold = defineStep<{ name: BoxerAnim }>("spriteHold", {
  enter(params, ctx) {
    playBoxerAnim(ctx.entity, params.name, { oneShot: false });
  },
});

export const TELEGRAPH_TINT = 0xfff2a8;

/** Window step spanning an enemy attack's windup: tints the sprite a
 *  warning color for the whole span (restored to `baseTint` on exit) and
 *  bursts "charging" particles on enter and every `every` tick — the
 *  player's visual cue to dash or guard before the attack goes active. */
export const telegraph = defineStep<{ baseTint: number; burstCount?: number }>(
  "telegraph",
  {
    enter(params, ctx) {
      ctx.entity.get(AnimatedSpriteComponent).tint = TELEGRAPH_TINT;
      fxOf(ctx.entity).chargeBurst(
        ctx.entity.get(Transform).worldPosition,
        params.burstCount ?? 10,
      );
    },
    tick(params, ctx) {
      fxOf(ctx.entity).chargeBurst(
        ctx.entity.get(Transform).worldPosition,
        Math.round((params.burstCount ?? 10) / 2),
      );
    },
    exit(params, ctx) {
      ctx.entity.get(AnimatedSpriteComponent).tint = params.baseTint;
    },
  },
);

/** Strobe phase of the `invulnFlash` step, toggled on each tick. Add it to
 *  every entity whose ability defs use `invulnFlash`. */
export class InvulnFlashStrobe extends Component {
  on = false;
}

/** Window step: strobes the sprite between `baseTint` and the pale
 *  `INVULN_FLASH_TINT` for its span. Paired at the *same* `from`/`to` as an
 *  `invulnerable` window on the same def (`DASH`, `COUNTER`) so a
 *  def-authored invulnerability window is visually legible, not just
 *  mechanical — `runInvulnFlash` is the post-hit i-frame twin, whose
 *  duration isn't a timeline window so it can't use `enter`/`tick`/`exit`. */
export const invulnFlash = defineStep<{ baseTint: number }>("invulnFlash", {
  enter(_params, ctx) {
    ctx.entity.get(InvulnFlashStrobe).on = true;
    ctx.entity.get(AnimatedSpriteComponent).tint = INVULN_FLASH_TINT;
  },
  tick(params, ctx) {
    const strobe = ctx.entity.get(InvulnFlashStrobe);
    strobe.on = !strobe.on;
    ctx.entity.get(AnimatedSpriteComponent).tint = strobe.on
      ? INVULN_FLASH_TINT
      : params.baseTint;
  },
  exit(params, ctx) {
    ctx.entity.get(InvulnFlashStrobe).on = false;
    ctx.entity.get(AnimatedSpriteComponent).tint = params.baseTint;
  },
});

/** Pairs `invulnerable` with `invulnFlash` at identical `from`/`to`/`every`,
 *  so a def author can't let the mechanical window and its visual drift
 *  apart the way two independently-authored steps could. */
export function invulnerableWithFlash(args: {
  from: number;
  to: number;
  every?: number;
  baseTint: number;
}): readonly [WindowStep<object>, WindowStep<{ baseTint: number }>] {
  const { baseTint, ...window } = args;
  return [invulnerable(window), invulnFlash({ ...window, baseTint })];
}
