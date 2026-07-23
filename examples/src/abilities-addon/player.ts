import {
  Component,
  Entity,
  ProcessComponent,
  SceneManagerKey,
  SceneTimeKey,
  Transform,
  Vec2,
  trait,
} from "@yagejs/core";
import {
  AnimatedSpriteComponent,
  AnimationController,
  GraphicsComponent,
} from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { InputManagerKey } from "@yagejs/input";
import {
  Abilities,
  Facing,
  Health,
  HealthDied,
  HitDealt,
  HitGuarded,
  HitReceived,
  HitReceiver,
  Hittable,
  Stagger,
  createReportingDelivery,
} from "@yagejs-addons/abilities";
import type { Hit, HitResult } from "@yagejs-addons/abilities";
import { AbilityDriverComponent } from "@yagejs-addons/abilities/input";
import type { AbilityDriverOptions } from "@yagejs-addons/abilities/input";
import {
  HEIGHT,
  PLAYER_RUN_SPEED,
  PLAYER_SPEED,
  PLAYER_TINT,
  WIDTH,
} from "./constants.js";
import {
  BODY_COLLIDER_RADIUS,
  DEFAULT_DIR,
  PLAYER_ANIMS,
  SPRITE_ANCHOR,
  SPRITE_SCALE,
  buildBoxerAnimDefs,
  installFootAnchorTracking,
  playBoxerAnim,
  sourceFor,
} from "./boxer-sprites.js";
import { slowmoVelocityCompensation } from "./steps.js";
import { BASE_ATK, Stats, playerHitSteps } from "./stats.js";
import {
  SHAKE_BY_WEIGHT,
  cameraOf,
  damageWeight,
  drawHealthBar,
  flashAttacker,
  fxOf,
  playDeathSfx,
  playHitSfx,
  reactToBlockedHit,
  reactToHit,
} from "./feedback.js";
import {
  COUNTER,
  GUARD_HOLD_ID,
  PARRY_ID,
  PLAYER_LOADOUTS,
  PLAYER_MAIN_DEFS,
} from "./player-abilities.js";
import type { PlayerLoadout } from "./player-abilities.js";
import { FireballProjectile } from "./enemies.js";
import { AbilitiesDemoScene } from "./scene.js";

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/** Seconds the attack key must be held before it's a charge rather than a tap. */
export const CHARGE_HOLD_TIME = 0.5;
/** A shorter dash press is a roll; crossing this raw-time threshold runs. */
export const DASH_HOLD_TIME = 0.22;
/** Raw seconds after a tap release during which the combo intent may fire. */
export const ATTACK_BUFFER_WINDOW = 0.5;
/** Seconds a mid-attack dash press keeps retrying its cancel before it lapses. */
export const DASH_BUFFER_WINDOW = 0.3;
/** Seconds a charge release may wait for the main lane after an interruption. */
export const CHARGE_RELEASE_BUFFER_WINDOW = 1.5;
/** Player melee reach for the parry counter — comfortably past contact
 *  range but short of the enemy's ranged stand-off distance, so a parried
 *  touch hit counters in melee and a parried fireball (whose source is far
 *  away) reflects instead. */
export const MELEE_COUNTER_RANGE = 90;
export const REFLECT_DAMAGE = 14;
export const REFLECT_KNOCKBACK = 280;
export const REFLECT_STUN = 0.3;
export const REFLECT_SPEED = 260;

/** Seconds: releasing the guard key at or before this elapsed hold time
 *  completes the hold-block and sends a parry — a tap, not a hold. Widened from 0.25s
 *  alongside `PARRY_ACTIVE_WINDOW` — see its doc. */
export const PARRY_TAP_WINDOW = 0.3;

// ---------------------------------------------------------------------------
// Charge convergence sparks — a hand-rolled few-particle effect on
// `PlayerController` (Graphics, not `@yagejs/particles`): a fixed count of
// points on a ring around the caster's body center, each ticking its own
// radius down to 0 and alpha with it, then respawning at the ring edge with
// a fresh random angle. `@yagejs/particles`' `EmitterConfig` (see its
// `types.ts`) draws `spawnOffset` (position) and `angle`/`speed` (velocity)
// from independent random ranges per particle — there is no way to correlate
// a particle's spawn position with its travel direction, so "start on a ring,
// travel inward toward the ring's own center" cannot be expressed by the
// package's config at all, built-in or preset. Hand-rolling a handful of
// Graphics-drawn points sidesteps the gap entirely; see the evidence note in
// `09-feedback.md` for the fuller writeup.
// ---------------------------------------------------------------------------

export interface ChargeSpark {
  angle: number;
  radius: number;
}

export const CHARGE_SPARK_COUNT = 10;
export const CHARGE_SPARK_RING_RADIUS = 42;
export const CHARGE_SPARK_INWARD_SPEED = 110; // px/s
export const CHARGE_SPARK_ALPHA = 0.35; // dimmer than the old rising-ember stream
export const CHARGE_SPARK_COLOR = 0xffe066;

export function spawnChargeSpark(): ChargeSpark {
  return {
    angle: Math.random() * Math.PI * 2,
    radius: CHARGE_SPARK_RING_RADIUS,
  };
}

export class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly time = this.service(SceneTimeKey);
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly facing = this.sibling(Facing);
  private readonly abilities = this.sibling(Abilities);
  private readonly anim = this.sibling(AnimationController);
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly health = this.sibling(Health);
  private readonly pc = this.sibling(ProcessComponent);
  private readonly stagger = this.sibling(Stagger);
  private readonly driver = this.sibling(AbilityDriverComponent);
  private loadoutIndex = 0;
  dead = false;

  charging = false;
  private chargeSparks: ChargeSpark[] = [];

  onAdd(): void {
    this.listen(this.entity, HealthDied, () => {
      this.dead = true;
      if (this.charging) {
        this.charging = false;
        this.stopChargeSparks();
      }
      this.rb.setVelocity(Vec2.ZERO);
      this.rb.setEnabledTranslations(false, false); // corpse: physics can't push it
      playBoxerAnim(this.entity, "death", { oneShot: true });
      cameraOf(this.entity).shake(9, 0.22, { decay: 0.75 });
      playDeathSfx(this.entity);
    });
    this.listen(this.entity, HitReceived, ({ hit, guardOutcomes }) => {
      if (this.dead) return;
      if (guardOutcomes.includes("blocked")) {
        reactToBlockedHit(this.entity, this.pc, PLAYER_TINT, hit);
      } else {
        reactToHit(this.entity, this.pc, PLAYER_TINT, hit);
      }
    });
    this.listen(this.entity, HitDealt, ({ result, data }) => {
      if (result !== "hit") return;
      // Freeze frame: the ability def declares its own hitstop next to its
      // damage numbers (see the attack defs' `hit.hitstop`), so the arbitration
      // primitive freezes the whole scene without a parallel id->weight table.
      if (data.hitstop) this.time.freezeFor(data.hitstop);
      // Camera shake / attacker flash stay game-side (feedback, not
      // arbitration), keyed off how hard the hit landed.
      const weight = damageWeight(data.damage ?? 0);
      if (weight !== "light") {
        flashAttacker(this.entity, this.pc, PLAYER_TINT);
        const shake = SHAKE_BY_WEIGHT[weight];
        cameraOf(this.entity).shake(shake.intensity, shake.duration, {
          decay: 0.85,
        });
      }
    });
    this.listen(this.entity, HitGuarded, ({ hit, outcome }) => {
      if (outcome !== "parried") return;
      fxOf(this.entity).parrySpark(this.entity.get(Transform).worldPosition);
      cameraOf(this.entity).shake(5, 0.12, { decay: 0.85 });
      // No bespoke "parry ring" asset exists in the pack — the hit thock
      // pitched up reads as a bright, distinct chime instead (see the SFX
      // section's doc comment).
      playHitSfx(this.entity, { speed: 1.8, volume: 0.55 });
      this.counterattack(hit.source);
    });
  }

  driverOptions(loadout: PlayerLoadout): AbilityDriverOptions {
    const alive = () => !this.dead;
    const attack = {
      tap: { send: loadout.attackIntent, buffer: ATTACK_BUFFER_WINDOW },
      hold: {
        send: loadout.charge.id,
        fromNeutral: true,
        resume: true,
        release: {
          send: loadout.releaseIntent,
          buffer: CHARGE_RELEASE_BUFFER_WINDOW,
          data: ({ heldFor }: { heldFor: number }) => heldFor,
        },
      },
      gate: alive,
    };

    return {
      defaults: { holdAt: CHARGE_HOLD_TIME },
      beforeFire: () => this.resampleFacing(),
      bindings: {
        attack,
        dash: {
          tap: {
            send: "dash",
            within: DASH_HOLD_TIME,
            buffer: DASH_BUFFER_WINDOW,
          },
          gate: alive,
        },
        guard: {
          press: { send: GUARD_HOLD_ID },
          tap: { send: PARRY_ID, within: PARRY_TAP_WINDOW },
          gate: alive,
        },
        potion: {
          lane: "item",
          press: { send: "potion" },
          gate: alive,
        },
      },
    };
  }

  update(dt: number): void {
    if (this.input.isJustPressed("reset")) {
      this.resetDemo();
      return;
    }
    if (this.input.isJustPressed("loadout")) this.swapLoadout();
    if (this.dead) {
      this.redraw();
      return;
    }

    const activeMain = this.abilities.active("main");
    const charging = Boolean(
      activeMain?.isHolding && activeMain.def.tags?.includes("charge"),
    );
    if (charging !== this.charging) {
      this.charging = charging;
      if (charging) this.startChargeSparks();
      else this.stopChargeSparks();
    }
    if (this.charging) this.updateChargeSparks(dt);

    if (!activeMain) {
      const dx = this.input.getAxis("left", "right");
      const dy = this.input.getAxis("up", "down");
      const moving = dx !== 0 || dy !== 0;
      const running = moving && this.input.isHeldFor("dash", DASH_HOLD_TIME);
      if (moving) {
        this.facing.set(dx, dy);
        const speed =
          (running ? PLAYER_RUN_SPEED : PLAYER_SPEED) *
          slowmoVelocityCompensation(this.time, this.entity);
        this.rb.setVelocity(new Vec2(dx, dy).normalize().scale(speed));
      } else {
        this.rb.setVelocity(Vec2.ZERO);
      }
      if (!this.anim.locked) {
        playBoxerAnim(
          this.entity,
          moving ? (running ? "sprint" : "run") : "idle",
          { oneShot: false },
        );
      }
    } else {
      if (activeMain.isHolding && activeMain.def.tags?.includes("charge")) {
        this.resampleFacing();
        playBoxerAnim(this.entity, "chargeHold", { oneShot: false });
      }
      if (!activeMain.isStepActive("velocity") && !this.stagger.active) {
        // Movement is gated by an ability (attack/guard/charge/counter) with
        // no movement step of its own — a hard stop instead of coasting on
        // whatever WASD velocity was live when the ability started. Skipped
        // while `dashMove`/`lungeMove` or `Stagger`'s knockback ramp owns the
        // body's velocity themselves.
        this.rb.setVelocity(Vec2.ZERO);
      }
    }
    this.redraw();
  }

  /** Tears down and rebuilds the whole scene from scratch — a fresh
   *  `AbilitiesDemoScene` instance re-spawns the arena, camera, VfxHub,
   *  combatants, and HUD from `onEnter`, so nothing needs manual cleanup
   *  beyond what `SceneManager.replace` already guarantees (old scene
   *  `onExit` + every entity destroyed before the new scene enters). */
  private resetDemo(): void {
    this.use(SceneManagerKey)
      .replace(new AbilitiesDemoScene())
      .catch(() => {});
  }

  /** Replace the definitions and the input driver as one game-owned loadout. */
  private swapLoadout(): void {
    if (this.dead) return;
    const nextIndex = (this.loadoutIndex + 1) % PLAYER_LOADOUTS.length;
    const next = PLAYER_LOADOUTS[nextIndex]!;
    this.abilities.replaceDefinitions(next.defs);
    this.loadoutIndex = nextIndex;
    this.driver.replace(this.driverOptions(next));
  }

  get loadoutName(): string {
    return PLAYER_LOADOUTS[this.loadoutIndex]!.name;
  }

  /** Hotbar read for the shared attack slot: it has no single
   *  `cooldownRemaining` id to poll (both combos, both charges, and the parry
   *  counter share it), so it's driven off the active run's
   *  current phase instead — `phaseElapsed`/`phaseDuration` resolved
   *  directly off the activation handle, so each combo stage and the charge
   *  kick each wipe over their own span. Idle (or holding a def not in
   *  `PLAYER_MAIN_DEFS`, e.g. `dash`/`guardHold`/`parry` occupying the same
   *  lane) reads as ready; an elastic hold phase (no finite duration) reads
   *  as HOLD. */
  attackSlotState(): { ratio: number; label: string } {
    if (this.charging) return { ratio: 0, label: "HOLD" };
    const activation = this.abilities.active("main");
    if (!activation || !(activation.def.id in PLAYER_MAIN_DEFS)) {
      return { ratio: 1, label: "0.0" };
    }
    const { phaseElapsed, phaseDuration } = activation;
    if (!Number.isFinite(phaseDuration)) return { ratio: 0, label: "HOLD" };
    if (phaseDuration <= 0) return { ratio: 1, label: "0.0" };
    const ratio = Math.min(1, phaseElapsed / phaseDuration);
    return {
      ratio,
      label: Math.max(0, phaseDuration - phaseElapsed).toFixed(1),
    };
  }

  // -------------------------------------------------------------------------
  // Charge convergence sparks — see the `ChargeSpark`/`CHARGE_SPARK_*`
  // section above for why this is hand-rolled Graphics rather than a
  // `@yagejs/particles` emitter. Ticked while the charge phase is active,
  // drawn from `redraw` alongside the HP bar (one entity, one
  // `GraphicsComponent` — see the codebase's one-component-per-class rule).
  // -------------------------------------------------------------------------

  private startChargeSparks(): void {
    this.chargeSparks = Array.from(
      { length: CHARGE_SPARK_COUNT },
      spawnChargeSpark,
    );
  }

  private stopChargeSparks(): void {
    this.chargeSparks = [];
  }

  private updateChargeSparks(dt: number): void {
    for (let i = 0; i < this.chargeSparks.length; i++) {
      const spark = this.chargeSparks[i]!;
      spark.radius -= CHARGE_SPARK_INWARD_SPEED * dt;
      if (spark.radius <= 2) this.chargeSparks[i] = spawnChargeSpark();
    }
  }

  private drawChargeSparks(): void {
    // Drawn in the entity's local space, which is already centered on the
    // body (the Transform origin is the torso — see `SPRITE_ANCHOR`).
    for (const spark of this.chargeSparks) {
      const x = Math.cos(spark.angle) * spark.radius;
      const y = Math.sin(spark.angle) * spark.radius;
      const alpha =
        CHARGE_SPARK_ALPHA * (spark.radius / CHARGE_SPARK_RING_RADIUS);
      this.gfx.graphics
        .circle(x, y, 3)
        .fill({ color: CHARGE_SPARK_COLOR, alpha });
    }
  }

  /** Re-aims Facing to the currently-held movement axis, if any. The input
   *  driver calls this at action boundaries so buffered actions use the
   *  direction held when they fire. The charge phase also calls it each
   *  frame so the player can turn its stationary pose. Reads the raw input
   *  axis because the driver runs before `update`'s WASD refresh. `Facing.set`
   *  ignores a zero vector, so releasing WASD preserves the last direction. */
  private resampleFacing(): void {
    this.facing.set(
      this.input.getAxis("left", "right"),
      this.input.getAxis("up", "down"),
    );
  }

  // -------------------------------------------------------------------------
  // Parry counter — hand-rolled: a successful parry either punches an
  // in-reach attacker or reflects a distant one's own projectile back at it.
  // -------------------------------------------------------------------------

  private counterattack(source: Entity): void {
    if (source.isDestroyed || (source.tryGet(Health)?.isDead ?? false)) return;
    const sourcePos = source.tryGet(Transform)?.worldPosition;
    if (!sourcePos) return;
    const myPos = this.entity.get(Transform).worldPosition;
    const toSource = sourcePos.sub(myPos);
    const dist = toSource.length();
    if (dist <= 0) return;
    if (dist <= MELEE_COUNTER_RANGE) {
      this.facing.set(toSource.x, toSource.y);
      this.abilities.force(COUNTER);
    } else {
      this.reflectProjectile(toSource.normalize());
    }
  }

  private reflectProjectile(direction: Vec2): void {
    const from = this.entity.get(Transform).worldPosition;
    const delivery = createReportingDelivery({
      source: this.entity,
      data: {
        damage: REFLECT_DAMAGE,
        knockback: REFLECT_KNOCKBACK,
        stun: REFLECT_STUN,
      },
    });
    this.scene.spawn(FireballProjectile, {
      caster: this.entity,
      aim: direction,
      position: from,
      delivery,
      params: {
        speed: REFLECT_SPEED,
        shape: { type: "circle", radius: 7 },
        lifetime: 2.5,
      },
    });
  }

  /** HP bar plus the charge-hold convergence sparks while charging — the
   *  sprite animation itself conveys guard/dash/stun/dead. */
  private redraw(): void {
    drawHealthBar(this.gfx, this.health.hp / this.health.max, 0x4ade80);
    if (this.charging) this.drawChargeSparks();
  }
}

@trait(Hittable)
export class PlayerEntity extends Entity {
  receiveHit(hit: Hit): HitResult {
    return this.get(HitReceiver).receive(hit);
  }

  setup(): void {
    this.tags.add("player");
    const transform = this.add(
      new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }),
    );
    transform.setScale(SPRITE_SCALE, SPRITE_SCALE);
    this.add(
      new AnimatedSpriteComponent({
        source: sourceFor("idle", DEFAULT_DIR),
        anchor: SPRITE_ANCHOR,
      }),
    );
    installFootAnchorTracking(this);
    this.add(new AnimationController(buildBoxerAnimDefs(PLAYER_ANIMS)));
    this.add(new GraphicsComponent());
    this.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: BODY_COLLIDER_RADIUS },
      }),
    );
    this.add(new ProcessComponent());
    this.add(new Facing());
    this.add(new Stats({ atk: BASE_ATK, def: 0, maxHp: 100 }));
    this.add(new Health({ max: 100 }));
    this.add(new Stagger());
    this.add(
      new HitReceiver({ team: "player", iframes: 0.25, steps: playerHitSteps }),
    );
    this.add(new Abilities(PLAYER_LOADOUTS[0]!.defs));
    const controller = new PlayerController();
    this.add(
      new AbilityDriverComponent(controller.driverOptions(PLAYER_LOADOUTS[0]!)),
    );
    this.add(controller);
  }
}
