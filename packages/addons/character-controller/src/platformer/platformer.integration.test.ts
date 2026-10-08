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
import { InputManagerKey, InputManager } from "@yagejs/input";
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
    oneWay = false,
    layers = 0xffff,
    mask = 0xffff,
  } = {}): void {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new RigidBodyComponent({ type: kinematic ? "kinematic" : "static" }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "box", width, height },
        layers,
        mask,
        friction: 0,
        ...(oneWay ? { oneWay: {} } : {}),
      }),
    );
  }
}
import {
  PlatformerController,
  PlatformerLandedEvent,
} from "./PlatformerController.js";
import {
  PlatformerInput,
  PlatformerInputBinding,
  platformerControls,
} from "./input.js";
import {
  PlatformerMoves,
  PlatformerJumpedEvent,
  PlatformerDashedEvent,
} from "./PlatformerMoves.js";
import { MotionReconciler } from "./MotionReconciler.js";
import { LedgeProbe } from "./LedgeProbe.js";
import { Stance } from "./Stance.js";
import { GroundProbe } from "./GroundProbe.js";

let engine: Engine | undefined;
afterEach(() => engine?.destroy());
async function setup(options: CreatePlatformerOptions = {}, devices = false) {
  engine = await createTestEngine({}, [new PhysicsPlugin()]);
  const manager = devices ? new InputManager() : undefined;
  if (manager) {
    manager.setActionMap(platformerControls());
    manager._setErrorBoundary(engine.context.resolve(ErrorBoundaryKey));
    engine.context.register(InputManagerKey, manager);
  }
  const scene = new TestScene();
  await engine.scenes.push(scene);
  const floor = scene.spawn(Floor, {});
  const entity = scene.spawn(Actor, options);
  const body = entity.get(RigidBodyComponent);
  const input = entity.get(PlatformerInput);
  const controller = entity.get(PlatformerController);
  const tick = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      if (engine) advanceFrames(engine, 1);
      manager?._clearFrameState();
    }
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

it("does not substitute an air jump for a denied ground jump", async () => {
  const { entity, floor, input, tick } = await setup({
    admissionPolicies: { canStartMove: (move) => move !== "groundJump" },
  });
  const admission = entity.get(MoveAdmission);
  const jumped = vi.fn();
  entity.on(PlatformerJumpedEvent, jumped);
  input.jump();
  tick();
  expect(jumped).not.toHaveBeenCalled();
  expect(admission.canAirJump).toBe(false);
  expect(admission.airCharges.jumps).toBe(1);
  tick(10);
  floor.destroy();
  tick(2);
  input.jump();
  tick();
  expect(jumped).toHaveBeenCalledWith({ kind: "air" });
  expect(admission.airCharges.jumps).toBe(0);
});

it.each(["keyboard", "pointer"])(
  "discards %s move presses buffered during a freeze on reset",
  async (device) => {
    const { entity, scene, input, tick } = await setup(
      {
        input: new PlatformerInputBinding(undefined, () => ({
          x: 0,
          width: 800,
        })),
      },
      true,
    );
    const manager = entity.scene.context.resolve(InputManagerKey);
    const jumped = vi.fn();
    const dashed = vi.fn();
    entity.on(PlatformerJumpedEvent, jumped);
    entity.on(PlatformerDashedEvent, dashed);
    scene.timeScale = 0;
    if (device === "keyboard") {
      manager.fireKeyDown("Space");
    } else {
      manager.firePointerMove(700, 20, { id: 2, type: "touch" });
      manager.firePointerDown(0, { id: 2, type: "touch" });
    }
    manager.fireKeyDown("ShiftLeft");
    manager.fireKeyDown("KeyD");
    tick();
    expect(input.direction).toBe(1);
    manager.clearAll();
    expect(input.direction).toBe(0);
    scene.timeScale = 1;
    tick(10);
    expect(jumped).not.toHaveBeenCalled();
    expect(dashed).not.toHaveBeenCalled();
    manager.fireKeyDown("Space");
    tick();
    expect(jumped).toHaveBeenCalledTimes(1);
  },
);

it("keeps a started dash and its cooldown through an input reset", async () => {
  const { entity, tick } = await setup(
    { input: new PlatformerInputBinding() },
    true,
  );
  const manager = entity.scene.context.resolve(InputManagerKey);
  const moves = entity.get(PlatformerMoves);
  manager.fireKeyDown("ShiftLeft");
  tick();
  manager.clearAll();
  tick();
  expect(moves.dashing).toBe(true);
  expect(moves.dashReady).toBe(false);
});

it.each([true, false])(
  "ignores one-way drop-through support with terrain=%s",
  async (terrain) => {
    const { entity, scene, floor, body, controller, tick } = await setup({
      terrain,
    });
    floor.destroy();
    scene.spawn(Floor, { oneWay: true });
    tick(5);
    expect(controller.grounded).toBe(true);
    const admission = entity.get(MoveAdmission);
    const ground = entity.get(GroundProbe);
    expect(ground.supportOneWay).toBe(true);
    expect(controller.onOneWay).toBe(true);
    expect(admission.canDropThrough).toBe(true);
    const landed = vi.fn();
    entity.on(PlatformerLandedEvent, landed);
    admission.setAirCharges({ jumps: 0, dashes: 0 });
    admission.spendDropThrough();
    expect(admission.canDropThrough).toBe(false);
    expect(admission.canGroundJump).toBe(false);
    expect(admission.jumpsTaken).toBe(0);
    entity.get(ColliderComponent).dropThrough(0.5);
    tick();
    expect(controller.grounded).toBe(false);
    expect(ground.supportOneWay).toBe(false);
    expect(controller.onOneWay).toBe(false);
    expect(admission.canGroundJump).toBe(false);
    for (let frame = 0; frame < 25; frame++) {
      tick();
      expect(controller.grounded).toBe(false);
      expect(admission.airCharges).toEqual({ jumps: 0, dashes: 0 });
    }
    expect(landed).not.toHaveBeenCalled();
    expect(body.positionY).toBeGreaterThan(120);
    scene.spawn(Floor, { y: 450, oneWay: true });
    tick(60);
    expect(controller.grounded).toBe(true);
    expect(admission.canDropThrough).toBe(true);
    expect(admission.airCharges).toEqual({ jumps: 1, dashes: 1 });
    expect(landed).toHaveBeenCalledTimes(1);
  },
);

it("rejects drops on solid ground and during one-way coyote time", async () => {
  const { entity, floor, scene, controller, tick } = await setup();
  const admission = entity.get(MoveAdmission);
  expect(controller.onOneWay).toBe(false);
  expect(entity.get(GroundProbe).supportOneWay).toBe(false);
  expect(admission.canDropThrough).toBe(false);
  expect(() => admission.spendDropThrough()).toThrow(/no drop-through/);
  expect(admission.canGroundJump).toBe(true);
  floor.destroy();
  const platform = scene.spawn(Floor, { oneWay: true });
  tick(5);
  expect(admission.canDropThrough).toBe(true);
  platform.destroy();
  tick();
  expect(admission.canGroundJump).toBe(true);
  expect(admission.canDropThrough).toBe(false);
  expect(() => admission.spendDropThrough()).toThrow(/no drop-through/);
  expect(admission.canGroundJump).toBe(true);
});

it("admits a drop under a low ceiling independently of ground-jump policy", async () => {
  let allowDrop = false;
  const policy = vi.fn(
    (move: PlatformerMove) => move === "dropThrough" && allowDrop,
  );
  const { entity, scene, floor, input, controller, tick } = await setup({
    admissionPolicies: { canStartMove: policy },
  });
  floor.destroy();
  scene.spawn(Floor, { oneWay: true });
  input.setDown(true);
  tick(5);
  scene.spawn(Floor, { y: 43, height: 20 });
  input.setDown(false);
  tick(5);
  const admission = entity.get(MoveAdmission);
  expect(controller.blocked).toBe(true);
  expect(controller.onOneWay).toBe(true);
  expect(admission.canGroundJump).toBe(false);
  expect(admission.canDropThrough).toBe(false);
  expect(() => admission.spendDropThrough()).toThrow(/no drop-through/);
  allowDrop = true;
  expect(admission.canDropThrough).toBe(true);
  expect(policy).toHaveBeenLastCalledWith(
    "dropThrough",
    expect.objectContaining({
      grounded: true,
      onOneWay: true,
      blocked: true,
    }),
  );
  const charges = admission.airCharges;
  admission.spendDropThrough();
  expect(admission.airCharges).toEqual(charges);
  expect(admission.jumpsTaken).toBe(0);
  expect(() => admission.spendDropThrough()).toThrow(/no drop-through/);
});

it("records game-owned ledge departure without wall contact or air charges", async () => {
  const { entity, floor, tick } = await setup({
    admissionPolicies: { canStartMove: (move) => move !== "wallJump" },
  });
  const admission = entity.get(MoveAdmission);
  floor.destroy();
  tick();
  admission.setAirCharges({ jumps: 0, dashes: 0 });
  expect(admission.canGroundJump).toBe(true);
  expect(admission.wallJumpSide).toBe(0);
  expect(admission.canWallJump).toBe(false);
  const jumped = vi.fn();
  entity.on(PlatformerJumpedEvent, jumped);
  admission.recordLedgeJump();
  expect(admission.jumpsTaken).toBe(1);
  expect(admission.canGroundJump).toBe(false);
  expect(admission.airCharges).toEqual({ jumps: 0, dashes: 0 });
  expect(jumped).not.toHaveBeenCalled();
});

it("consumes wall eligibility on ledge departure until new wall contact", async () => {
  const { entity, scene, body, input, tick } = await setup();
  scene.spawn(Floor, { x: 30, y: -20, width: 20, height: 200 });
  body.setPosition(12, -10);
  body.setVelocity({ x: 0, y: 100 });
  input.setDirection(1);
  tick(2);
  const admission = entity.get(MoveAdmission);
  expect(admission.canWallJump).toBe(true);
  const charges = admission.airCharges;
  admission.recordLedgeJump();
  tick();
  expect(admission.canWallJump).toBe(false);
  expect(admission.airCharges).toEqual(charges);
  body.setPosition(-20, -10);
  tick();
  expect(admission.canWallJump).toBe(false);
  body.setPosition(12, -10);
  tick();
  expect(admission.canWallJump).toBe(true);
  expect(admission.jumpsTaken).toBe(1);
});

it("does not land on a contact-filtered platform while descending past its top", async () => {
  const { entity, floor, body, controller, tick } = await setup();
  const admission = entity.get(MoveAdmission);
  admission.setAirCharges({ jumps: 0, dashes: 0 });
  floor.get(ColliderComponent).setContactFilter(() => false);
  body.setPosition(0, 88);
  body.setVelocity({ x: 0, y: 30 });
  const landed = vi.fn();
  entity.on(PlatformerLandedEvent, landed);
  tick(20);
  expect(controller.grounded).toBe(false);
  expect(admission.airCharges).toEqual({ jumps: 0, dashes: 0 });
  expect(landed).not.toHaveBeenCalled();
  expect(body.positionY).toBeGreaterThan(120);
});

it("walks over consecutive six-pixel steps in both directions", async () => {
  const { scene, floor, body, input, tick } = await setup();
  floor.destroy();
  scene.spawn(Floor, { x: 1500, y: 570, width: 1000, height: 60 });
  body.setPosition(1250, 540);
  for (let step = 0; step < 10; step++) {
    const height = 6 * (step < 5 ? step + 1 : 10 - step);
    scene.spawn(Floor, {
      x: 1360 + step * 40,
      y: 540 - height / 2,
      width: 40,
      height,
    });
  }
  tick(10);
  input.setDirection(1);
  tick(190);
  expect(body.positionX).toBeGreaterThan(1750);
  input.setDirection(-1);
  tick(200);
  expect(body.positionX).toBeLessThan(1330);
});

it.each([190, 260])(
  "crosses alternating ramp crests and valleys at speed %s in both directions",
  async (runSpeed) => {
    const { scene, floor, body, input, tick } = await setup({
      tuning: { runSpeed },
    });
    floor.destroy();
    scene.spawn(Floor, { x: 2400, y: 570, width: 1600, height: 60 });
    body.setPosition(1850, 540);
    const heights = [0, 70, 15, 100, 25, 80, 0];
    for (let n = 0; n < heights.length - 1; n++) {
      const ramp = scene.spawn("ramp");
      ramp.add(new Transform({ position: new Vec2(1960 + n * 140, 540) }));
      ramp.add(new RigidBodyComponent({ type: "static" }));
      ramp.add(
        new ColliderComponent({
          shape: {
            type: "polygon",
            vertices: [
              { x: 0, y: -(heights[n] ?? 0) },
              { x: 140, y: -(heights[n + 1] ?? 0) },
              { x: 140, y: 20 },
              { x: 0, y: 20 },
            ],
          },
          friction: 0,
        }),
      );
    }
    tick(10);
    input.setDirection(1);
    tick(Math.ceil((360 * 190) / runSpeed));
    expect(body.positionX).toBeGreaterThan(2800);
    input.setDirection(-1);
    tick(Math.ceil((390 * 190) / runSpeed));
    expect(body.positionX).toBeLessThan(1960);
  },
);

it("keeps the actor out of ledge clearance queries when excluding the support", async () => {
  const { scene, floor, body, entity } = await setup();
  floor.destroy();
  scene.spawn(Floor, { x: 3700, y: 475, width: 160, height: 130 });
  body.setPosition(3612.002, 442.5);
  body.setVelocity({ x: 0, y: 0 });
  const probe = entity.add(
    new LedgeProbe({
      tuning: {
        bodyWidth: 16,
        ledgeHandHeight: 32,
        ledgeGrabReach: 10,
        ledgeGrabTolerance: 12,
      },
      grab: 0xffffffff,
      volume: 0xffffffff,
    }),
  );
  const contact = probe.find(1);
  expect(contact).toBeDefined();
  if (!contact) throw new Error("Expected a reachable ledge");
  const from = body.position;
  const target = probe.points(contact).hang;
  const length = Math.hypot(target.x - from.x, target.y - from.y);
  const fraction = Math.min(1, 3 / length);
  const to = {
    x: from.x + (target.x - from.x) * fraction,
    y: from.y + (target.y - from.y) * fraction,
  };
  expect(probe.clearStep(from, to, contact, 1 / 60)).toBe(true);
  scene.spawn(Floor, { x: to.x, y: to.y - 22, width: 4, height: 4 });
  expect(probe.clearStep(from, to, contact, 1 / 60)).toBe(false);
});

it("applies packed collision membership and filters to the character body", async () => {
  const groups = (1 << 16) | 2;
  const { scene, body, input, tick } = await setup({
    collisionGroups: groups,
    collision: { solid: groups, volume: groups, wall: groups },
  });
  scene.spawn(Floor, {
    x: 80,
    y: 50,
    width: 20,
    height: 80,
    layers: 4,
    mask: 1,
  });
  scene.spawn(Floor, {
    x: 140,
    y: 50,
    width: 20,
    height: 80,
    layers: 2,
    mask: 1,
  });
  input.setDirection(1);
  tick(80);
  expect(body.positionX).toBeGreaterThan(100);
  expect(body.positionX).toBeLessThan(124);
});

it.each(["tall riser", "low ceiling"])(
  "keeps step assistance bounded by %s",
  async (obstruction) => {
    const { scene, body, input, tick } = await setup();
    const height = obstruction === "tall riser" ? 8 : 6;
    scene.spawn(Floor, { x: 80, y: 90 - height / 2, width: 80, height });
    if (obstruction === "low ceiling")
      scene.spawn(Floor, { x: 80, y: 36, width: 100, height: 20 });
    input.setDirection(1);
    tick(70);
    expect(body.positionX).toBeLessThan(33);
    expect(body.positionY).toBeGreaterThan(89);
  },
);
