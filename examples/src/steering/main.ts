import {
  Component,
  Engine,
  Entity,
  MathUtils,
  RandomKey,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import { GraphicsComponent, RendererPlugin } from "@yagejs/renderer";
import {
  ColliderComponent,
  PhysicsPlugin,
  PhysicsWorldKey,
  RigidBodyComponent,
} from "@yagejs/physics";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { DebugRegistryKey } from "@yagejs/debug/api";
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
import {
  avoidColliders,
  PhysicsSteeringAgent,
} from "@yagejs-addons/steering/physics";
import type {
  Kinematic,
  SteeringAgentOptions,
  SteeringBehavior,
} from "@yagejs-addons/steering";
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
// AgentVisual — the agent's body: a circle, dimmed while the agent is off.
// The velocity arrow is debug output, so it goes to the debug overlay through
// `drawVector` instead of being redrawn here. The sibling lookup on
// SteeringAgent also finds a PhysicsSteeringAgent, its subclass.
// ---------------------------------------------------------------------------
class AgentVisual extends Component {
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly agent = this.sibling(SteeringAgent);

  constructor(
    private readonly color: number,
    private readonly radius = 10,
  ) {
    super();
  }

  onAdd(): void {
    // Returning null while the agent is off leaves the arrow undrawn for
    // that frame — the provider decides, frame by frame.
    this.addCleanup(
      this.use(DebugRegistryKey).drawVector(
        this.entity,
        () => (this.agent.enabled ? this.agent.velocity : null),
        { scale: ARROW_SCALE, alpha: 0.85, minLength: 1 },
      ),
    );
  }

  update(): void {
    const alpha = this.agent.enabled ? 0.9 : 0.3;
    this.gfx.draw((g) => {
      g.clear();
      g.circle(0, 0, this.radius).fill({ color: this.color, alpha });
    });
  }
}

type FlockRuleName = "separation" | "alignment" | "cohesion";

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
    private readonly flockRules: Record<FlockRuleName, FlockRule>,
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

    const ruleActions: [string, FlockRuleName][] = [
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

/** A kinematic steering agent drawn as a coloured circle. */
class AgentEntity extends Entity {
  agent!: SteeringAgent;

  setup(params: {
    position: Vec2;
    color: number;
    radius: number;
    steering: SteeringAgentOptions;
  }): void {
    this.add(new Transform({ position: params.position }));
    this.add(new GraphicsComponent());
    this.agent = this.add(new SteeringAgent(params.steering));
    this.add(new AgentVisual(params.color, params.radius));
  }
}

/** The player's dot, moved with WASD. */
class PlayerEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 80) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 12).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 12).stroke({ color: 0xe0f2fe, width: 2 });
      }),
    );
    this.add(new PlayerController());
  }
}

/**
 * Ten boids (separation/alignment/cohesion + contain) as child entities.
 * The flock has no Transform, so each boid's local position is its world
 * position, which SteeringAgent needs. `rules` holds each flock rule's
 * behaviour on every boid, so the rule can be switched off and on for the
 * whole flock.
 */
class FlockEntity extends Entity {
  agents: SteeringAgent[] = [];
  readonly rules: Record<FlockRuleName, FlockRule> = {
    separation: { active: true, perBoid: [] },
    alignment: { active: true, perBoid: [] },
    cohesion: { active: true, perBoid: [] },
  };

  setup(): void {
    const boidRefs: { transform: Transform; agent: SteeringAgent }[] = [];
    const count = 10;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const position = new Vec2(
        720 + Math.cos(angle) * 60,
        420 + Math.sin(angle) * 60,
      );
      const boid = this.spawnChild(`boid-${i}`, AgentEntity, {
        position,
        color: 0xc084fc,
        radius: 6,
        steering: { maxSpeed: 95, behaviors: [] },
      });
      boidRefs.push({ transform: boid.get(Transform), agent: boid.agent });
    }

    for (const self of boidRefs) {
      const neighbors = (): Kinematic[] =>
        boidRefs
          .filter((b) => b !== self)
          .map((b) => ({
            position: b.transform.position,
            velocity: b.agent.velocity,
          }));
      const sep = separation(neighbors, { radius: 28, weight: 1.5 });
      const align = alignment(neighbors, { radius: 60 });
      const coh = cohesion(neighbors, { radius: 70, weight: 0.8 });
      self.agent.setBehaviors([
        sep,
        align,
        coh,
        contain(FIELD, { weight: 1.5 }),
      ]);
      this.rules.separation.perBoid.push({ agent: self.agent, behavior: sep });
      this.rules.alignment.perBoid.push({ agent: self.agent, behavior: align });
      this.rules.cohesion.perBoid.push({ agent: self.agent, behavior: coh });
    }

    this.agents = boidRefs.map((b) => b.agent);
  }
}

/** A static rock. avoidColliders finds its collider by raycast. */
class RockEntity extends Entity {
  setup(params: { position: Vec2; radius: number }): void {
    const { position, radius } = params;
    this.add(new Transform({ position }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, radius).fill({ color: 0x57534e });
        g.circle(0, 0, radius).stroke({ color: 0x292524, width: 2 });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius },
      }),
    );
  }
}

/** A light dynamic crate the physics agent shoves out of its way. */
class CrateEntity extends Entity {
  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-10, -10, 20, 20).fill({ color: 0xa16207 });
        g.rect(-10, -10, 20, 20).stroke({ color: 0x713f12, width: 2 });
      }),
    );
    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        gravityScale: 0,
        linearDamping: 3,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: 20, height: 20 },
        density: 0.4,
      }),
    );
  }
}

/**
 * A dynamic body driven by PhysicsSteeringAgent (impulse drive): it shoves
 * the crates aside on its way to the player, and anything hitting it
 * knocks it off course before steering pulls it back.
 */
class PhysicsAgentEntity extends Entity {
  agent!: PhysicsSteeringAgent;

  setup(params: { target: () => Vec2 }): void {
    this.add(new Transform({ position: new Vec2(800, 100) }));
    this.add(new GraphicsComponent());
    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        gravityScale: 0,
        linearDamping: 0,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 10 },
        density: 1,
      }),
    );
    this.agent = this.add(
      new PhysicsSteeringAgent({
        maxSpeed: 130,
        maxAcceleration: 400,
        behaviors: [arrive(params.target, { slowRadius: 160 })],
      }),
    );
    this.add(new AgentVisual(0x4ade80, 10));
  }
}

/** Hosts the number-key toggles. */
class TogglesEntity extends Entity {
  setup(params: {
    groups: SteeringAgent[][];
    flockRules: Record<FlockRuleName, FlockRule>;
  }): void {
    this.add(new ToggleController(params.groups, params.flockRules));
  }
}

/** Rocks are real static colliders — avoidColliders discovers them by raycast. */
const ROCKS: { position: Vec2; radius: number }[] = [
  { position: new Vec2(320, 460), radius: 26 },
  { position: new Vec2(410, 415), radius: 22 },
  { position: new Vec2(500, 465), radius: 28 },
];

/** Where the crates start, between the physics agent and the player. */
const CRATES: Vec2[] = [
  new Vec2(650, 200),
  new Vec2(720, 260),
  new Vec2(590, 300),
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
    // Wandering draws from the scene's generator, which ?test seeds.
    const random = this.use(RandomKey);
    const player = this.spawn(PlayerEntity);
    const playerPos = (): Vec2 => player.get(Transform).position;
    const groups: SteeringAgent[][] = [];

    // 1 — seek: a chaser closing straight in on the player.
    groups.push([
      this.spawn(AgentEntity, {
        position: new Vec2(120, 120),
        color: 0xef4444,
        radius: 10,
        steering: { maxSpeed: 140, behaviors: [seek(playerPos)] },
      }).agent,
    ]);

    // 2 — flee, radius-gated: only runs when the player gets close.
    groups.push([
      this.spawn(AgentEntity, {
        position: new Vec2(460, 480),
        color: 0xf97316,
        radius: 10,
        steering: {
          maxSpeed: 130,
          behaviors: [flee(playerPos, { radius: 170 })],
        },
      }).agent,
    ]);

    // 3 — wander + contain: roams freely, steered back at the field edge.
    const wanderers: SteeringAgent[] = [];
    for (const position of [new Vec2(200, 150), new Vec2(700, 150)]) {
      wanderers.push(
        this.spawn(AgentEntity, {
          position,
          color: 0x38bdf8,
          radius: 8,
          steering: {
            maxSpeed: 70,
            behaviors: [
              wander({ random: () => random.float() }),
              contain(FIELD, { weight: 2 }),
            ],
          },
        }).agent,
      );
    }
    groups.push(wanderers);

    // 4 — followPath, looped: a patrol walking its rectangle forever.
    groups.push([
      this.spawn(AgentEntity, {
        position: PATROL[0]!,
        color: 0x2dd4bf,
        radius: 9,
        steering: {
          maxSpeed: 120,
          behaviors: [followPath(PATROL, { loop: true })],
        },
      }).agent,
    ]);

    // 5 — boids (separation/alignment/cohesion + contain).
    const flock = this.spawn(FlockEntity);
    groups.push(flock.agents);

    for (const rock of ROCKS) this.spawn(RockEntity, rock);

    // 6 — seek + avoidColliders on a higher priority tier: raycasts discover
    // the rock/crate colliders (no obstacle list), and near one the
    // avoidance steer overrides seek outright.
    groups.push([
      this.spawn(AgentEntity, {
        position: new Vec2(120, 460),
        color: 0xfacc15,
        radius: 9,
        steering: {
          maxSpeed: 110,
          behaviors: [
            seek(playerPos),
            avoidColliders(world, { lookAhead: 90, priority: 1 }),
          ],
        },
      }).agent,
    ]);

    // 7 — the impulse-drive physics agent (shoves crates, takes hits).
    for (const position of CRATES) this.spawn(CrateEntity, { position });
    groups.push([this.spawn(PhysicsAgentEntity, { target: playerPos }).agent]);

    this.spawn(TogglesEntity, { groups, flockRules: flock.rules });
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
  // Started enabled so the velocity arrows are visible on load; backtick
  // toggles the whole overlay, arrows included.
  engine.use(new DebugPlugin({ startEnabled: true }));

  await engine.start();
  await engine.scenes.push(new SteeringScene());
}

main().catch(console.error);
