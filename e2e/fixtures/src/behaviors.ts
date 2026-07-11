/**
 * Deterministic e2e fixture for @yagejs-addons/behaviors.
 *
 * Every agent targets a FIXED point or a fixed obstacle list — no player
 * input needed, so determinism comes from the frozen clock alone (plus a
 * seeded `random` for the one wander agent, included for parity with the
 * shipped example even though nothing here asserts on it). Entities are
 * named so the spec drives them purely through the Inspector API
 * (`getEntityPosition`), and `window.__behaviors__` exposes the fixed
 * target/obstacle data so the spec never hardcodes it a second time.
 */

import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import {
  alignment,
  avoidObstacles,
  cohesion,
  flee,
  seek,
  separation,
  SteeringAgent,
  wander,
} from "@yagejs-addons/behaviors";
import type { Kinematic, Obstacle } from "@yagejs-addons/behaviors";
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

class BehaviorsE2EScene extends Scene {
  readonly name = "behaviors-e2e";

  onEnter(): void {
    this.spawnSeeker();
    this.spawnFleer();
    this.spawnAvoider();
    this.spawnFlock();
    this.spawnWanderer();

    (window as unknown as { __behaviors__: unknown }).__behaviors__ = {
      seekTarget: { x: SEEK_TARGET.x, y: SEEK_TARGET.y },
      fleeTarget: { x: FLEE_TARGET.x, y: FLEE_TARGET.y },
      obstacles: OBSTACLES.map((o) => ({ x: o.position.x, y: o.position.y, radius: o.radius })),
      boidNames: BOID_NAMES,
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
          avoidObstacles(OBSTACLES, { lookAhead: 120, agentRadius: 8, weight: 3 }),
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
}

async function main() {
  const engine = new Engine({ debug: true });
  engine.use(new RendererPlugin({ width: WIDTH, height: HEIGHT, container }));
  engine.use(new DebugPlugin());
  await engine.start();
  await engine.scenes.push(new BehaviorsE2EScene());
}

main().catch(console.error);
