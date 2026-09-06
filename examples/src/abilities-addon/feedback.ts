import { Process, Transform } from "@yagejs/core";
import type { Entity, ProcessComponent, Scene, Vec2 } from "@yagejs/core";
import { AnimatedSpriteComponent, RendererKey } from "@yagejs/renderer";
import type { CameraEntity, GraphicsComponent } from "@yagejs/renderer";
import { ParticleEmitterComponent, ParticlePresets } from "@yagejs/particles";
import { AudioManagerKey, sound } from "@yagejs/audio";
import { HitReceiver } from "@yagejs-addons/abilities";
import type { Hit } from "@yagejs-addons/abilities";
import {
  BODY_COLLIDER_RADIUS,
  HP_BAR_HEIGHT,
  HP_BAR_TOP,
  HP_BAR_WIDTH,
  playStaggerAnim,
} from "./boxer-sprites.js";
import type { AbilitiesDemoScene } from "./scene.js";

export const FLASH_TINT = 0xff5a5a;
export const FLASH_DURATION = 0.08;
export const ATTACKER_FLASH_TINT = 0xffffff;
export const ATTACKER_FLASH_DURATION = 0.06;

/** Coarse weight classes driving camera shake, the attacker flash, and
 *  impact-burst size, all derived from the landed hit's damage — see
 *  `damageWeight`. */
export type HitWeight = "light" | "medium" | "heavy";

/** Weight class from the landed hit's raw damage — the single "how hard did
 *  this land" signal, read both victim-side (impact-burst size) and
 *  attacker-side (camera shake / flash). */
export function damageWeight(damage: number): HitWeight {
  if (damage >= 25) return "heavy";
  if (damage >= 14) return "medium";
  return "light";
}

export const IMPACT_BURST_COUNT: Record<HitWeight, number> = {
  light: 12,
  medium: 22,
  heavy: 38,
};

/** Pale strobe marking invulnerability from any source — distinct from both
 *  combatants' base tints (pure white for the player, a pink cast for
 *  enemies) so it reads even against the player's already-white sprite,
 *  and from the red damage flash / cyan block flash it never overlaps with
 *  (see `runInvulnFlash`'s doc). */
export const INVULN_FLASH_TINT = 0xeaffff;
export const INVULN_FLASH_INTERVAL = 0.07;

/** Runs the invulnerability strobe on `entity`'s sprite for `duration`
 *  seconds, restoring `baseTint` when it ends — the post-hit i-frame half of
 *  the invulnerability flash (see `reactToHit`/`reactToBlockedHit`, which
 *  read `HitReceiver.iframesRemaining` for `duration`). The def-authored
 *  half (dash, the parry counter) is the `invulnFlash` window step below
 *  instead, since those durations are already timeline windows with their
 *  own `enter`/`tick`/`exit`. No-ops for a non-positive duration (a receiver
 *  with no i-frames configured). */
export function runInvulnFlash(
  entity: Entity,
  pc: ProcessComponent,
  baseTint: number,
  duration: number,
): void {
  if (duration <= 0) return;
  const sprite = entity.get(AnimatedSpriteComponent).animatedSprite;
  pc.run(
    new Process({
      duration,
      update: (_dt, elapsed) => {
        const on = Math.floor(elapsed / INVULN_FLASH_INTERVAL) % 2 === 0;
        sprite.tint = on ? INVULN_FLASH_TINT : baseTint;
      },
      onComplete: () => {
        sprite.tint = baseTint;
      },
    }),
  );
}

/** Approximates the world-space impact point: the spot on the victim's
 *  body-collider circle facing wherever the hit came from. `Hit` carries no
 *  impact position of its own, but `hit.direction`
 *  already IS the unit vector from that origin toward the victim, resolved
 *  at delivery time against the actual attacking collider's position (the
 *  hitbox's spawn point for a melee swing, the projectile's own position at
 *  contact for a projectile — not `hit.source`'s position, which for a
 *  projectile is the caster who fired it, long gone from the impact site).
 *  Walking back from the collider center by the radius along `-direction`
 *  lands on the struck side without ever needing the source entity's own
 *  position. */
export function contactPoint(entity: Entity, hit: Hit): Vec2 {
  const bodyCenter = entity.get(Transform).worldPosition;
  return bodyCenter.sub(hit.direction.scale(BODY_COLLIDER_RADIUS));
}

/** Shared hit-reaction: the stagger pose, a brief tint flash back to
 *  `baseTint`, an impact particle burst sized by the hit's damage, and a hit
 *  thock — positioned at the struck side of the body (see `contactPoint`)
 *  rather than the entity's own anchor — all timed on the entity's own
 *  `ProcessComponent` (so the flash freezes along with everything else
 *  during hitstop rather than ticking through it). Used by both
 *  `PlayerController` and `EnemyAI`'s `HitReceived` listeners. */
export function reactToHit(
  entity: Entity,
  pc: ProcessComponent,
  baseTint: number,
  hit: Hit,
): void {
  playStaggerAnim(entity, hit.data.stun ?? 0.2);
  const sprite = entity.get(AnimatedSpriteComponent).animatedSprite;
  sprite.tint = FLASH_TINT;
  pc.run(
    Process.delay(FLASH_DURATION, () => {
      sprite.tint = baseTint;
      // Hand off to the invulnerability strobe for whatever's left of the
      // i-frame window this hit just armed (read fresh here, after the red
      // flash's own delay, so the two never fight for the sprite's tint).
      runInvulnFlash(
        entity,
        pc,
        baseTint,
        entity.get(HitReceiver).iframesRemaining,
      );
    }),
  );
  const weight = damageWeight(hit.data.damage ?? 0);
  fxOf(entity).impactBurst(
    contactPoint(entity, hit),
    IMPACT_BURST_COUNT[weight],
  );
  playHitSfx(entity);
}

/** Lighter counterpart to `reactToHit` for a hold-block's reduced hit (the
 *  `"modified"` guard verdict — see `GUARD_HOLD`): a brief cool-toned flash
 *  and a small burst instead of the full stagger-flinch animation, so
 *  absorbing a hit reads as "blocked calmly" rather than "hit" — the guard
 *  pose stays on screen throughout. Only `PlayerController` currently uses
 *  this (enemies never guard). */
export const BLOCK_FLASH_TINT = 0x93f7ff;
export const BLOCK_FLASH_DURATION = 0.06;
export const BLOCK_BURST_COUNT = 8;

export function reactToBlockedHit(
  entity: Entity,
  pc: ProcessComponent,
  baseTint: number,
  hit: Hit,
): void {
  const sprite = entity.get(AnimatedSpriteComponent).animatedSprite;
  sprite.tint = BLOCK_FLASH_TINT;
  pc.run(
    Process.delay(BLOCK_FLASH_DURATION, () => {
      sprite.tint = baseTint;
      // A hold-block's "modified" verdict still ends in a `"hit"` result
      // (see `GUARD_HOLD`), so `HitReceiver` still arms its post-hit
      // i-frames — same hand-off as `reactToHit`.
      runInvulnFlash(
        entity,
        pc,
        baseTint,
        entity.get(HitReceiver).iframesRemaining,
      );
    }),
  );
  fxOf(entity).impactBurst(contactPoint(entity, hit), BLOCK_BURST_COUNT);
  playBlockSfx(entity);
}

/** A brief white flash on the attacker for a heavy landed hit — separate
 *  from the victim's red `reactToHit` flash, and skipped for light taps so
 *  a fast combo doesn't strobe. */
export function flashAttacker(
  entity: Entity,
  pc: ProcessComponent,
  baseTint: number,
): void {
  const sprite = entity.get(AnimatedSpriteComponent).animatedSprite;
  sprite.tint = ATTACKER_FLASH_TINT;
  pc.run(
    Process.delay(ATTACKER_FLASH_DURATION, () => {
      sprite.tint = baseTint;
    }),
  );
}

// ---------------------------------------------------------------------------
// VFX hub — three scene-wide particle emitters (impact / charge / parry), shared
// by every combatant: `burst()` takes
// explicit world coordinates, so a single emitter can fire at any position
// without tracking a sibling Transform. The player's own charge-hold visual
// uses a local emitter on `PlayerController`, so this hub's `charge` emitter is
// used only for `chargeBurst`'s one-shot bursts (the enemy melee/cast
// telegraph's "energy building" tell).
// ---------------------------------------------------------------------------

export class VfxHub {
  constructor(
    private readonly impact: ParticleEmitterComponent,
    private readonly charge: ParticleEmitterComponent,
    private readonly parry: ParticleEmitterComponent,
  ) {}

  impactBurst(pos: Vec2, count: number): void {
    this.impact.burst(count, pos.x, pos.y);
  }

  /** The enemy melee/cast telegraph's periodic "energy building" bursts. */
  chargeBurst(pos: Vec2, count: number): void {
    this.charge.burst(count, pos.x, pos.y);
  }

  parrySpark(pos: Vec2): void {
    this.parry.burst(18, pos.x, pos.y);
  }
}

export function createVfxHub(scene: Scene): VfxHub {
  const tex = scene.context.resolve(RendererKey).createTexture((g) => {
    g.circle(0, 0, 6).fill({ color: 0xffffff });
  });

  const impactEntity = scene.spawn("fx-impact");
  impactEntity.add(new Transform());
  const impact = impactEntity.add(
    new ParticleEmitterComponent({
      ...ParticlePresets.sparks(tex),
      tint: 0xffb454,
      maxParticles: 220,
      lifetime: [0.16, 0.32],
    }),
  );

  const chargeEntity = scene.spawn("fx-charge");
  chargeEntity.add(new Transform());
  const charge = chargeEntity.add(
    new ParticleEmitterComponent({
      ...ParticlePresets.fire(tex),
      tint: 0xffe066,
      maxParticles: 150,
      rate: 28,
    }),
  );

  const parryEntity = scene.spawn("fx-parry");
  parryEntity.add(new Transform());
  const parry = parryEntity.add(
    new ParticleEmitterComponent({
      ...ParticlePresets.sparks(tex),
      tint: 0x93f7ff,
      maxParticles: 60,
      lifetime: [0.15, 0.3],
      speed: [220, 380],
    }),
  );

  return new VfxHub(impact, charge, parry);
}

export function fxOf(entity: Entity): VfxHub {
  return (entity.scene as AbilitiesDemoScene).fx;
}

export function cameraOf(entity: Entity): CameraEntity {
  return (entity.scene as AbilitiesDemoScene).camera;
}

// ---------------------------------------------------------------------------
// SFX — three CC0 wavs (see `examples/public/assets/CREDITS.md`) doing the
// job of five cues: a hit thock (`hurt.wav`) on every landed/blocked hit, the
// same clip pitched up as a bright "ring" on a successful parry (no bespoke
// parry asset exists in the pack), a muted thud (`land.wav`) reused for a
// blocked hit's duller impact, and `explosion.wav` for a death beat.
// ---------------------------------------------------------------------------

export const HitSfx = sound("/assets/hurt.wav");
export const BlockSfx = sound("/assets/land.wav");
export const DeathSfx = sound("/assets/explosion.wav");

export function playHitSfx(
  entity: Entity,
  options?: { speed?: number; volume?: number },
): void {
  entity.scene.context.resolve(AudioManagerKey).play(HitSfx.path, {
    channel: "sfx",
    speed: options?.speed ?? 1,
    volume: options?.volume ?? 0.7,
  });
}

export function playBlockSfx(entity: Entity): void {
  entity.scene.context
    .resolve(AudioManagerKey)
    .play(BlockSfx.path, { channel: "sfx", volume: 0.5 });
}

export function playDeathSfx(entity: Entity): void {
  entity.scene.context
    .resolve(AudioManagerKey)
    .play(DeathSfx.path, { channel: "sfx", volume: 0.55 });
}

/** Camera-shake profile per landed-hit weight — a heavier hit shakes harder
 *  and longer. Keyed off `damageWeight(hit.damage)` in the attacker's
 *  `HitDealt` listener; light taps skip the shake entirely (no `"light"`
 *  entry). Camera shake stays game-side feedback — the addon ships only the
 *  freeze frame (`hit.hitstop` → `SceneTime.freezeFor`). */
export const SHAKE_BY_WEIGHT: Record<
  "medium" | "heavy",
  { intensity: number; duration: number }
> = {
  medium: { intensity: 5, duration: 0.12 },
  heavy: { intensity: 9, duration: 0.18 },
};

// ---------------------------------------------------------------------------
// Shared HP bar
// ---------------------------------------------------------------------------

export function drawHealthBar(
  gfx: GraphicsComponent,
  hpFrac: number,
  color: number,
): void {
  const frac = Math.max(0, hpFrac);
  gfx.graphics
    .clear()
    .rect(-HP_BAR_WIDTH / 2, HP_BAR_TOP, HP_BAR_WIDTH, HP_BAR_HEIGHT)
    .fill({ color: 0x1e293b })
    .rect(-HP_BAR_WIDTH / 2, HP_BAR_TOP, HP_BAR_WIDTH * frac, HP_BAR_HEIGHT)
    .fill({ color });
}
