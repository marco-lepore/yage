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

import { Transform, createMockScene } from "@yagejs/core";
import { Facing } from "@yagejs-addons/abilities";
import {
  AnimatedSpriteComponent,
  AnimationController,
  SceneRenderTreeKey,
  SceneRenderTreeProviderImpl,
  registerTexture,
  unregisterTexture,
} from "@yagejs/renderer";
import { Container, Texture, TextureSource } from "pixi.js";
import {
  BOXER_ANIM_SPECS,
  BoxerFootAnchorTracking,
  DEFAULT_DIR,
  FRAME_H,
  FRAME_W,
  PLAYER_ANIMS,
  SPRITE_ANCHOR,
  boxerKey,
  buildBoxerAnimDefs,
  handlesFor,
  playBoxerAnim,
  playStaggerAnim,
  sourceFor,
} from "./boxer-sprites.js";

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
});

afterAll(() => {
  for (const [path, texture] of sheets) {
    unregisterTexture(path);
    texture.destroy(true);
  }
});

function boxer() {
  const { scene } = createMockScene();
  const provider = new SceneRenderTreeProviderImpl(new Container());
  scene._registerScoped(SceneRenderTreeKey, provider.createForScene(scene));
  const entity = scene.spawn("boxer");
  entity.add(new Transform());
  const sprite = entity.add(
    new AnimatedSpriteComponent({
      source: sourceFor("idle", DEFAULT_DIR),
      anchor: SPRITE_ANCHOR,
    }),
  );
  const observer = vi.fn();
  const unsubscribe = sprite.onFrameChange(observer);
  const tracking = entity.add(new BoxerFootAnchorTracking());
  const controller = entity.add(
    new AnimationController(buildBoxerAnimDefs(PLAYER_ANIMS)),
  );
  entity.add(new Facing());
  cleanups.push(() => {
    unsubscribe();
    entity.destroy();
    scene._flushDestroyQueue();
    provider.destroyForScene(scene);
  });
  return { entity, sprite, controller, tracking, observer };
}

describe("boxer animations", () => {
  it("plants the first displayed frame and preserves other frame listeners after removal", () => {
    const { entity, sprite, tracking, observer } = boxer();
    playBoxerAnim(entity, "run", { oneShot: false });
    sprite.gotoFrame(5);
    observer.mockClear();
    playBoxerAnim(entity, "idle", { oneShot: false });
    expect(sprite.frame).toBe(0);
    // East-facing idle frame zero has feet at (66, 110), 45 rows below the torso.
    expect(sprite.animatedSprite.anchor.x).toBeCloseTo(66 / 126);
    expect(sprite.animatedSprite.anchor.y).toBeCloseTo(65 / 132);
    expect(observer).toHaveBeenCalledWith(0);

    tracking.destroy();
    sprite.animatedSprite.anchor.set(0.2, 0.3);
    observer.mockClear();
    sprite.gotoFrame(5);
    expect(observer).toHaveBeenCalledWith(5);
    expect(sprite.animatedSprite.anchor.x).toBe(0.2);
    expect(sprite.animatedSprite.anchor.y).toBe(0.3);
  });

  it.each([
    ["chargeRelease", 6, 0.751],
    ["melee", 7, 0.65],
  ] as const)(
    "starts %s at its trimmed frame and locks for the remaining clip",
    (anim, startFrame, phaseDuration) => {
      const { entity, sprite, controller } = boxer();
      playBoxerAnim(entity, anim, { oneShot: true, startFrame });
      expect(sprite.frame).toBe(startFrame);
      const spec = BOXER_ANIM_SPECS[anim];
      const duration = (spec.frames - startFrame) / (60 * spec.speed);
      controller.update(phaseDuration);
      expect(controller.locked).toBe(true);
      controller.play(boxerKey("idle", DEFAULT_DIR));
      expect(controller.current).toBe(boxerKey(anim, DEFAULT_DIR));
      controller.update(duration - phaseDuration + 0.000001);
      expect(controller.locked).toBe(false);
      controller.play(boxerKey("idle", DEFAULT_DIR));
      expect(controller.current).toBe(boxerKey("idle", DEFAULT_DIR));
    },
  );

  it("replaces unfinished kick locks with each different combo shot", () => {
    const { entity, controller, sprite } = boxer();
    playBoxerAnim(entity, "melee", { oneShot: true, startFrame: 7 });
    controller.update(0.65);
    expect(controller.locked).toBe(true);
    playBoxerAnim(entity, "chargeRelease", { oneShot: true, startFrame: 6 });
    expect(controller.current).toBe(boxerKey("chargeRelease", DEFAULT_DIR));
    expect(sprite.frame).toBe(6);
    controller.update(0.66);
    expect(controller.locked).toBe(true);
    playBoxerAnim(entity, "attack3", { oneShot: true });
    expect(controller.current).toBe(boxerKey("attack3", DEFAULT_DIR));
    expect(sprite.frame).toBe(0);
  });

  it("keeps ordinary same-key one-shots from restarting", () => {
    const { entity, controller, sprite } = boxer();
    playBoxerAnim(entity, "melee", { oneShot: true, startFrame: 7 });
    sprite.update(0.1);
    const frame = sprite.frame;
    playBoxerAnim(entity, "melee", { oneShot: true, startFrame: 7 });
    expect(sprite.frame).toBe(frame);
    controller.update(
      controller.calcDuration(boxerKey("melee", DEFAULT_DIR), {
        startFrame: 7,
      }),
    );
    expect(controller.locked).toBe(false);
  });

  it.each([1.5, 21 / (60 * 0.55), 0.1])(
    "uses a temporary stagger multiplier for a %ss stun",
    (stun) => {
      const { entity, sprite, controller } = boxer();
      const speed = Math.min(
        0.7,
        Math.max(0.32, 21 / (60 * Math.max(stun, 0.05))),
      );
      playStaggerAnim(entity, stun);
      expect(sprite.animatedSprite.animationSpeed).toBeCloseTo(speed);
      expect(controller.speed).toBe(1);
      const duration = 21 / (60 * speed);
      controller.update(duration - 0.000001);
      expect(controller.locked).toBe(true);
      controller.update(0.000002);
      expect(controller.locked).toBe(false);
      playBoxerAnim(entity, "idle", { oneShot: false });
      expect(sprite.animatedSprite.animationSpeed).toBe(
        BOXER_ANIM_SPECS.idle.speed,
      );
    },
  );

  it("restarts a repeated stagger at frame zero with its new speed and full lock", () => {
    const { entity, sprite, controller } = boxer();
    playStaggerAnim(entity, 1.5);
    sprite.update(0.5);
    controller.update(0.5);
    expect(sprite.frame).toBe(9);
    playStaggerAnim(entity, 0.1);
    expect(sprite.frame).toBe(0);
    expect(sprite.animatedSprite.animationSpeed).toBeCloseTo(0.7);
    controller.update(0.499999);
    expect(controller.locked).toBe(true);
    controller.update(0.000002);
    expect(controller.locked).toBe(false);
  });

  it("cancels an interrupted stagger callback once when restarting the reaction", () => {
    const { entity, controller } = boxer();
    const onCancel = vi.fn();
    const onComplete = vi.fn();
    controller.playOneShot(boxerKey("stagger", DEFAULT_DIR), {
      onCancel,
      onComplete,
    });
    playStaggerAnim(entity, 0.1);
    controller.update(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
