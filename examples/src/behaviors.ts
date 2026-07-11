import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { GraphicsComponent, RendererPlugin } from "@yagejs/renderer";
import { ColliderComponent, PhysicsPlugin, RigidBodyComponent } from "@yagejs/physics";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import {
  alignment,
  arrive,
  avoidObstacles,
  cohesion,
  flee,
  seek,
  separation,
  SteeringAgent,
  wander,
} from "@yagejs-addons/behaviors";
import type { Kinematic, Obstacle, SteeringAgentOptions } from "@yagejs-addons/behaviors";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles();

const WIDTH = 900;
const HEIGHT = 600;
const PLAYER_SPEED = 180;
const ARROW_SCALE = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

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
      clamp(p.x + dir.x * PLAYER_SPEED * dt, 16, WIDTH - 16),
      clamp(p.y + dir.y * PLAYER_SPEED * dt, 16, HEIGHT - 16),
    );
  }
}

// ---------------------------------------------------------------------------
// AgentVisual — redraws a circle + a velocity arrow every frame, reading
// SteeringAgent.velocity directly (the addon's own debug-drawing hook).
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

  update(): void {
    const v = this.agent.velocity;
    this.gfx.draw((g) => {
      g.clear();
      g.circle(0, 0, this.radius).fill({ color: this.color, alpha: 0.9 });
      if (v.lengthSq() > 1) {
        const tip = v.scale(ARROW_SCALE);
        g.moveTo(0, 0)
          .lineTo(tip.x, tip.y)
          .stroke({ color: 0xffffff, width: 2, alpha: 0.85 });
      }
    });
  }
}

/** Wraps a roaming agent (wander, flock) back onto the field instead of letting it drift off forever. */
class WrapBounds extends Component {
  private readonly transform = this.sibling(Transform);

  update(): void {
    const p = this.transform.position;
    let x = p.x;
    let y = p.y;
    if (x < -20) x = WIDTH + 20;
    else if (x > WIDTH + 20) x = -20;
    if (y < -20) y = HEIGHT + 20;
    else if (y > HEIGHT + 20) y = -20;
    if (x !== p.x || y !== p.y) this.transform.setPosition(x, y);
  }
}

function spawnAgent(
  scene: Scene,
  name: string,
  position: Vec2,
  color: number,
  radius: number,
  options: SteeringAgentOptions,
): Entity {
  const entity = scene.spawn(name);
  entity.add(new Transform({ position }));
  entity.add(new GraphicsComponent());
  entity.add(new SteeringAgent(options));
  entity.add(new AgentVisual(color, radius));
  return entity;
}

const ROCKS: Obstacle[] = [
  { position: new Vec2(320, 460), radius: 26 },
  { position: new Vec2(410, 415), radius: 22 },
  { position: new Vec2(500, 465), radius: 28 },
];

class BehaviorsScene extends Scene {
  readonly name = "behaviors";

  onEnter(): void {
    const player = this.spawnPlayer();
    const playerPos = (): Vec2 => player.get(Transform).position;

    // seek — a chaser closing straight in on the player.
    spawnAgent(this, "seeker", new Vec2(120, 120), 0xef4444, 10, {
      maxSpeed: 140,
      behaviors: [seek(playerPos)],
    });

    // flee, radius-gated — only runs when the player gets close.
    spawnAgent(this, "fleer", new Vec2(460, 480), 0xf97316, 10, {
      maxSpeed: 130,
      behaviors: [flee(playerPos, { radius: 170 })],
    });

    // wander — two agents roaming independently, wrapped onto the field.
    for (const [name, pos] of [
      ["wanderer-a", new Vec2(200, 150)],
      ["wanderer-b", new Vec2(700, 150)],
    ] as const) {
      const entity = spawnAgent(this, name, pos, 0x38bdf8, 8, {
        maxSpeed: 70,
        behaviors: [wander()],
      });
      entity.add(new WrapBounds());
    }

    this.spawnFlock();
    this.spawnRocks();

    // seek + avoidObstacles — routes around the rocks on its way to the player.
    spawnAgent(this, "avoider", new Vec2(120, 460), 0xfacc15, 9, {
      maxSpeed: 110,
      behaviors: [
        seek(playerPos),
        avoidObstacles(() => ROCKS, { lookAhead: 90, agentRadius: 8, weight: 3 }),
      ],
    });

    this.spawnPhysicsAgent(playerPos);
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

  private spawnFlock(): void {
    const boidRefs: { transform: Transform; agent: SteeringAgent }[] = [];
    const count = 10;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const position = new Vec2(720 + Math.cos(angle) * 60, 420 + Math.sin(angle) * 60);
      const entity = spawnAgent(this, `boid-${i}`, position, 0xc084fc, 6, {
        maxSpeed: 95,
        behaviors: [],
      });
      entity.add(new WrapBounds());
      boidRefs.push({ transform: entity.get(Transform), agent: entity.get(SteeringAgent) });
    }
    for (const self of boidRefs) {
      const neighbors = (): Kinematic[] =>
        boidRefs
          .filter((b) => b !== self)
          .map((b) => ({ position: b.transform.position, velocity: b.agent.velocity }));
      self.agent.setBehaviors([
        separation(neighbors, { radius: 28, weight: 1.5 }),
        alignment(neighbors, { radius: 60 }),
        cohesion(neighbors, { radius: 70, weight: 0.8 }),
      ]);
    }
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
    }
  }

  /** A physics body driven by steering — the game owns the apply, the addon never imports @yagejs/physics. */
  private spawnPhysicsAgent(playerPos: () => Vec2): void {
    const entity = this.spawn("physics-arrive");
    entity.add(new Transform({ position: new Vec2(800, 100) }));
    entity.add(new GraphicsComponent());
    entity.add(new RigidBodyComponent({ type: "dynamic", gravityScale: 0, linearDamping: 0 }));
    entity.add(new ColliderComponent({ shape: { type: "circle", radius: 10 }, density: 1 }));
    const body = entity.get(RigidBodyComponent);
    entity.add(
      new SteeringAgent({
        maxSpeed: 130,
        maxAcceleration: 400,
        behaviors: [arrive(playerPos, { slowRadius: 160 })],
        apply: (v) => body.setVelocity(v),
      }),
    );
    entity.add(new AgentVisual(0x4ade80, 10));
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
      },
    }),
  );
  engine.use(new DebugPlugin());

  await engine.start();
  await engine.scenes.push(new BehaviorsScene());
}

main().catch(console.error);
