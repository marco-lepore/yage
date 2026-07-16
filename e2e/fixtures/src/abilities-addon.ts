/**
 * Deterministic e2e fixture for @yagejs-addons/abilities.
 *
 * A stationary player and a stationary enemy, both driven entirely through
 * `window.__abilities__` (play an ability by id, teleport an entity) rather
 * than keyboard input or AI — the frozen clock and `RigidBodyComponent`
 * teleports keep every scenario reproducible. All assertions go through a
 * `CombatProbe` component (one per entity) read via the Inspector API
 * (`getComponentData("PlayerEntity"/"EnemyEntity", "CombatProbe")`).
 */

import {
  Component,
  Engine,
  Entity,
  ProcessComponent,
  Scene,
  Transform,
  Vec2,
  trait,
} from "@yagejs/core";
import { GraphicsComponent, RendererPlugin } from "@yagejs/renderer";
import { ColliderComponent, PhysicsPlugin, RigidBodyComponent } from "@yagejs/physics";
import { DebugPlugin } from "@yagejs/debug";
import {
  Abilities,
  Facing,
  Health,
  HealthDamaged,
  HealthHealed,
  Hittable,
  HitGuarded,
  HitReceiver,
  Projectile,
  Stagger,
  TouchDamage,
  defaultHitSteps,
  defineStep,
  guard,
  hitbox,
  invulnerable,
  spawn,
} from "@yagejs-addons/abilities";
import type {
  AbilityDef,
  Hit,
  HitResult,
  HitSpec,
  HitStage,
  Scalar,
  StandardHitData,
} from "@yagejs-addons/abilities";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 400;
const HEIGHT = 300;
const container = setupContainer(WIDTH, HEIGHT);

// ---------------------------------------------------------------------------
// Game-defined steps (see examples/src/abilities-addon.ts for the same pair).
// ---------------------------------------------------------------------------

const dashMove = defineStep<{ speed: number }>("dashMove", {
  enter(params, ctx) {
    const facing = ctx.entity.get(Facing);
    ctx.entity.get(RigidBodyComponent).setVelocity(facing.unit.scale(params.speed));
  },
  exit(_params, ctx) {
    ctx.entity.get(RigidBodyComponent).setVelocity(Vec2.ZERO);
  },
});

const heal = defineStep<{ amount: number }>("heal", {
  fire(params, ctx) {
    ctx.entity.get(Health).heal(params.amount);
  },
});

// ---------------------------------------------------------------------------
// Stats boundary — a game-side stat block wired into the addon's
// four numeric hooks (see examples/src/abilities-addon.ts for the narrated
// version). Both combatants start at neutral stats, so baseline damage/
// cooldowns are unchanged; the `stats-boundary` tests mutate them at runtime
// through `__abilities__.setStat` and assert each hook.
//   atk -> byAtk (HitSpec) · def -> defenseStage (HitStage) ·
//   maxHp -> pushMaxHp (Health.max push) · atkSpeed -> hasten (Scalar cooldown)
// ---------------------------------------------------------------------------

const BASE_ATK = 10;

class Stats extends Component {
  constructor(
    public atk: number,
    public def: number,
    public maxHp: number,
    public atkSpeed = 1,
  ) {
    super();
  }
}

function statsOf(entity: Entity): Stats | undefined {
  return entity.tryGet(Stats);
}

function byAtk(base: StandardHitData): HitSpec {
  return (ctx) => {
    const atk = statsOf(ctx.entity)?.atk ?? BASE_ATK;
    return { ...base, damage: Math.round((base.damage ?? 0) * (atk / BASE_ATK)) };
  };
}

function hasten(base: number): Scalar {
  return (ctx) => base / (statsOf(ctx.entity)?.atkSpeed ?? 1);
}

const defenseStage: HitStage<StandardHitData, HitReceiver> = (hit, receiver) => {
  const def = statsOf(receiver.entity)?.def ?? 0;
  if (def > 0 && hit.data.damage !== undefined) {
    hit.data.damage = Math.max(0, hit.data.damage - def);
  }
  return undefined;
};

const combatantHitSteps: readonly HitStage<StandardHitData, HitReceiver>[] = [
  defenseStage,
  ...defaultHitSteps,
];

function pushMaxHp(entity: Entity): void {
  const stats = statsOf(entity);
  const health = entity.tryGet(Health);
  if (!stats || !health) return;
  const gained = stats.maxHp - health.max;
  health.max = stats.maxHp;
  if (gained > 0) health.heal(gained);
  else health.hp = Math.min(health.hp, health.max);
}

// ---------------------------------------------------------------------------
// Ability defs — the polished example's numbers, except a wider guard window
// (0.6s vs 0.35s) so frame-stepped tests can't race it shut. The receivers
// below also drop i-frames to 0 so every delivery resolves on its own.
// ---------------------------------------------------------------------------

const SLASH: AbilityDef = {
  id: "slash",
  cooldown: 0.5,
  timeline: [
    hitbox({
      from: 0.05,
      to: 0.16,
      shape: { type: "capsule", halfHeight: 16, radius: 9, axis: "x" },
      offset: { x: 26, y: 0 },
      hit: byAtk({ damage: 18, knockback: 260, stun: 0.3 }),
    }),
  ],
};

const DASH: AbilityDef = {
  id: "dash",
  cooldown: hasten(1.0),
  timeline: [
    invulnerable({ from: 0, to: 0.18 }),
    dashMove({ from: 0, to: 0.18, speed: 560 }),
  ],
};

const GUARD: AbilityDef = {
  id: "guard",
  cooldown: 0.9,
  timeline: [
    guard({
      from: 0,
      to: 0.6,
      outcome: "parried",
      policy: () => "negate",
      punish: { damage: 10, knockback: 240, stun: 0.45 },
    }),
  ],
};

const POTION: AbilityDef = {
  id: "potion",
  lane: "item",
  cooldown: 5,
  timeline: [heal({ at: 0, amount: 30 })],
};

const SHOOT: AbilityDef = {
  id: "shoot",
  cooldown: 1.6,
  timeline: [
    spawn({
      at: 0,
      entity: Projectile,
      params: {
        speed: 240,
        lifetime: 2.5,
        shape: { type: "circle", radius: 5 },
      },
      aim: (ctx) => {
        const from = ctx.entity.get(Transform).worldPosition;
        const player = ctx.entity.scene.findEntity("PlayerEntity");
        return player ? player.get(Transform).worldPosition.sub(from) : Vec2.RIGHT;
      },
      hit: { damage: 10, knockback: 130, stun: 0.3 },
    }),
  ],
};

// ---------------------------------------------------------------------------
// Probe — Inspector-readable combat state, one instance per entity.
// ---------------------------------------------------------------------------

interface ProbeData {
  hp: number;
  maxHp: number;
  dead: boolean;
  damagedCount: number;
  healedCount: number;
  guardedCount: number;
  lastGuardOutcome: string;
  mainActive: string | null;
  itemActive: string | null;
  staggered: boolean;
  x: number;
  y: number;
}

class CombatProbe extends Component {
  private damagedCount = 0;
  private healedCount = 0;
  private guardedCount = 0;
  private lastGuardOutcome = "";
  private readonly health = this.sibling(Health);
  private readonly abilities = this.sibling(Abilities);
  private readonly stagger = this.sibling(Stagger);
  private readonly transform = this.sibling(Transform);

  onAdd(): void {
    this.listen(this.entity, HealthDamaged, () => {
      this.damagedCount++;
    });
    this.listen(this.entity, HealthHealed, () => {
      this.healedCount++;
    });
    this.listen(this.entity, HitGuarded, ({ outcome }) => {
      this.guardedCount++;
      this.lastGuardOutcome = outcome;
    });
  }

  serialize(): ProbeData {
    return {
      hp: this.health.hp,
      maxHp: this.health.max,
      dead: this.health.isDead,
      damagedCount: this.damagedCount,
      healedCount: this.healedCount,
      guardedCount: this.guardedCount,
      lastGuardOutcome: this.lastGuardOutcome,
      mainActive: this.abilities.activeId("main"),
      itemActive: this.abilities.activeId("item"),
      staggered: this.stagger.active,
      x: this.transform.position.x,
      y: this.transform.position.y,
    };
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

@trait(Hittable)
class PlayerEntity extends Entity {
  receiveHit(hit: Hit): HitResult {
    return this.get(HitReceiver).receive(hit);
  }

  setup(): void {
    this.tags.add("player");
    this.add(new Transform({ position: new Vec2(80, 150) }));
    this.add(new GraphicsComponent().draw((g) => g.circle(0, 0, 14).fill({ color: 0x22c55e })));
    this.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    this.add(new ColliderComponent({ shape: { type: "circle", radius: 14 } }));
    this.add(new ProcessComponent());
    this.add(new Facing());
    this.add(new Stats(BASE_ATK, 0, 100));
    this.add(new Health({ max: 100 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "player", iframes: 0, steps: combatantHitSteps }));
    this.add(new Abilities([SLASH, DASH, GUARD, POTION]));
    this.add(new CombatProbe());
  }
}

@trait(Hittable)
class EnemyEntity extends Entity {
  receiveHit(hit: Hit): HitResult {
    return this.get(HitReceiver).receive(hit);
  }

  setup(): void {
    this.tags.add("enemy");
    this.add(new Transform({ position: new Vec2(320, 150) }));
    this.add(new GraphicsComponent().draw((g) => g.circle(0, 0, 14).fill({ color: 0xe11d48 })));
    this.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    this.add(new ColliderComponent({ shape: { type: "circle", radius: 14 } }));
    this.add(new ProcessComponent());
    this.add(new Stats(BASE_ATK, 0, 50));
    this.add(new Health({ max: 50 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "enemy", iframes: 0, steps: combatantHitSteps }));
    this.add(
      new TouchDamage({ hit: { damage: 6, knockback: 140, stun: 0.25 }, interval: 0.8 }),
    );
    this.add(new Abilities([SHOOT]));
    this.add(new CombatProbe());
  }
}

// ---------------------------------------------------------------------------
// Scene + host handle
// ---------------------------------------------------------------------------

class AbilitiesFixtureScene extends Scene {
  readonly name = "abilities-addon-fixture";

  onEnter(): void {
    this.spawn(PlayerEntity);
    this.spawn(EnemyEntity);
  }
}

type Who = "player" | "enemy";

type StatKind = "atk" | "def" | "maxHp" | "atkSpeed";

interface AbilitiesHostHandle {
  play(who: Who, id: string): boolean;
  teleport(who: Who, x: number, y: number): void;
  setStat(who: Who, kind: StatKind, value: number): void;
  cooldownRemaining(who: Who, id: string): number;
}

function entityFor(scene: Scene, who: Who): Entity {
  const entity = scene.findEntity(who === "player" ? "PlayerEntity" : "EnemyEntity");
  if (!entity) throw new Error(`abilities fixture: entity "${who}" not found.`);
  return entity;
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      resolution: 1,
      container,
    }),
  );
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 0 } }));
  engine.use(new DebugPlugin());
  await engine.start();
  engine.inspector.time.freeze();

  const scene = new AbilitiesFixtureScene();
  await engine.scenes.push(scene);

  const handle: AbilitiesHostHandle = {
    play(who, id) {
      return entityFor(scene, who).get(Abilities).play(id).ok;
    },
    teleport(who, x, y) {
      entityFor(scene, who).get(RigidBodyComponent).setPosition(x, y);
    },
    setStat(who, kind, value) {
      const entity = entityFor(scene, who);
      const stats = entity.get(Stats);
      if (kind === "atk") stats.atk = value;
      else if (kind === "def") stats.def = value;
      else if (kind === "atkSpeed") stats.atkSpeed = value;
      else {
        stats.maxHp = value;
        pushMaxHp(entity);
      }
    },
    cooldownRemaining(who, id) {
      return entityFor(scene, who).get(Abilities).cooldownRemaining(id);
    },
  };
  (window as unknown as { __abilities__: AbilitiesHostHandle }).__abilities__ = handle;
}

main().catch(console.error);
