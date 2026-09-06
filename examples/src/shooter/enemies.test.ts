import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dimforge/rapier2d", () => ({ default: {} }));
vi.mock("@pixi/sound", () => ({ sound: {} }));

import { Component, ProcessComponent, Transform, Vec2 } from "@yagejs/core";
import {
  AnimatedSpriteComponent,
  CameraEntity,
  DisplaySystem,
  registerTexture,
  unregisterTexture,
} from "@yagejs/renderer";
import { AudioManagerKey, type AudioManager } from "@yagejs/audio";
import {
  ColliderComponent,
  PhysicsWorldKey,
  RigidBodyComponent,
  type PhysicsWorld,
} from "@yagejs/physics";
import { BufferImageSource, Texture } from "pixi.js";
import { createExampleScene } from "../shared/test-helpers.js";
import { EnemyEntity } from "./enemies.js";
import { Hurt } from "./constants.js";
import { createVfxHub } from "./particles.js";

const sheets = [
  ["/assets/skeleton_idle.png", 24, 32],
  ["/assets/skeleton_walk.png", 22, 33],
  ["/assets/skeleton_react.png", 22, 32],
  ["/assets/skeleton_attack.png", 43, 37],
  ["/assets/skeleton_hit.png", 30, 32],
  ["/assets/skeleton_die.png", 33, 32],
] as const;

beforeEach(() => {
  // The example's feedback sequence runs without a native physics step.
  for (const method of [
    "onAdd",
    "onEnable",
    "onDisable",
    "onDestroy",
  ] as const) {
    vi.spyOn(RigidBodyComponent.prototype, method).mockImplementation(() => {});
    vi.spyOn(ColliderComponent.prototype, method).mockImplementation(() => {});
  }
  vi.spyOn(RigidBodyComponent.prototype, "getVelocity").mockReturnValue(
    Vec2.ZERO,
  );
  vi.spyOn(RigidBodyComponent.prototype, "setVelocity").mockImplementation(
    () => {},
  );
  vi.spyOn(ColliderComponent.prototype, "setSensor").mockImplementation(
    () => {},
  );
  for (const [key, frameWidth, height] of sheets) {
    const width = frameWidth * 12;
    registerTexture(
      key,
      new Texture({
        source: new BufferImageSource({
          resource: new Uint8Array(width * height * 4),
          width,
          height,
        }),
      }),
    );
  }
});

afterEach(() => {
  for (const [key] of sheets) unregisterTexture(key);
  vi.restoreAllMocks();
});

function setup() {
  const { scene, context } = createExampleScene();
  context.register(AudioManagerKey, {
    play: vi.fn(),
  } as unknown as AudioManager);
  scene.registerScoped(PhysicsWorldKey, {} as PhysicsWorld);
  const camera = new CameraEntity();
  vi.spyOn(camera, "shake").mockImplementation(() => {});
  const vfx = createVfxHub(scene);
  const enemy = scene.spawn(EnemyEntity, {
    x: 100,
    y: 200,
    patrolLeft: 0,
    patrolRight: 300,
    camera,
    vfx,
  });
  const transform = enemy.get(Transform);
  const sprite = enemy.get(AnimatedSpriteComponent);
  const processes = enemy.get(ProcessComponent);
  const display = new DisplaySystem();
  display.onRegister(context);
  return { enemy, transform, sprite, processes, display };
}

describe("shooter enemy hit shake", () => {
  it("survives rendering, leaves the game position alone, and resets on completion", () => {
    const { enemy, transform, sprite, processes, display } = setup();
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    enemy.emit(Hurt, { dir: 1 });
    processes._tick(0.05);
    display.update();
    expect(sprite.animatedSprite.position.x).toBe(101);
    expect(sprite.animatedSprite.position.y).toBe(201);
    expect(transform.position).toEqual(new Vec2(100, 200));
    processes._tick(0.11);
    display.update();
    expect(sprite.animatedSprite.position.x).toBe(100);
    expect(sprite.animatedSprite.position.y).toBe(200);
    expect(transform.position).toEqual(new Vec2(100, 200));
  });

  it("restarts on another hit and clears the modifier when its owner is removed", () => {
    const { enemy, sprite, processes, display } = setup();
    vi.spyOn(Math, "random").mockReturnValue(0);
    enemy.emit(Hurt, { dir: 1 });
    processes._tick(0.1);
    enemy.emit(Hurt, { dir: 1 });
    processes._tick(0.1);
    display.update();
    expect(sprite.animatedSprite.position.x).toBe(98);
    const owner = enemy
      .getAll(Component)
      .find((component) => component.constructor.name === "EnemyController")!;
    owner.destroy();
    display.update();
    expect(sprite.modifiers.hasTransformModifiers).toBe(false);
    expect(sprite.animatedSprite.position.x).toBe(100);
  });

  it("clears active shake on death without moving the authoritative position", () => {
    const { enemy, transform, sprite, processes, display } = setup();
    vi.spyOn(Math, "random").mockReturnValue(0.75);
    enemy.emit(Hurt, { dir: 1 });
    processes._tick(0.05);
    enemy.emit(Hurt, { dir: 1 });
    enemy.emit(Hurt, { dir: 1 });
    display.update();
    expect(enemy.tags.has("dead")).toBe(true);
    expect(sprite.animatedSprite.position.x).toBe(100);
    expect(sprite.animatedSprite.position.y).toBe(200);
    expect(transform.position).toEqual(new Vec2(100, 200));
  });
});
