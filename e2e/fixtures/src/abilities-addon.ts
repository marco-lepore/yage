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
  defineStep,
  guard,
  hitbox,
  invulnerable,
  spawn,
} from "@yagejs-addons/abilities";
import type { AbilityDef, Hit, HitResult } from "@yagejs-addons/abilities";
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
      hit: { damage: 18, knockback: 260, stun: 0.3 },
    }),
  ],
};

const DASH: AbilityDef = {
  id: "dash",
  cooldown: 1.0,
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
    this.add(new Health({ max: 100 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "player", iframes: 0 }));
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
    this.add(new Health({ max: 50 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "enemy", iframes: 0 }));
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

interface AbilitiesHostHandle {
  play(who: Who, id: string): boolean;
  teleport(who: Who, x: number, y: number): void;
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
  };
  (window as unknown as { __abilities__: AbilitiesHostHandle }).__abilities__ = handle;
}

main().catch(console.error);
