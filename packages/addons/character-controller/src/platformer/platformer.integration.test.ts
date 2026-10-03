import { ErrorBoundaryKey } from "@yagejs/core";
import { resolveMotion } from "../core/MotionIntent.js";
import { PlatformerCrushedEvent } from "./CrushProbe.js";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@dimforge/rapier2d", async () => {
  const { default: rapier } = await import("@dimforge/rapier2d-compat");
  await rapier.init();
  return { default: rapier };
});
import {
  createTestEngine,
  Entity,
  Scene,
  Transform,
  Vec2,
  advanceFrames,
} from "@yagejs/core";
import type { Engine } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsPlugin,
  RigidBodyComponent,
} from "@yagejs/physics";
import { createPlatformer } from "./createPlatformer.js";
import type { CreatePlatformerOptions } from "./createPlatformer.js";
import { MovingSurface } from "./MovingSurface.js";
import { MoveAdmission } from "./MoveAdmission.js";
import type { PlatformerMove } from "./MoveAdmission.js";

class TestScene extends Scene {
  readonly name = "platformer-test";
}
class Actor extends Entity {
  setup(options: CreatePlatformerOptions = {}): void {
    this.add(new Transform({ position: new Vec2(0, 0) }));
    createPlatformer(this, { input: null, ...options });
  }
}
class Floor extends Entity {
  setup({
    x = 0,
    y = 100,
    width = 1000,
    height = 20,
    kinematic = false,
  } = {}): void {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new RigidBodyComponent({ type: kinematic ? "kinematic" : "static" }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "box", width, height },
        friction: 0,
      }),
    );
  }
}
import { PlatformerController } from "./PlatformerController.js";
import { PlatformerInput } from "./input.js";
import {
  PlatformerMoves,
  PlatformerJumpedEvent,
  PlatformerDashedEvent,
} from "./PlatformerMoves.js";
import { MotionReconciler } from "./MotionReconciler.js";
import { Stance } from "./Stance.js";

let engine: Engine | undefined;
afterEach(() => engine?.destroy());
async function setup(options: CreatePlatformerOptions = {}) {
  engine = await createTestEngine({}, [new PhysicsPlugin()]);
  const scene = new TestScene();
  await engine.scenes.push(scene);
  const floor = scene.spawn(Floor, {});
  const entity = scene.spawn(Actor, options);
  const body = entity.get(RigidBodyComponent);
  const input = entity.get(PlatformerInput);
  const controller = entity.get(PlatformerController);
  const tick = (frames = 1) => {
    if (engine) advanceFrames(engine, frames);
  };
  tick(60);
  return { scene, floor, entity, body, input, controller, tick };
}

describe("default platformer with real physics", () => {
  it("lands, runs, and jumps from a minimal setup", async () => {
    const { body, input, controller, tick } = await setup();
    expect(controller.grounded).toBe(true);
    expect(body.positionY).toBeCloseTo(90, 0);
    input.setDirection(1);
    tick(15);
    expect(body.velocityX).toBeCloseTo(190, 0);
    input.setJumpHeld(true);
    input.jump();
    tick();
    expect(body.velocityY).toBeCloseTo(-434, 0);
    tick(2);
    expect(controller.grounded).toBe(false);
  });
  it("short hops cut rise, while holding banks full height", async () => {
    const { body, input, tick } = await setup();
    input.setJumpHeld(true);
    input.jump();
    tick();
    input.setJumpHeld(false);
    tick();
    expect(body.velocityY).toBeCloseTo(-240, 0);
    tick(120);
    input.setJumpHeld(true);
    input.jump();
    tick(16);
    const before = body.velocityY;
    input.setJumpHeld(false);
    tick();
    expect(body.velocityY).toBeCloseTo(before + 980 / 60, 1);
  });
  it("spends one air jump and refills it only after landing", async () => {
    const { entity, body, input, tick } = await setup();
    const kinds: string[] = [];
    entity.on(PlatformerJumpedEvent, ({ kind }) => kinds.push(kind));
    input.setJumpHeld(true);
    input.jump();
    tick(20);
    input.jump();
    tick();
    expect(body.velocityY).toBeCloseTo(-360, 0);
    input.jump();
    tick(12);
    expect(kinds).toEqual(["ground", "air"]);
    tick(140);
    input.jump();
    tick();
    expect(kinds.at(-1)).toBe("ground");
  });
  it("buffers a jump shortly before landing", async () => {
    const { body, input, tick } = await setup({ tuning: { airJumps: 0 } });
    body.setPosition(0, 85);
    body.setVelocity({ x: 0, y: 80 });
    tick();
    input.setJumpHeld(true);
    input.jump();
    tick(5);
    expect(body.velocityY).toBeLessThan(-300);
  });
  it("holds a dash, permits jumping out, and respects its cooldown", async () => {
    const { entity, body, input, tick } = await setup();
    input.dash();
    tick(3);
    expect(body.velocityX).toBeCloseTo(520, 0);
    expect(entity.get(PlatformerMoves).dashing).toBe(true);
    input.setJumpHeld(true);
    input.jump();
    tick();
    expect(body.velocityY).toBeLessThan(-400);
    expect(entity.get(PlatformerMoves).dashing).toBe(false);
    input.dash();
    tick();
    expect(entity.get(PlatformerMoves).dashing).toBe(false);
  });
  it("crouches under a ceiling and stands only after clearing it", async () => {
    const { scene, entity, input, tick } = await setup();
    input.setDown(true);
    tick();
    const ceiling = scene.spawn(Floor, { y: 48, height: 20, width: 100 });
    input.setDown(false);
    tick();
    expect(entity.get(Stance).crouched).toBe(true);
    expect(entity.get(PlatformerController).blocked).toBe(true);
    ceiling.destroy();
    tick(3);
    expect(entity.get(Stance).crouched).toBe(false);
  });
  it("freezes pending jump commands and clears them on deactivation", async () => {
    const { scene, entity, body, input, tick } = await setup();
    scene.timeScale = 0;
    input.setJumpHeld(true);
    input.jump();
    tick(5);
    expect(body.velocityY).toBeGreaterThanOrEqual(0);
    scene.timeScale = 1;
    tick();
    expect(body.velocityY).toBeLessThan(-400);
    input.jump();
    entity.setActive(false);
    entity.setActive(true);
    tick();
    expect(entity.get(PlatformerMoves).dashing).toBe(false);
    expect(body.velocityY).toBeGreaterThan(-434);
  });
  it("lets a higher-priority claim override movement and solver handoff cancels holds", async () => {
    const { entity, body, input, tick } = await setup();
    const motion = entity.get(MotionReconciler);
    const knockback = motion.submitDurable({
      source: "knockback",
      axis: "x",
      target: -200,
      acceleration: Infinity,
      priority: 100,
    });
    input.setDirection(1);
    tick();
    expect(body.velocityX).toBeCloseTo(-200, 0);
    expect(
      motion.refusedLastStep.some((r) => r.outrankedBy === "knockback"),
    ).toBe(true);
    motion.yieldToSolver({ x: 0, y: -100 }, 1);
    tick();
    expect(knockback.active).toBe(false);
    expect(motion.solverOwned).toBe(true);
    motion.reclaim();
    tick();
    expect(body.gravityScale).toBe(0);
  });
  it("rides a translating support without accumulating its speed", async () => {
    const { floor, body, controller, tick } = await setup();
    floor.get(RigidBodyComponent).setType("kinematic");
    floor.add(
      new MovingSurface({
        from: { x: 0, y: 100 },
        to: { x: 200, y: 100 },
        speed: 60,
      }),
    );
    tick(60);
    expect(controller.grounded).toBe(true);
    expect(body.velocityX).toBeCloseTo(60, 0);
    expect(body.positionX).toBeGreaterThan(50);
  });
  it("rejects invalid tuning before adding physics components", async () => {
    const { scene } = await setup();
    const entity = scene.spawn("invalid");
    entity.add(new Transform());
    expect(() =>
      createPlatformer(entity, { input: null, tuning: { gravity: NaN } }),
    ).toThrow(/gravity/);
    expect(entity.tryGet(RigidBodyComponent)).toBeUndefined();
  });
});

it("admits coyote jumps shortly after walking off support", async () => {
  const { floor, input, body, tick } = await setup({ tuning: { airJumps: 0 } });
  floor.destroy();
  tick(3);
  input.setJumpHeld(true);
  input.jump();
  tick();
  expect(body.velocityY).toBeCloseTo(-434, 0);
});
it("expires the coyote window and preserves an unavailable press only for its buffer", async () => {
  const { floor, input, body, tick } = await setup({ tuning: { airJumps: 0 } });
  floor.destroy();
  tick(10);
  input.jump();
  tick();
  expect(body.velocityY).toBeGreaterThan(0);
});
it("wall jumps push away and hold against steering toward the wall", async () => {
  const { scene, entity, input, body, controller, tick } = await setup({
    tuning: { coyoteTime: 0 },
  });
  scene.spawn(Floor, { x: 30, y: -20, width: 20, height: 200 });
  body.setPosition(12, -10);
  body.setVelocity({ x: 0, y: 100 });
  input.setDirection(0.8);
  tick();
  expect(controller.wallSide).toBe(1);
  const kinds: string[] = [];
  entity.on(PlatformerJumpedEvent, ({ kind }) => kinds.push(kind));
  input.jump();
  tick();
  expect(kinds).toEqual(["wall"]);
  expect(body.velocityX).toBeCloseTo(-370, 0);
  expect(body.velocityY).toBeCloseTo(-434, 0);
  tick(3);
  expect(body.velocityX).toBeCloseTo(-370, 0);
});
it("slides only when crouch starts with enough running speed", async () => {
  const { input, body, tick } = await setup();
  input.setDown(true);
  tick();
  expect(body.velocityX).toBeCloseTo(0, 0);
  input.setDown(false);
  input.setDirection(1);
  tick(35);
  input.setDown(true);
  tick();
  expect(body.velocityX).toBeCloseTo(450, 0);
  tick(3);
  expect(body.velocityX).toBeLessThan(450);
});
it("does not refill air jumps at the head of a one-way platform", async () => {
  const { scene, input, body, controller, tick } = await setup();
  const platform = scene.spawn(Floor, { y: 10, width: 200, height: 10 });
  platform.get(ColliderComponent).setContactFilter(() => false);
  body.setPosition(0, 40);
  body.setVelocity({ x: 0, y: -100 });
  input.setDirection(0);
  tick();
  expect(controller.grounded).toBe(false);
});
it("rejects missing input before creating a partial character", async () => {
  const { scene } = await setup();
  const entity = scene.spawn("no-input");
  entity.add(new Transform());
  expect(() => createPlatformer(entity)).toThrow(/InputPlugin/);
  expect(entity.tryGet(RigidBodyComponent)).toBeUndefined();
});
it("rejects an invalid handoff without discarding pending motion", async () => {
  const { entity } = await setup();
  const motion = entity.get(MotionReconciler);
  const handle = motion.submitOnce({
    source: "jump",
    axis: "y",
    target: -100,
    acceleration: Infinity,
    priority: 1,
  });
  expect(() => motion.yieldToSolver({ x: NaN, y: 0 }, 1)).toThrow(/velocity.x/);
  expect(handle.active).toBe(true);
  expect(motion.solverOwned).toBe(false);
});

it("reports a translating platform crushing against a fixed wall with default groups", async () => {
  const { scene, entity, tick } = await setup({ crush: true });
  scene.spawn(Floor, { x: 24, y: 65, width: 20, height: 80 });
  const platform = scene.spawn(Floor, {
    x: -50,
    y: 65,
    width: 20,
    height: 80,
    kinematic: true,
  });
  platform.add(
    new MovingSurface({
      from: { x: -50, y: 65 },
      to: { x: 50, y: 65 },
      speed: 40,
    }),
  );
  let crushed = false;
  entity.on(PlatformerCrushedEvent, () => {
    crushed = true;
  });
  tick(120);
  expect(crushed).toBe(true);
});

it("climbs a small step while running", async () => {
  const { scene, input, body, tick } = await setup();
  scene.spawn(Floor, { x: 80, y: 87, width: 80, height: 6 });
  input.setDirection(1);
  tick(25);
  expect(body.positionX).toBeGreaterThan(60);
  expect(body.positionY).toBeCloseTo(84, 0);
});
it("follows an ascending slope", async () => {
  const { scene, input, body, controller, tick } = await setup();
  const ramp = scene.spawn("ramp");
  ramp.add(new Transform({ position: new Vec2(40, 90) }));
  ramp.add(new RigidBodyComponent({ type: "static" }));
  ramp.add(
    new ColliderComponent({
      shape: {
        type: "polygon",
        vertices: [
          { x: 0, y: 0 },
          { x: 100, y: -50 },
          { x: 100, y: 0 },
        ],
      },
      friction: 0,
    }),
  );
  input.setDirection(1);
  tick(25);
  expect(body.positionX).toBeGreaterThan(50);
  expect(body.positionY).toBeLessThan(84);
  expect(controller.grounded).toBe(true);
});
it("stops publishing carry velocity when a moving surface is disabled", async () => {
  const { floor, body, tick } = await setup();
  floor.get(RigidBodyComponent).setType("kinematic");
  const surface = floor.add(
    new MovingSurface({
      from: { x: 0, y: 100 },
      to: { x: 200, y: 100 },
      speed: 60,
    }),
  );
  tick(15);
  surface.enabled = false;
  tick(10);
  expect(surface.velocity.x).toBe(0);
  expect(body.velocityX).toBeCloseTo(0, 0);
});

it("accepts a custom headless resolver through the default assembly", async () => {
  const { body, input, tick } = await setup({
    resolveMotion: (intents, current, dt, surface) => {
      const result = resolveMotion(intents, current, dt, surface);
      return { ...result, x: Math.max(-75, Math.min(75, result.x)) };
    },
  });
  input.setDirection(1);
  tick(30);
  expect(body.velocityX).toBeCloseTo(75, 0);
});
it("attributes a throwing movement policy and stops the update", async () => {
  const state = { broken: false };
  const { tick } = await setup({
    limit: {
      get speedScale() {
        if (state.broken) throw new Error("speed policy failed");
        return 1;
      },
    },
  });
  state.broken = true;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => tick()).toThrow("speed policy failed");
  expect(
    engine?.context.resolve(ErrorBoundaryKey).getCallbackErrors(),
  ).toContainEqual(
    expect.objectContaining({
      kind: "Platformer movement policy",
      error: "speed policy failed",
    }),
  );
  log.mockRestore();
});

it("brakes a fall with the current policy rate and attributes invalid rates", async () => {
  const fall = { holdingFall: true, fallHoldRate: 600 };
  const { floor, body, tick } = await setup({ fall });
  floor.destroy();
  body.setVelocity({ x: 0, y: 100 });
  tick();
  expect(body.velocityY).toBeCloseTo(90, 1);
  fall.fallHoldRate = 1200;
  tick();
  expect(body.velocityY).toBeCloseTo(70, 1);
  fall.fallHoldRate = NaN;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => tick()).toThrow(/fallHoldRate/);
  expect(
    engine?.context.resolve(ErrorBoundaryKey).getCallbackErrors(),
  ).toContainEqual(
    expect.objectContaining({ kind: "Platformer movement policy" }),
  );
  expect(body.velocityY).toBeCloseTo(70, 1);
  log.mockRestore();
});

it("stops carrying riders when only the platform freezes and resumes together", async () => {
  const { floor, body, tick } = await setup();
  floor.get(RigidBodyComponent).setType("kinematic");
  const surface = floor.add(
    new MovingSurface({
      from: { x: 0, y: 100 },
      to: { x: 200, y: 100 },
      speed: 60,
    }),
  );
  tick(15);
  const riderX = body.positionX;
  floor.timeScale = 0;
  tick();
  const platformX = floor.get(RigidBodyComponent).positionX;
  tick(29);
  expect(surface.velocity.x).toBe(0);
  expect(body.velocityX).toBeCloseTo(0, 1);
  expect(Math.abs(body.positionX - riderX)).toBeLessThan(2);
  expect(floor.get(RigidBodyComponent).positionX).toBeCloseTo(platformX, 1);
  floor.timeScale = 1;
  tick(10);
  expect(body.velocityX).toBeCloseTo(60, 0);
});

it("reports disabled dashes unavailable and does not execute them", async () => {
  const { entity, input, tick } = await setup({ dash: false });
  const moves = entity.get(PlatformerMoves);
  expect(moves.dashReady).toBe(false);
  input.dash();
  tick();
  expect(moves.dashing).toBe(false);
});

it("gates dashes with live game state and leaves consequences to events", async () => {
  let stamina = 0;
  const { entity, input, tick } = await setup({
    admissionPolicies: {
      canStartMove: (move) => move !== "dash" || stamina >= 10,
    },
  });
  const admission = entity.get(MoveAdmission);
  const moves = entity.get(PlatformerMoves);
  const dashed = vi.fn(() => {
    stamina -= 10;
  });
  entity.on(PlatformerDashedEvent, dashed);
  expect(admission.canDash).toBe(false);
  expect(moves.dashReady).toBe(false);
  input.dash();
  tick();
  expect(moves.dashing).toBe(false);
  expect(admission.airCharges.dashes).toBe(1);
  stamina = 10;
  expect(moves.dashReady).toBe(true);
  tick();
  expect(moves.dashing).toBe(true);
  expect(dashed).toHaveBeenCalledTimes(1);
  expect(stamina).toBe(0);
});

it.each<PlatformerMove>(["groundJump", "airJump", "wallJump", "slide"])(
  "gates %s without spending its admission",
  async (move) => {
    let allowed = false;
    const policy = vi.fn((kind: PlatformerMove) => kind === move && allowed);
    const { entity, scene, floor, body, input, tick } = await setup({
      admissionPolicies: { canStartMove: policy },
      tuning: { coyoteTime: 0 },
    });
    const admission = entity.get(MoveAdmission);
    if (move === "airJump") {
      floor.destroy();
      tick(2);
    } else if (move === "wallJump") {
      scene.spawn(Floor, { x: 30, y: -20, width: 20, height: 200 });
      body.setPosition(12, -10);
      body.setVelocity({ x: 0, y: 100 });
      input.setDirection(1);
      tick();
    } else if (move === "slide") {
      input.setDirection(1);
      tick(35);
      input.setDown(true);
    }
    input.setJumpHeld(true);
    input.jump();
    tick();
    expect(admission.jumpsTaken).toBe(0);
    expect(body.velocityY).toBeGreaterThanOrEqual(0);
    expect(body.velocityX).toBeLessThan(450);
    expect(policy.mock.calls.some(([kind]) => kind === move)).toBe(true);
    allowed = true;
    if (move === "slide") {
      input.setDown(false);
      tick();
      input.setDown(true);
    }
    tick();
    if (move === "slide") expect(body.velocityX).toBeCloseTo(450, 0);
    else expect(admission.jumpsTaken).toBe(1);
  },
);

it("restores charges on demand without resetting dash cooldown", async () => {
  const { entity, floor, input, tick } = await setup();
  const admission = entity.get(MoveAdmission);
  const moves = entity.get(PlatformerMoves);
  floor.destroy();
  tick(10);
  input.dash();
  tick();
  expect(admission.airCharges).toEqual({ jumps: 1, dashes: 0 });
  admission.setAirCharges({ dashes: 2 });
  expect(admission.airCharges).toEqual({ jumps: 1, dashes: 2 });
  expect(moves.dashReady).toBe(false);
  tick(40);
  input.dash();
  tick();
  expect(admission.airCharges.dashes).toBe(1);
  admission.setAirCharges({ jumps: 0, dashes: 0 });
  admission.refillAirCharges();
  expect(admission.airCharges).toEqual({ jumps: 1, dashes: 1 });
});

it("uses a landing charge policy only on ground transitions", async () => {
  const landingCharges = vi.fn(() => ({ jumps: 2, dashes: 0 }));
  const { entity, input, tick } = await setup({
    admissionPolicies: { landingCharges },
  });
  const admission = entity.get(MoveAdmission);
  expect(landingCharges).toHaveBeenCalledTimes(1);
  expect(admission.airCharges).toEqual({ jumps: 2, dashes: 0 });
  expect(landingCharges.mock.calls[0]).toEqual([
    expect.objectContaining({ grounded: true }),
  ]);
  landingCharges.mockImplementation(() => ({ jumps: 0, dashes: 2 }));
  input.jump();
  tick(150);
  expect(landingCharges).toHaveBeenCalledTimes(2);
  expect(admission.airCharges).toEqual({ jumps: 0, dashes: 2 });
});

it("rejects invalid charge writes atomically", async () => {
  const { entity } = await setup();
  const admission = entity.get(MoveAdmission);
  for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => admission.setAirCharges({ jumps: 0, dashes: value })).toThrow(
      /dashes/,
    );
    expect(admission.airCharges).toEqual({ jumps: 1, dashes: 1 });
  }
});

it("attributes throwing admission policies without spending charges", async () => {
  const { entity, input, tick } = await setup({
    admissionPolicies: {
      canStartMove: () => {
        throw new Error("admission failed");
      },
    },
  });
  input.jump();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => tick()).toThrow("admission failed");
  expect(entity.get(MoveAdmission).airCharges).toEqual({ jumps: 1, dashes: 1 });
  expect(
    engine?.context.resolve(ErrorBoundaryKey).getCallbackErrors(),
  ).toContainEqual(
    expect.objectContaining({
      kind: "Platformer admission policy: canStartMove",
      error: "admission failed",
    }),
  );
  log.mockRestore();
});

it("rejects invalid landing charges before changing admission state", async () => {
  let broken = false;
  const { entity, input, tick } = await setup({
    admissionPolicies: {
      landingCharges: ({ airCharges }) =>
        broken ? { jumps: 0, dashes: NaN } : airCharges,
    },
  });
  const admission = entity.get(MoveAdmission);
  admission.setAirCharges({ jumps: 2, dashes: 3 });
  input.jump();
  tick(10);
  broken = true;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => tick(150)).toThrow(/dashes/);
  expect(admission.airCharges).toEqual({ jumps: 2, dashes: 3 });
  expect(
    engine?.context.resolve(ErrorBoundaryKey).getCallbackErrors(),
  ).toContainEqual(
    expect.objectContaining({
      kind: "Platformer admission policy: landingCharges",
    }),
  );
  log.mockRestore();
});
