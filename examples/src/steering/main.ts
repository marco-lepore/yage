import { Component, Engine, MathUtils, Scene, Transform, Vec2 } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { GraphicsComponent, RendererPlugin } from "@yagejs/renderer";
import {
  ColliderComponent,
  PhysicsPlugin,
  PhysicsWorldKey,
  RigidBodyComponent,
} from "@yagejs/physics";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import {
  alignment,
  arrive,
  cohesion,
  contain,
  flee,
  followPath,
  seek,
  separation,
  SteeringAgent,
  wander,
} from "@yagejs-addons/steering";
import { avoidColliders, PhysicsSteeringAgent } from "@yagejs-addons/steering/physics";
import type { Kinematic, SteeringAgentOptions, SteeringBehavior } from "@yagejs-addons/steering";
import { setupGameContainer } from "../shared/bootstrap.js";


const WIDTH = 900;
const HEIGHT = 600;
const PLAYER_SPEED = 180;
const ARROW_SCALE = 0.35;

/** Keeps roaming agents (wander, flock) on the field via the contain behavior. */
const FIELD = { x: 10, y: 10, width: WIDTH - 20, height: HEIGHT - 20 };

// ---------------------------------------------------------------------------
// Player — WASD, driven by @yagejs/input directly (not a steering agent).
// Every other agent on screen chases/flees/avoids/orbits this dot.
// ---------------------------------------------------------------------------
class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  update(dt: number): void {
    const v = this.input.getVector("left", "right", "up", "down");
    const dir = v.lengthSq() > 0 ? v.normalize() : v;
    const p = this.transform.position;
    this.transform.setPosition(
      MathUtils.clamp(p.x + dir.x * PLAYER_SPEED * dt, 16, WIDTH - 16),
      MathUtils.clamp(p.y + dir.y * PLAYER_SPEED * dt, 16, HEIGHT - 16),
    );
  }
}

// ---------------------------------------------------------------------------
// AgentVisual — redraws a circle + a velocity arrow every frame, reading
// the agent's velocity directly (the addon's own debug-drawing hook). Takes
// the agent by reference: components are keyed by exact class, so a sibling
// lookup on SteeringAgent would miss a PhysicsSteeringAgent. Disabled
// agents draw dimmed.
// ---------------------------------------------------------------------------
class AgentVisual extends Component {
  private readonly gfx = this.sibling(GraphicsComponent);

  constructor(
    private readonly agent: SteeringAgent,
    private readonly color: number,
    private readonly radius = 10,
  ) {
    super();
  }

  update(): void {
    const v = this.agent.velocity;
    const alpha = this.agent.enabled ? 0.9 : 0.3;
    this.gfx.draw((g) => {
      g.clear();
      g.circle(0, 0, this.radius).fill({ color: this.color, alpha });
      if (this.agent.enabled && v.lengthSq() > 1) {
        const tip = v.scale(ARROW_SCALE);
        g.moveTo(0, 0)
          .lineTo(tip.x, tip.y)
          .stroke({ color: 0xffffff, width: 2, alpha: 0.85 });
      }
    });
  }
}

/** One flock rule shared across every boid, added/removed live as a set. */
interface FlockRule {
  active: boolean;
  perBoid: { agent: SteeringAgent; behavior: SteeringBehavior }[];
}

// ---------------------------------------------------------------------------
// ToggleController — number keys switch behavior groups on and off (1-7)
// and flip individual flock rules (8/9/0), so any combination can be
// watched in isolation. Toggling dogfoods `enabled`/`stop()` and the live
// `steering.add`/`remove` escape hatches.
// ---------------------------------------------------------------------------
class ToggleController extends Component {
  private readonly input = this.service(InputManagerKey);

  constructor(
    private readonly groups: SteeringAgent[][],
    private readonly flockRules: Record<"separation" | "alignment" | "cohesion", FlockRule>,
  ) {
    super();
  }

  update(): void {
    for (let i = 0; i < this.groups.length; i++) {
      if (!this.input.isJustPressed(`toggle${i + 1}`)) continue;
      for (const agent of this.groups[i]!) {
        agent.enabled = !agent.enabled;
        if (!agent.enabled) agent.stop();
      }
    }

    const ruleActions: [string, "separation" | "alignment" | "cohesion"][] = [
      ["toggleSeparation", "separation"],
      ["toggleAlignment", "alignment"],
      ["toggleCohesion", "cohesion"],
    ];
    for (const [action, name] of ruleActions) {
      if (!this.input.isJustPressed(action)) continue;
      const rule = this.flockRules[name];
      rule.active = !rule.active;
      for (const { agent, behavior } of rule.perBoid) {
        if (rule.active) agent.steering.add(behavior);
        else agent.steering.remove(behavior);
      }
    }
  }
}

function spawnAgent(
  scene: Scene,
  name: string,
  position: Vec2,
  color: number,
  radius: number,
  options: SteeringAgentOptions,
): { entity: Entity; agent: SteeringAgent } {
  const entity = scene.spawn(name);
  entity.add(new Transform({ position }));
  entity.add(new GraphicsComponent());
  const agent = new SteeringAgent(options);
  entity.add(agent);
  entity.add(new AgentVisual(agent, color, radius));
  return { entity, agent };
}

/** Rocks are real static colliders — avoidColliders discovers them by raycast. */
const ROCKS: { position: Vec2; radius: number }[] = [
  { position: new Vec2(320, 460), radius: 26 },
  { position: new Vec2(410, 415), radius: 22 },
  { position: new Vec2(500, 465), radius: 28 },
];

/** Rectangle the patrol agent walks forever (followPath with loop). */
const PATROL: Vec2[] = [
  new Vec2(70, 90),
  new Vec2(230, 90),
  new Vec2(230, 310),
  new Vec2(70, 310),
];

class SteeringScene extends Scene {
  readonly name = "steering";

  onEnter(): void {
    const world = this.use(PhysicsWorldKey);
    const player = this.spawnPlayer();
    const playerPos = (): Vec2 => player.get(Transform).position;
    const groups: SteeringAgent[][] = [];

    // 1 — seek: a chaser closing straight in on the player.
    groups.push([
      spawnAgent(this, "seeker", new Vec2(120, 120), 0xef4444, 10, {
        maxSpeed: 140,
        behaviors: [seek(playerPos)],
      }).agent,
    ]);

    // 2 — flee, radius-gated: only runs when the player gets close.
    groups.push([
      spawnAgent(this, "fleer", new Vec2(460, 480), 0xf97316, 10, {
        maxSpeed: 130,
        behaviors: [flee(playerPos, { radius: 170 })],
      }).agent,
    ]);

    // 3 — wander + contain: roams freely, steered back at the field edge.
    const wanderers: SteeringAgent[] = [];
    for (const [name, pos] of [
      ["wanderer-a", new Vec2(200, 150)],
      ["wanderer-b", new Vec2(700, 150)],
    ] as const) {
      wanderers.push(
        spawnAgent(this, name, pos, 0x38bdf8, 8, {
          maxSpeed: 70,
          behaviors: [wander(), contain(FIELD, { weight: 2 })],
        }).agent,
      );
    }
    groups.push(wanderers);

    // 4 — followPath, looped: a patrol walking its rectangle forever.
    groups.push([
      spawnAgent(this, "patrol", PATROL[0]!, 0x2dd4bf, 9, {
        maxSpeed: 120,
        behaviors: [followPath(PATROL, { loop: true })],
      }).agent,
    ]);

    // 5 — boids (separation/alignment/cohesion + contain).
    const flock = this.spawnFlock();
    groups.push(flock.agents);

    this.spawnRocks();

    // 6 — seek + avoidColliders on a higher priority tier: raycasts discover
    // the rock/crate colliders (no obstacle list), and near one the
    // avoidance steer overrides seek outright.
    groups.push([
      spawnAgent(this, "avoider", new Vec2(120, 460), 0xfacc15, 9, {
        maxSpeed: 110,
        behaviors: [
          seek(playerPos),
          avoidColliders(world, { lookAhead: 90, priority: 1 }),
        ],
      }).agent,
    ]);

    // 7 — the impulse-drive physics agent (shoves crates, takes hits).
    groups.push([this.spawnPhysicsAgent(playerPos)]);

    this.spawn("toggles").add(new ToggleController(groups, flock.rules));
  }

  private spawnPlayer(): Entity {
    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 80) }));
    player.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 12).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 12).stroke({ color: 0xe0f2fe, width: 2 });
      }),
    );
    player.add(new PlayerController());
    return player;
  }

  private spawnFlock(): {
    agents: SteeringAgent[];
    rules: Record<"separation" | "alignment" | "cohesion", FlockRule>;
  } {
    const boidRefs: { transform: Transform; agent: SteeringAgent }[] = [];
    const count = 10;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const position = new Vec2(720 + Math.cos(angle) * 60, 420 + Math.sin(angle) * 60);
      const { entity, agent } = spawnAgent(this, `boid-${i}`, position, 0xc084fc, 6, {
        maxSpeed: 95,
        behaviors: [],
      });
      boidRefs.push({ transform: entity.get(Transform), agent });
    }

    const rules: Record<"separation" | "alignment" | "cohesion", FlockRule> = {
      separation: { active: true, perBoid: [] },
      alignment: { active: true, perBoid: [] },
      cohesion: { active: true, perBoid: [] },
    };
    for (const self of boidRefs) {
      const neighbors = (): Kinematic[] =>
        boidRefs
          .filter((b) => b !== self)
          .map((b) => ({ position: b.transform.position, velocity: b.agent.velocity }));
      const sep = separation(neighbors, { radius: 28, weight: 1.5 });
      const align = alignment(neighbors, { radius: 60 });
      const coh = cohesion(neighbors, { radius: 70, weight: 0.8 });
      self.agent.setBehaviors([sep, align, coh, contain(FIELD, { weight: 1.5 })]);
      rules.separation.perBoid.push({ agent: self.agent, behavior: sep });
      rules.alignment.perBoid.push({ agent: self.agent, behavior: align });
      rules.cohesion.perBoid.push({ agent: self.agent, behavior: coh });
    }

    return { agents: boidRefs.map((b) => b.agent), rules };
  }

  private spawnRocks(): void {
    for (const [i, rock] of ROCKS.entries()) {
      const entity = this.spawn(`rock-${i}`);
      entity.add(new Transform({ position: rock.position }));
      entity.add(
        new GraphicsComponent().draw((g) => {
          g.circle(0, 0, rock.radius).fill({ color: 0x57534e });
          g.circle(0, 0, rock.radius).stroke({ color: 0x292524, width: 2 });
        }),
      );
      entity.add(new RigidBodyComponent({ type: "static" }));
      entity.add(
        new ColliderComponent({ shape: { type: "circle", radius: rock.radius } }),
      );
    }
  }

  /**
   * A dynamic body driven by PhysicsSteeringAgent (impulse drive): it shoves
   * the crates aside on its way to the player, and anything hitting it
   * knocks it off course before steering pulls it back.
   */
  private spawnPhysicsAgent(playerPos: () => Vec2): SteeringAgent {
    for (const [i, pos] of [
      new Vec2(650, 200),
      new Vec2(720, 260),
      new Vec2(590, 300),
    ].entries()) {
      const crate = this.spawn(`crate-${i}`);
      crate.add(new Transform({ position: pos }));
      crate.add(
        new GraphicsComponent().draw((g) => {
          g.rect(-10, -10, 20, 20).fill({ color: 0xa16207 });
          g.rect(-10, -10, 20, 20).stroke({ color: 0x713f12, width: 2 });
        }),
      );
      crate.add(new RigidBodyComponent({ type: "dynamic", gravityScale: 0, linearDamping: 3 }));
      crate.add(
        new ColliderComponent({ shape: { type: "box", width: 20, height: 20 }, density: 0.4 }),
      );
    }

    const entity = this.spawn("physics-arrive");
    entity.add(new Transform({ position: new Vec2(800, 100) }));
    entity.add(new GraphicsComponent());
    entity.add(new RigidBodyComponent({ type: "dynamic", gravityScale: 0, linearDamping: 0 }));
    entity.add(new ColliderComponent({ shape: { type: "circle", radius: 10 }, density: 1 }));
    const agent = new PhysicsSteeringAgent({
      maxSpeed: 130,
      maxAcceleration: 400,
      behaviors: [arrive(playerPos, { slowRadius: 160 })],
    });
    entity.add(agent);
    entity.add(new AgentVisual(agent, 0x4ade80, 10));
    return agent;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(new PhysicsPlugin());
  engine.use(
    new InputPlugin({
      actions: {
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
        up: ["KeyW", "ArrowUp"],
        down: ["KeyS", "ArrowDown"],
        toggle1: ["Digit1"],
        toggle2: ["Digit2"],
        toggle3: ["Digit3"],
        toggle4: ["Digit4"],
        toggle5: ["Digit5"],
        toggle6: ["Digit6"],
        toggle7: ["Digit7"],
        toggleSeparation: ["Digit8"],
        toggleAlignment: ["Digit9"],
        toggleCohesion: ["Digit0"],
      },
    }),
  );
  engine.use(new DebugPlugin());

  await engine.start();
  await engine.scenes.push(new SteeringScene());
}

main().catch(console.error);
