import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  trait,
} from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import {
  AnimatedSpriteComponent,
  AnimationController,
  GraphicsComponent,
} from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import {
  Abilities,
  AbilityEnded,
  Facing,
  Health,
  HealthDied,
  HitReceived,
  HitReceiver,
  Hittable,
  Projectile,
  Stagger,
  hitbox,
  spawn,
} from "@yagejs-addons/abilities";
import type {
  AbilityDef,
  AbilitySpawnContext,
  Hit,
  HitResult,
  ProjectileConfig,
} from "@yagejs-addons/abilities";
import {
  CORPSE_LINGER,
  ENEMY_FAR_RANGE,
  ENEMY_MELEE_RANGE,
  ENEMY_SPEED,
  ENEMY_TINT,
  ORBIT_BACKOFF_RANGE,
  ORBIT_MAX_RANGE,
  ORBIT_MIN_RANGE,
  ORBIT_SEPARATION_RANGE,
  ORBIT_SPEED_MULT,
  TOKEN_HANDOFF_PAUSE,
} from "./constants.js";
import {
  BODY_COLLIDER_RADIUS,
  CAST_DURATION,
  CAST_RELEASE_AT,
  DEFAULT_DIR,
  ENEMY_ANIMS,
  SPRITE_ANCHOR,
  SPRITE_SCALE,
  buildBoxerAnimDefs,
  castHandPosition,
  BoxerFootAnchorTracking,
  playBoxerAnim,
  sourceFor,
} from "./boxer-sprites.js";
import { spriteAnim, telegraph } from "./steps.js";
import {
  cameraOf,
  drawHealthBar,
  playDeathSfx,
  reactToHit,
} from "./feedback.js";
import { pushMaxHp } from "./stats.js";
import type { StatKind, Stats } from "./stats.js";
import type { AbilitiesDemoScene } from "./scene.js";

// ---------------------------------------------------------------------------
// Engagement token — at most one enemy "holds" it and is allowed to close to
// melee range / cast a fireball; every other `EnemyAI` orbits/strafes
// instead (see `EnemyAI.reposition`), so the player faces one clear threat
// at a time rather than every enemy converging at once. A scene-wide
// Component (spawned once in `onEnter`, alongside the VFX hub) rather than
// per-enemy state, since "who's engaging" is inherently a single shared
// answer. Auto-assigns to the living enemy nearest the player once free and
// past its handoff pause — `EnemyAI` never claims the token itself, only
// releases it.
// ---------------------------------------------------------------------------

export class EngagementToken extends Component {
  private holder: Entity | null = null;
  private handoffPause = 0;

  hasToken(entity: Entity): boolean {
    return this.holder === entity;
  }

  /** True while the token is free but not yet reassigned — the beat
   *  between one enemy's attack recovering and the next one engaging.
   *  `EnemyAI.reposition` reads this to add a brief outward "backing off"
   *  push on top of the normal orbit. */
  get isHandoffPause(): boolean {
    return this.holder === null && this.handoffPause > 0;
  }

  /** Frees the token; `update` won't reassign it until `TOKEN_HANDOFF_PAUSE`
   *  seconds pass, so attacks don't chain back-to-back with no visible gap. */
  release(entity: Entity): void {
    if (this.holder !== entity) return;
    this.holder = null;
    this.handoffPause = TOKEN_HANDOFF_PAUSE;
  }

  /** Drops a dead/removed holder immediately, skipping the handoff pause —
   *  nothing is "recovering" from an attack a death already interrupted. */
  clear(entity: Entity): void {
    if (this.holder === entity) this.holder = null;
  }

  update(dt: number): void {
    if (this.handoffPause > 0) {
      this.handoffPause = Math.max(0, this.handoffPause - dt);
      return;
    }
    if (this.holder) return;
    const player = this.scene.findEntity("PlayerEntity");
    if (!player || (player.tryGet(Health)?.isDead ?? true)) return;
    const playerPos = player.get(Transform).worldPosition;

    let nearest: Entity | null = null;
    let nearestDist = Infinity;
    for (const entity of this.scene.getEntities()) {
      if (!entity.tags.has("enemy") || (entity.tryGet(Health)?.isDead ?? true))
        continue;
      const dist = entity.get(Transform).worldPosition.sub(playerPos).length();
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = entity;
      }
    }
    this.holder = nearest;
  }
}

export function tokenOf(entity: Entity): EngagementToken {
  return (entity.scene as AbilitiesDemoScene).token;
}

/** Enemy melee: `FrontKick`'s own run-up-and-kick cycle doubles as the
 *  windup — the `telegraph` step covers the run-in and knee-raise (the
 *  coil), ending right as the hitbox opens on the leg's extension.
 *  Recovery runs well past the kick landing (~0.64s), leaving a clearly
 *  punishable enemy on a whiff or a parry. No `priority` (default 0, below
 *  `REACTION_PRIORITY`): unlike the player's own attacks, a landed hit
 *  always interrupts this — punishing the telegraph stops the kick outright
 *  instead of only trading damage for damage (see the ability-defs section
 *  doc above). Cooldown raised from 1.3s alongside the engagement-token
 *  handoff pause (`TOKEN_HANDOFF_PAUSE`) to slow the overall attack rate —
 *  see `EnemyAI`. */
export const MELEE: AbilityDef = {
  id: "melee",
  cooldown: 1.6,
  duration: 1.176,
  timeline: [
    spriteAnim({ at: 0, name: "melee" }),
    telegraph({
      from: 0,
      to: 0.437,
      every: 0.168,
      baseTint: ENEMY_TINT,
      burstCount: 8,
    }),
    hitbox({
      from: 0.437,
      to: 0.538,
      shape: { type: "capsule", halfHeight: 24, radius: 15, axis: "x" },
      offset: { x: 48, y: 0 },
      hit: { damage: 12, knockback: 280, stun: 0.35 },
    }),
  ],
};

export class FireballProjectile extends Projectile {
  override setup(context: AbilitySpawnContext<ProjectileConfig>): void {
    super.setup(context);
    this.add(
      new GraphicsComponent().draw((graphics) => {
        graphics.circle(0, 0, 7).fill({ color: 0xfb923c });
        graphics.circle(0, 0, 3.5).fill({ color: 0xfde68a });
      }),
    );
  }
}

/** Ranged enemy attack. Frame 29 is the first frame where the Fireball
 *  animation's gloves meet, so the telegraph ends and the projectile appears
 *  at that exact frame. The ability remains active through the follow-through
 *  to keep the caster planted. */
export const SHOOT: AbilityDef = {
  id: "shoot",
  cooldown: 2,
  duration: CAST_DURATION,
  timeline: [
    spriteAnim({ at: 0, name: "cast" }),
    telegraph({
      from: 0,
      to: CAST_RELEASE_AT,
      every: 0.16,
      baseTint: ENEMY_TINT,
      burstCount: 7,
    }),
    spawn({
      at: CAST_RELEASE_AT,
      entity: FireballProjectile,
      position: (ctx) => castHandPosition(ctx.entity),
      aim: (ctx) => {
        const target = ctx.entity.scene.findEntity("PlayerEntity");
        if (!target) {
          throw new Error('SHOOT: target "PlayerEntity" was not found.');
        }
        return target
          .get(Transform)
          .worldPosition.sub(castHandPosition(ctx.entity))
          .normalize();
      },
      params: {
        speed: 240,
        lifetime: 2.5,
        shape: { type: "circle", radius: 7 },
      },
      hit: { damage: 10, knockback: 180, stun: 0.3 },
    }),
  ],
};

// ---------------------------------------------------------------------------
// Enemy
// ---------------------------------------------------------------------------

export class EnemyAI extends Component {
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly transform = this.sibling(Transform);
  private readonly facing = this.sibling(Facing);
  private readonly abilities = this.sibling(Abilities);
  private readonly anim = this.sibling(AnimationController);
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly health = this.sibling(Health);
  private readonly pc = this.sibling(ProcessComponent);
  private readonly stagger = this.sibling(Stagger);

  // Orbit phase for non-token repositioning — randomized per enemy so
  // circlers spread around the player instead of stacking on one spot.
  private readonly orbitDir = Math.random() < 0.5 ? 1 : -1;

  onAdd(): void {
    this.listen(this.entity, HealthDied, () => this.die());
    this.listen(this.entity, HitReceived, ({ hit }) =>
      reactToHit(this.entity, this.pc, ENEMY_TINT, hit),
    );
    // Releases the engagement token the instant my own "main" lane ability
    // ends, for any reason (recovers naturally, gets interrupted) — filtered
    // to that lane, since `melee`/`shoot`/the forced stagger reaction are
    // the only things this token tracks. `release` is a no-op unless I'm the
    // current holder, so this doesn't need to track whether I was engaging.
    this.listen(this.entity, AbilityEnded, ({ activation }) => {
      if (activation.lane !== "main") return;
      tokenOf(this.entity).release(this.entity);
    });
  }

  update(): void {
    const token = tokenOf(this.entity);
    const holdsToken = token.hasToken(this.entity);
    const mainBusy = this.abilities.isActive("main");

    const player = this.scene.findEntity("PlayerEntity");
    const playerDead = player?.tryGet(Health)?.isDead ?? true;
    if (!player || playerDead || mainBusy) {
      // No target, or mid-cast/melee/stagger: plant and let the current
      // animation (idle, or the locked one-shot) play out — this is what
      // keeps an attack pose held through its whole windup/recovery instead
      // of the movement logic below snapping it back to run/idle mid-attack.
      // Mid-cast/melee/stagger also needs to actively zero any velocity the
      // movement logic left behind (otherwise the enemy keeps sliding in its
      // last direction through the whole windup) — except while `Stagger`'s
      // own knockback ramp owns velocity.
      if (mainBusy) {
        if (!this.stagger.active) this.rb.setVelocity(Vec2.ZERO);
      } else {
        this.rb.setVelocity(Vec2.ZERO);
        if (!this.anim.locked)
          playBoxerAnim(this.entity, "idle", { oneShot: false });
      }
      this.redraw();
      return;
    }

    const toPlayer = player
      .get(Transform)
      .worldPosition.sub(this.transform.worldPosition);
    const dist = toPlayer.length();
    this.facing.set(toPlayer.x, toPlayer.y);

    let moving: boolean;
    if (holdsToken) {
      moving = this.engage(toPlayer, dist);
    } else {
      moving = this.reposition(token, toPlayer, dist);
    }

    if (!this.anim.locked) {
      playBoxerAnim(this.entity, moving ? "run" : "idle", { oneShot: false });
    }

    this.redraw();
  }

  /** The token holder's behavior — unchanged from before the engagement
   *  token existed: close to melee range, hold at mid-range to close in, or
   *  hang back and cast. Returns whether it moved (for the run/idle pick). */
  private engage(toPlayer: Vec2, dist: number): boolean {
    if (dist <= ENEMY_MELEE_RANGE) {
      this.rb.setVelocity(Vec2.ZERO);
      this.abilities.send("melee"); // no-ops (stands its ground) while on cooldown
      return false;
    }
    if (dist <= ENEMY_FAR_RANGE) {
      this.rb.setVelocity(toPlayer.normalize().scale(ENEMY_SPEED));
      return true;
    }
    this.rb.setVelocity(Vec2.ZERO);
    this.abilities.send("shoot");
    return false;
  }

  /** Non-token behavior: orbit/strafe the player within `ORBIT_MIN_RANGE`..
   *  `ORBIT_MAX_RANGE`, separating from other enemies so circlers don't
   *  stack, and stepping back a bit further during the token's handoff
   *  pause (the beat right after the current attacker recovers). Returns
   *  whether it moved. */
  private reposition(
    token: EngagementToken,
    toPlayer: Vec2,
    dist: number,
  ): boolean {
    const inward = toPlayer.normalize(); // unit vector toward the player
    const tangent = new Vec2(-inward.y, inward.x).scale(this.orbitDir);

    const backoff = token.isHandoffPause ? ORBIT_BACKOFF_RANGE : 0;
    let radial = Vec2.ZERO;
    if (dist < ORBIT_MIN_RANGE + backoff) radial = inward.scale(-1);
    else if (dist > ORBIT_MAX_RANGE + backoff) radial = inward;

    let separation = Vec2.ZERO;
    for (const other of this.scene.getEntities()) {
      if (other === this.entity || !other.tags.has("enemy")) continue;
      const otherPos = other.tryGet(Transform)?.worldPosition;
      if (!otherPos) continue;
      const away = this.transform.worldPosition.sub(otherPos);
      const away2 = away.length();
      if (away2 > 0 && away2 < ORBIT_SEPARATION_RANGE) {
        separation = separation.add(
          away.scale((ORBIT_SEPARATION_RANGE - away2) / away2),
        );
      }
    }

    const dir = tangent
      .scale(0.7)
      .add(radial.scale(0.7))
      .add(separation.scale(0.05));
    if (dir.lengthSq() <= 0) {
      this.rb.setVelocity(Vec2.ZERO);
      return false;
    }
    this.rb.setVelocity(dir.normalize().scale(ENEMY_SPEED * ORBIT_SPEED_MULT));
    return true;
  }

  /** Corpse choreography: play death, stop dealing/taking pushback, and
   *  detach the AI component entirely rather than gating it on a flag —
   *  `entity.remove` is safe to call on the component's own currently-
   *  running listener (`Entity.emit` iterates a snapshot). The body becomes
   *  static, so physics can no longer push the corpse around and the corpse
   *  pushes nothing. The corpse destroys itself after `CORPSE_LINGER`
   *  (scheduled on the still-attached `ProcessComponent` before the AI
   *  detaches) so `GameDirector`'s respawns don't pile up. */
  private die(): void {
    const entity = this.entity;
    tokenOf(entity).clear(entity);
    playBoxerAnim(entity, "death", { oneShot: true });
    this.rb.setType("static");
    this.gfx.graphics.clear(); // no HP bar on a corpse
    this.pc
      .slot({ duration: CORPSE_LINGER, onComplete: () => entity.destroy() })
      .start();
    entity.remove(EnemyAI);
    cameraOf(entity).shake(8, 0.2, { decay: 0.8 });
    playDeathSfx(entity);
  }

  private redraw(): void {
    drawHealthBar(this.gfx, this.health.hp / this.health.max, ENEMY_TINT);
  }
}

@trait(Hittable)
export class EnemyEntity extends Entity {
  receiveHit(hit: Hit): HitResult {
    return this.get(HitReceiver).receive(hit);
  }

  setup(params: { position: Vec2Like }): void {
    this.tags.add("enemy");
    const transform = this.add(
      new Transform({
        position: new Vec2(params.position.x, params.position.y),
      }),
    );
    transform.setScale(SPRITE_SCALE, SPRITE_SCALE);
    this.add(
      new AnimatedSpriteComponent({
        source: sourceFor("idle", DEFAULT_DIR),
        anchor: SPRITE_ANCHOR,
        // Tinted so the same sheets read as a distinct combatant.
        tint: ENEMY_TINT,
      }),
    );
    this.add(new BoxerFootAnchorTracking());
    this.add(new AnimationController(buildBoxerAnimDefs(ENEMY_ANIMS)));
    this.add(new GraphicsComponent());
    this.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: BODY_COLLIDER_RADIUS },
      }),
    );
    this.add(new ProcessComponent());
    this.add(new Facing());
    this.add(new Health({ max: 50 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "enemy", iframes: 0.15 }));
    this.add(new Abilities([SHOOT, MELEE]));
    this.add(new EnemyAI());
  }
}

export interface PickupSpec {
  kind: StatKind;
  color: number;
  gain: number;
}

export const PICKUP_SPECS: readonly PickupSpec[] = [
  { kind: "atk", color: 0xf87171, gain: 4 },
  { kind: "def", color: 0x60a5fa, gain: 3 },
  { kind: "maxHp", color: 0x4ade80, gain: 25 },
  { kind: "atkSpeed", color: 0xfbbf24, gain: 0.3 },
];

export const PICKUP_COLLECT_RANGE = 26;
export const PICKUP_SPAWN_INTERVAL = 6;
export const MAX_PICKUPS = 3;

/** Marks a collectible gem and carries the stat it grants. Behavior lives in
 *  `GameDirector` (one poller, not one component per gem). */
export class Pickup extends Component {
  constructor(readonly spec: PickupSpec) {
    super();
  }
}

/** Grant a collected/leveled stat, routing maxHp through the `Health.max`
 *  push so the bar grows immediately. */
export function grantStat(
  player: Entity,
  stats: Stats,
  kind: StatKind,
  amount: number,
): void {
  if (kind === "atk") stats.atk += amount;
  else if (kind === "def") stats.def += amount;
  else if (kind === "atkSpeed") stats.atkSpeed += amount;
  else {
    stats.maxHp += amount;
    pushMaxHp(player);
  }
}
