/**
 * Deterministic e2e fixture for @yagejs-addons/steering.
 *
 * Every agent targets a FIXED point or a fixed obstacle list — no player
 * input needed, so determinism comes from the frozen clock alone (plus a
 * seeded `random` for the one wander agent, included for parity with the
 * shipped example even though nothing here asserts on it). Entities are
 * named so the spec drives them purely through the Inspector API
 * (`getEntityPosition`), and `window.__steering__` exposes the fixed
 * target/waypoint/obstacle data (and a knockback trigger for the impulse
 * agent) so the spec never hardcodes them a second time.
 */

import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { ColliderComponent, PhysicsPlugin, PhysicsWorldKey, RigidBodyComponent } from "@yagejs/physics";
import { DebugPlugin } from "@yagejs/debug";
import {
  alignment,
  arrive,
  avoidObstacles,
  cohesion,
  flee,
  followPath,
  seek,
  separation,
  SteeringAgent,
  wander,
} from "@yagejs-addons/steering";
import { avoidColliders, PhysicsSteeringAgent } from "@yagejs-addons/steering/physics";
import type { Kinematic, Obstacle } from "@yagejs-addons/steering";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 800;
const HEIGHT = 600;
const container = setupContainer(WIDTH, HEIGHT);

const SEEK_TARGET = new Vec2(750, 100);
const FLEE_TARGET = new Vec2(400, 300);
const AVOID_TARGET = new Vec2(750, 500);
const OBSTACLES: Obstacle[] = [{ position: new Vec2(350, 485), radius: 35 }];
const BOID_COUNT = 6;
const BOID_NAMES = Array.from({ length: BOID_COUNT }, (_, i) => `boid-${i}`);
const PATH_WAYPOINTS = [new Vec2(100, 560), new Vec2(400, 520), new Vec2(700, 560)];
const IMPULSE_TARGET = new Vec2(700, 100);
const CRATE_START = new Vec2(400, 100);
const COLLIDER_AVOID_TARGET = new Vec2(750, 200);
const WALL_ROCK = { position: new Vec2(400, 210), radius: 30 };

/** A small seeded PRNG (mulberry32) so `wander` is reproducible run to run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SteeringE2EScene extends Scene {
  readonly name = "steering-e2e";

  onEnter(): void {
    this.spawnSeeker();
    this.spawnFleer();
    this.spawnAvoider();
    this.spawnFlock();
    this.spawnWanderer();
    this.spawnPather();
    this.spawnColliderAvoider();
    const knockback = this.spawnImpulseAgent();

    (window as unknown as { __steering__: unknown }).__steering__ = {
      seekTarget: { x: SEEK_TARGET.x, y: SEEK_TARGET.y },
      fleeTarget: { x: FLEE_TARGET.x, y: FLEE_TARGET.y },
      obstacles: OBSTACLES.map((o) => ({ x: o.position.x, y: o.position.y, radius: o.radius })),
      boidNames: BOID_NAMES,
      pathWaypoints: PATH_WAYPOINTS.map((w) => ({ x: w.x, y: w.y })),
      impulseTarget: { x: IMPULSE_TARGET.x, y: IMPULSE_TARGET.y },
      crateName: "crate-0",
      colliderObstacle: {
        x: WALL_ROCK.position.x,
        y: WALL_ROCK.position.y,
        radius: WALL_ROCK.radius,
      },
      knockback,
    };
  }

  private spawnSeeker(): void {
    const entity = this.spawn("seeker");
    entity.add(new Transform({ position: new Vec2(50, 100) }));
    entity.add(new SteeringAgent({ maxSpeed: 150, behaviors: [seek(SEEK_TARGET)] }));
  }

  private spawnFleer(): void {
    const entity = this.spawn("fleer");
    entity.add(new Transform({ position: new Vec2(420, 300) }));
    entity.add(new SteeringAgent({ maxSpeed: 130, behaviors: [flee(FLEE_TARGET)] }));
  }

  private spawnAvoider(): void {
    const entity = this.spawn("avoider");
    entity.add(new Transform({ position: new Vec2(50, 500) }));
    entity.add(
      new SteeringAgent({
        maxSpeed: 140,
        behaviors: [
          seek(AVOID_TARGET),
          avoidObstacles(OBSTACLES, { lookAhead: 120, agentRadius: 8, priority: 1 }),
        ],
      }),
    );
  }

  private spawnFlock(): void {
    const boidRefs: { transform: Transform; agent: SteeringAgent }[] = [];
    for (let i = 0; i < BOID_COUNT; i++) {
      const angle = (i / BOID_COUNT) * Math.PI * 2;
      const position = new Vec2(200 + Math.cos(angle) * 50, 200 + Math.sin(angle) * 50);
      const entity = this.spawn(`boid-${i}`);
      entity.add(new Transform({ position }));
      const agent = new SteeringAgent({ maxSpeed: 95, behaviors: [] });
      entity.add(agent);
      boidRefs.push({ transform: entity.get(Transform), agent });
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

  private spawnWanderer(): void {
    const entity = this.spawn("wanderer");
    entity.add(new Transform({ position: new Vec2(600, 300) }));
    entity.add(
      new SteeringAgent({ maxSpeed: 60, behaviors: [wander({ random: seededRandom(42) })] }),
    );
  }

  private spawnPather(): void {
    const entity = this.spawn("pather");
    entity.add(new Transform({ position: new Vec2(60, 560) }));
    entity.add(
      new SteeringAgent({
        maxSpeed: 150,
        behaviors: [followPath(PATH_WAYPOINTS, { waypointRadius: 16 })],
      }),
    );
  }

  /**
   * Kinematic agent steering around a real static collider discovered by
   * avoidColliders' raycasts — no hand-authored obstacle list.
   */
  private spawnColliderAvoider(): void {
    const rock = this.spawn("wall-rock");
    rock.add(new Transform({ position: WALL_ROCK.position }));
    rock.add(new RigidBodyComponent({ type: "static" }));
    rock.add(
      new ColliderComponent({ shape: { type: "circle", radius: WALL_ROCK.radius } }),
    );

    const world = this.use(PhysicsWorldKey);
    const entity = this.spawn("collider-avoider");
    entity.add(new Transform({ position: new Vec2(50, 200) }));
    entity.add(
      new SteeringAgent({
        maxSpeed: 140,
        behaviors: [
          seek(COLLIDER_AVOID_TARGET),
          avoidColliders(world, { lookAhead: 120, priority: 1 }),
        ],
      }),
    );
  }

  /**
   * Impulse-drive agent on a straight run through a pushable crate. Returns
   * a knockback trigger for the spec: a mass-scaled impulse for an exact
   * -300 px/s vertical velocity change.
   */
  private spawnImpulseAgent(): () => void {
    const crate = this.spawn("crate-0");
    crate.add(new Transform({ position: CRATE_START }));
    crate.add(new RigidBodyComponent({ type: "dynamic", gravityScale: 0, linearDamping: 3 }));
    crate.add(
      new ColliderComponent({ shape: { type: "box", width: 20, height: 20 }, density: 0.4 }),
    );

    const entity = this.spawn("impulse-agent");
    entity.add(new Transform({ position: new Vec2(100, 100) }));
    entity.add(new RigidBodyComponent({ type: "dynamic", gravityScale: 0, linearDamping: 0 }));
    entity.add(new ColliderComponent({ shape: { type: "circle", radius: 10 }, density: 1 }));
    entity.add(
      new PhysicsSteeringAgent({
        maxSpeed: 150,
        maxAcceleration: 500,
        behaviors: [arrive(IMPULSE_TARGET, { slowRadius: 100 })],
      }),
    );

    const body = entity.get(RigidBodyComponent);
    return () => body.applyImpulse({ x: 0, y: -300 * body.getMass() });
  }
}

async function main() {
  const engine = new Engine({ debug: true });
  engine.use(new RendererPlugin({ width: WIDTH, height: HEIGHT, container }));
  engine.use(new PhysicsPlugin());
  engine.use(new DebugPlugin());
  await engine.start();
  await engine.scenes.push(new SteeringE2EScene());
}

main().catch(console.error);
