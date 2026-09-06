import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@dimforge/rapier2d", async () => {
  const module = await import("@dimforge/rapier2d-compat");
  await module.default.init();
  return { default: module.default };
});
vi.mock("@pixi/sound", () => ({ sound: {} }));

import { Transform, createMockScene } from "@yagejs/core";
import { Abilities, Health } from "@yagejs-addons/abilities";
import {
  GraphicsComponent,
  SceneRenderTreeKey,
  SceneRenderTreeProviderImpl,
  registerTexture,
  unregisterTexture,
} from "@yagejs/renderer";
import { InputManager, InputManagerKey } from "@yagejs/input";
import { ParticleEmitterComponent, ParticleSystem } from "@yagejs/particles";
import { PhysicsWorld, PhysicsWorldKey } from "@yagejs/physics";
import { Container, Texture, TextureSource } from "pixi.js";
import {
  BOXER_ANIM_SPECS,
  FRAME_H,
  FRAME_W,
  handlesFor,
} from "./boxer-sprites.js";
import { PlayerController, PlayerEntity } from "./player.js";
import { FIST_CHARGE } from "./player-abilities.js";
import * as feedback from "./feedback.js";

const sheets = new Map<string, Texture>();
const cleanups: (() => void)[] = [];

beforeAll(() => {
  for (const spec of Object.values(BOXER_ANIM_SPECS)) {
    for (const handle of handlesFor(spec.sheet)) {
      if (sheets.has(handle.path)) continue;
      const texture = new Texture({
        source: new TextureSource({ width: FRAME_W * 65, height: FRAME_H }),
      });
      sheets.set(handle.path, texture);
      registerTexture(handle.path, texture);
    }
  }
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const [path, texture] of sheets) {
    unregisterTexture(path);
    texture.destroy(true);
  }
});

function player() {
  const { scene, context } = createMockScene();
  const provider = new SceneRenderTreeProviderImpl(new Container());
  const tree = provider.createForScene(scene);
  scene._registerScoped(SceneRenderTreeKey, tree);
  const world = new PhysicsWorld({ gravity: { x: 0, y: 0 } });
  scene._registerScoped(PhysicsWorldKey, world);
  const input = new InputManager();
  input.setActionMap({
    attack: ["Space"],
    dash: ["ShiftLeft"],
    guard: ["KeyF"],
    potion: ["KeyQ"],
  });
  context.register(InputManagerKey, input);
  const particles = new ParticleSystem();
  particles.onRegister(context);
  const entity = scene.spawn(PlayerEntity);
  const controller = entity.get(PlayerController);
  const abilities = entity.get(Abilities);
  const startCharge = () => {
    abilities.send(FIST_CHARGE.id);
    controller.update();
    return entity.get(ParticleEmitterComponent);
  };
  const stopCharge = () => {
    abilities.cancel();
    controller.update();
  };
  cleanups.push(() => {
    entity.destroy();
    scene._flushDestroyQueue();
    provider.destroyForScene(scene);
    world.destroy();
  });
  return { entity, controller, particles, tree, startCharge, stopCharge };
}

describe("player charge particles", () => {
  it("matches the scaled ring geometry, fading, and local movement", () => {
    const { entity, particles, tree, startCharge } = player();
    const emitter = startCharge();
    expect(emitter.isEmitting).toBe(true);
    expect(emitter.activeCount).toBe(10);
    expect(emitter.container.parent).toBe(tree.defaultLayer.container);
    for (const particle of emitter.container.particleChildren) {
      expect(Math.hypot(particle.x, particle.y)).toBeCloseTo(25.2);
      expect(particle.texture.width * particle.scaleX).toBeCloseTo(3.6);
      expect(particle.texture.height * particle.scaleY).toBeCloseTo(3.6);
      expect(particle).toHaveProperty("alpha", expect.closeTo(0.35));
      expect(particle).toHaveProperty("tint", 0xffe066);
    }
    const transform = entity.get(Transform);
    transform.setPosition(150, 230);
    particles.update(0.1);
    expect(emitter.container.position.x).toBe(150);
    expect(emitter.container.position.y).toBe(230);
    expect(emitter.activeCount).toBe(10);
    for (const particle of emitter.container.particleChildren) {
      expect(Math.hypot(particle.x, particle.y)).toBeCloseTo(18.6);
      expect(particle).toHaveProperty("alpha", expect.closeTo(0.2583333333));
    }
  });

  it("removes the effect immediately on release and starts ten fresh particles on recharge", () => {
    const { entity, controller, particles, tree, startCharge, stopCharge } =
      player();
    const emitter = startCharge();
    particles.update(0.1);
    controller.update();
    expect(entity.get(ParticleEmitterComponent)).toBe(emitter);
    expect(emitter.activeCount).toBe(10);
    stopCharge();
    expect(entity.has(ParticleEmitterComponent)).toBe(false);
    expect(emitter.container.destroyed).toBe(true);
    expect(tree.defaultLayer.container.children).not.toContain(
      emitter.container,
    );
    expect(entity.has(GraphicsComponent)).toBe(true);

    const next = startCharge();
    expect(next).not.toBe(emitter);
    expect(next.activeCount).toBe(10);
    for (const particle of next.container.particleChildren) {
      expect(Math.hypot(particle.x, particle.y)).toBeCloseTo(25.2);
      expect(particle).toHaveProperty("alpha", expect.closeTo(0.35));
    }
  });

  it("destroys charge particles when the controller is removed", () => {
    const { entity, controller, startCharge } = player();
    const emitter = startCharge();
    controller.destroy();
    expect(entity.has(ParticleEmitterComponent)).toBe(false);
    expect(emitter.container.destroyed).toBe(true);
  });

  it("removes charge particles on death", () => {
    const { entity, controller, startCharge } = player();
    const emitter = startCharge();
    vi.spyOn(feedback, "cameraOf").mockReturnValue({ shake: vi.fn() } as never);
    vi.spyOn(feedback, "playDeathSfx").mockImplementation(() => {});
    entity.get(Health).takeDamage(100);
    expect(controller.dead).toBe(true);
    expect(controller.charging).toBe(false);
    expect(entity.has(ParticleEmitterComponent)).toBe(false);
    expect(emitter.container.destroyed).toBe(true);
  });

  it.each([
    [30, 2 / 30, 7.87],
    [60, 3 / 60, 8.18],
    [120, 5 / 120, 8.34],
  ])(
    "keeps the measured continuous-stream population at %s Hz",
    (fps, expectedGap, expectedMean) => {
      const { particles, startCharge } = player();
      const emitter = startCharge();
      let emptyFrames = 0;
      let total = 0;
      let afterFirstGap = false;
      for (let frame = 0; frame < fps * 2; frame++) {
        particles.update(1 / fps);
        const count = emitter.activeCount;
        total += count;
        expect(count).toBeLessThanOrEqual(10);
        if (count === 0) emptyFrames++;
        if (emptyFrames > 0 && count > 0) afterFirstGap = true;
      }
      expect(afterFirstGap).toBe(true);
      expect(emptyFrames / fps).toBeCloseTo(expectedGap);
      expect(total / (fps * 2)).toBeCloseTo(expectedMean, 1);
    },
  );
});
