import { describe, it, expect, vi } from "vitest";

// Real physics, not the usual mocks: these tests characterize Rapier's
// contact generation for polyline terrain chains, which no mock reproduces.
// The `@dimforge/rapier2d` ESM build crashes under vitest's transform (a
// wasm-bindgen heap issue in that loader path), so the factory swaps in
// `@dimforge/rapier2d-compat` — the same library and version, instantiated
// at runtime.
vi.mock("@dimforge/rapier2d", async () => {
  const mod = (await import("@dimforge/rapier2d-compat")) as {
    default?: { init(): Promise<unknown> };
  };
  const RAPIER =
    mod.default ?? (mod as unknown as { init(): Promise<unknown> });
  await RAPIER.init();
  return { default: RAPIER };
});

import { Transform, Vec2 } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import type { ColliderConfig } from "./types.js";

const DT = 1 / 60;
const WALK_SPEED = 152;

/*
 * Terrain under test: a ramp outline resting flush on a floor rectangle,
 * the shape a tilemap's collision layer produces for a mound (a closed
 * Tiled polygon becomes a polyline chain with the closing edge appended).
 *
 *                 (496,240)----(528,240)
 *                /                      \
 *   ---(464,256)------------------------(560,256)---  <- floor top y=256
 *   ############## floor box, y 256..320 #############
 *
 * A box body driven across the floor catches on a base vertex when a step
 * lands its foot corner within a fraction of a pixel of the vertex: Rapier
 * generates contacts per segment with no junction awareness, and the
 * cuboid-vs-segment SAT then picks the box's own x axis as the contact
 * normal — a horizontal push at a walkable surface that opposes the walk
 * and pins the body. Which approach phases catch depends on the exact
 * stepping pattern, so the scans below sample one full step-length of
 * sub-pixel start offsets and classify each run.
 */

/** Ramp chain vertices relative to the object origin, closing edge included. */
const RAMP_CLOSED: Vec2[] = [
  new Vec2(0, 0),
  new Vec2(32, -16),
  new Vec2(64, -16),
  new Vec2(96, 0),
  new Vec2(0, 0),
];

/** The same chain with each end extended one tile below the floor top. */
const RAMP_BURIED: Vec2[] = [
  new Vec2(0, 16),
  new Vec2(0, 0),
  new Vec2(32, -16),
  new Vec2(64, -16),
  new Vec2(96, 0),
  new Vec2(96, 16),
];

const RAMP_ORIGIN = { x: 464, y: 256 };

interface Spawned {
  entity: Entity;
  rb: RigidBodyComponent;
  collider: ColliderComponent;
}

function spawnBody(
  scene: Scene,
  name: string,
  x: number,
  y: number,
  type: "dynamic" | "static",
  collider: ColliderConfig,
): Spawned {
  const entity = spawnEntityInScene(scene, name);
  entity.add(new Transform({ position: new Vec2(x, y) }));
  const rb = entity.add(new RigidBodyComponent({ type, fixedRotation: true }));
  const col = entity.add(new ColliderComponent(collider));
  return { entity, rb, collider: col };
}

interface Terrain {
  physicsWorld: PhysicsWorld;
  player: Spawned;
  chain: Spawned;
}

const DEFAULT_WALKER_CONFIG: ColliderConfig = {
  shape: { type: "box", width: 12, height: 44 },
  friction: 0,
};

/** Floor box with its top at y=256, a ramp chain on it, and a 12×44 walker. */
async function setupTerrain(
  chainVertices: Vec2[],
  playerX: number,
  playerConfig: ColliderConfig = DEFAULT_WALKER_CONFIG,
): Promise<Terrain> {
  const { scene, physicsWorld } = await createPhysicsTestContext();
  spawnBody(scene, "floor", 512, 288, "static", {
    shape: { type: "box", width: 1024, height: 64 },
    friction: 0,
  });
  // Mirrors the tilemap conversion: body at the origin, the chain placed by
  // the collider offset, vertices relative to the object position.
  const chain = spawnBody(scene, "ramp", 0, 0, "static", {
    shape: { type: "polyline", vertices: chainVertices },
    offset: RAMP_ORIGIN,
    friction: 0,
  });
  // Resting on the floor puts the walker's center 22 above the floor top.
  const player = spawnBody(
    scene,
    "walker",
    playerX,
    234,
    "dynamic",
    playerConfig,
  );
  return { physicsWorld, player, chain };
}

interface RunResult {
  outcome: "completed" | "pinned" | "other";
  finalX: number;
  restY: number;
  minY: number;
  chainStarts: number;
}

/**
 * Drive the walker at a constant commanded speed until it passes `targetX`
 * or the step budget runs out. The velocity is re-commanded every step, the
 * way a character motor holds a walk speed.
 */
function drive(
  terrain: Terrain,
  vx: number,
  targetX: number,
  maxSteps = 200,
): RunResult {
  const { physicsWorld, player, chain } = terrain;
  let minY = Infinity;
  let chainStarts = 0;
  let completed = false;
  player.collider.onCollision((event) => {
    if (event.started && event.other === chain.entity) chainStarts++;
  });

  for (let i = 0; i < maxSteps; i++) {
    player.rb.setVelocityX(vx);
    physicsWorld.step(DT);
    physicsWorld.processCollisionEvents();
    minY = Math.min(minY, player.rb.positionY);
    const x = player.rb.positionX;
    if ((vx > 0 && x > targetX) || (vx < 0 && x < targetX)) {
      completed = true;
      break;
    }
  }

  if (completed) {
    for (let i = 0; i < 30; i++) {
      player.rb.setVelocityX(0);
      physicsWorld.step(DT);
      physicsWorld.processCollisionEvents();
      minY = Math.min(minY, player.rb.positionY);
    }
  }

  const finalX = player.rb.positionX;
  // Pinned: the run ended with the walker still on the approach side of the
  // base vertex it entered at, foot corner within a few pixels of it.
  const entryVertexX = vx < 0 ? 560 : 464;
  const pinned =
    !completed &&
    (vx < 0 ? finalX > entryVertexX : finalX < entryVertexX) &&
    Math.abs(finalX - entryVertexX) < 12;
  return {
    outcome: completed ? "completed" : pinned ? "pinned" : "other",
    finalX,
    restY: player.rb.positionY,
    minY,
    chainStarts,
  };
}

/** One full step-length (152/60 ≈ 2.53px) of sub-pixel start offsets. */
const PHASES = 64;
const PHASE_STEP = 0.04;

async function scanPhases(
  chainVertices: Vec2[],
  direction: -1 | 1,
  playerConfig: ColliderConfig = DEFAULT_WALKER_CONFIG,
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (let i = 0; i < PHASES; i++) {
    const startX = direction < 0 ? 620 + i * PHASE_STEP : 404 - i * PHASE_STEP;
    const terrain = await setupTerrain(chainVertices, startX, playerConfig);
    // Past the far base vertex, so a completed run settles on flat floor and
    // `restY` is a resting height rather than a mid-crossing sample.
    const targetX = direction < 0 ? 430 : 594;
    results.push(drive(terrain, direction * WALK_SPEED, targetX));
  }
  return results;
}

describe("polyline terrain traversal (real Rapier)", () => {
  it("a driven box catches on the ramp's base vertex at some approach phases", async () => {
    const results = await scanPhases(RAMP_CLOSED, -1);
    const pinned = results.filter((r) => r.outcome === "pinned");
    const completed = results.filter((r) => r.outcome === "completed");

    // Most phases cross; a narrow band of them lands the foot corner on the
    // vertex and never gets past it.
    expect(completed.length).toBeGreaterThan(PHASES / 2);
    expect(pinned.length).toBeGreaterThan(0);
    for (const r of pinned) {
      expect(r.finalX).toBeGreaterThan(560);
      expect(r.finalX).toBeLessThan(572);
    }
  }, 30000);

  it("the catch is phase-dependent, not direction-dependent", async () => {
    // The mirrored drive catches on the opposite base vertex at its own
    // phase band. A traversal that is clean one way and stuck the other
    // differs in stepping phase, not in chain orientation.
    const results = await scanPhases(RAMP_CLOSED, 1);
    expect(
      results.filter((r) => r.outcome === "pinned").length,
    ).toBeGreaterThan(0);
    expect(
      results.filter((r) => r.outcome === "completed").length,
    ).toBeGreaterThan(PHASES / 2);
  }, 30000);

  it("reports the slope contact from either approach direction", async () => {
    async function firstChainNormal(
      startX: number,
      vx: number,
      targetX: number,
    ): Promise<Vec2> {
      const terrain = await setupTerrain(RAMP_CLOSED, startX);
      let sawChainStart = false;
      let firstNormal: Vec2 | undefined;
      terrain.player.collider.onCollision((event) => {
        if (
          sawChainStart ||
          !event.started ||
          event.other !== terrain.chain.entity
        ) {
          return;
        }
        sawChainStart = true;
        firstNormal = event.contactNormal;
      });

      for (let i = 0; i < 200; i++) {
        terrain.player.rb.setVelocityX(vx);
        terrain.physicsWorld.step(DT);
        terrain.physicsWorld.processCollisionEvents();
        const x = terrain.player.rb.positionX;
        if ((vx > 0 && x > targetX) || (vx < 0 && x < targetX)) break;
      }

      expect(sawChainStart).toBe(true);
      expect(firstNormal).toBeDefined();
      if (!firstNormal) {
        throw new Error("The chain collision did not report a contact normal");
      }
      return firstNormal;
    }

    // At a base vertex the box touches the slope and the chain's flat
    // closing edge as separate manifolds. The closing edge is coplanar with
    // the floor, so its normal is (0, 1) and reporting it would describe the
    // ramp as level ground. The slope contact is the deeper of the two.
    const westNormal = await firstChainNormal(620, -152, 470);
    const eastNormal = await firstChainNormal(404, 152, 554);
    const slopeX = 1 / Math.sqrt(5);
    const slopeY = 2 / Math.sqrt(5);

    expect(westNormal.x).toBeCloseTo(-slopeX, 2);
    expect(westNormal.y).toBeCloseTo(slopeY, 2);
    expect(eastNormal.x).toBeCloseTo(slopeX, 2);
    expect(eastNormal.y).toBeCloseTo(slopeY, 2);
    // The terrain is symmetric, so the two entries mirror in x.
    expect(eastNormal.x).toBeCloseTo(-westNormal.x, 2);
    expect(eastNormal.y).toBeCloseTo(westNormal.y, 2);
  }, 30000);

  it("reversing the chain's winding changes nothing", async () => {
    const reversed = [...RAMP_CLOSED].reverse();
    const results = await scanPhases(reversed, -1);
    expect(
      results.filter((r) => r.outcome === "pinned").length,
    ).toBeGreaterThan(0);
  }, 30000);

  it("end vertices extended below the floor keep the chain fully solid", async () => {
    // Burying the chain's ends does not disable it: every crossing still
    // climbs the ramp (or pins on the vertex), and the chain reports
    // contact events. No run skims across at resting height.
    const results = await scanPhases(RAMP_BURIED, -1);
    const completed = results.filter((r) => r.outcome === "completed");
    expect(completed.length).toBeGreaterThan(PHASES / 2);
    for (const r of completed) {
      // Riding over the 16px-tall plateau lifts the center well above its
      // flat-ground resting height of 234.
      expect(r.minY).toBeLessThan(225);
      expect(r.chainStarts).toBeGreaterThan(0);
    }
  }, 30000);
});

describe("polyline terrain traversal, rounded walker", () => {
  const ROUNDED_WALKER: ColliderConfig = {
    shape: { type: "box", width: 12, height: 44, borderRadius: 2 },
    friction: 0,
  };

  // Every arrangement the plain box pins on: both drive directions, and the
  // reversed winding.
  it.each([
    ["driving left", RAMP_CLOSED, -1],
    ["driving right", RAMP_CLOSED, 1],
    ["reversed winding", [...RAMP_CLOSED].reverse(), -1],
  ] as const)(
    "crosses cleanly at every approach phase and keeps the plain resting height, %s",
    async (_label, chain, direction) => {
      const results = await scanPhases(chain, direction, ROUNDED_WALKER);

      expect(results).toHaveLength(PHASES);
      expect(results.every((result) => result.outcome === "completed")).toBe(
        true,
      );
      for (const result of results) {
        expect(result.restY).toBeCloseTo(234.077, 1);
      }
    },
    30000,
  );

  it("uses contact skin to cross cleanly at the cost of resting height", async () => {
    const results = await scanPhases(RAMP_CLOSED, -1, {
      shape: { type: "box", width: 12, height: 44 },
      friction: 0,
      contactSkin: 1,
    });

    expect(results).toHaveLength(PHASES);
    expect(results.every((result) => result.outcome === "completed")).toBe(
      true,
    );
    // A 1px skin holds the walker 1px above the surface a plain box rests on.
    for (const result of results) {
      expect(result.restY).toBeCloseTo(233.078, 1);
    }
  }, 30000);
});
