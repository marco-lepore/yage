import { afterEach, describe, expect, it } from "vitest";
import {
  Transform,
  Vec2,
  createMockEntity,
  isSerializable,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RenderLayerManager,
  SceneRenderTreeKey,
  SpriteComponent,
  registerTexture,
  unregisterTexture,
  type SceneRenderTree,
} from "@yagejs/renderer";
import { Texture } from "pixi.js";
import { Feel } from "../Feel.js";
import { feelAfterimage } from "./afterimage.js";

const SOURCE_TEXTURE = "feel-afterimage-test-source";

afterEach(() => unregisterTexture(SOURCE_TEXTURE));

function createRenderedHost() {
  const setup = createMockEntity();
  const root = new GraphicsComponent();
  const layers = new RenderLayerManager(root.graphics);
  const tree: SceneRenderTree = {
    root: root.graphics,
    get: (name) => layers.get(name),
    tryGet: (name) => layers.tryGet(name),
    getAll: () => layers.getAll(),
    get defaultLayer() {
      return layers.defaultLayer;
    },
    ensureLayer: (def, options) =>
      layers.tryGet(def.name) ?? layers.createFromDef(def, options),
    fx: root.fx,
    setMask: () => {
      throw new Error("Masks are not used by this test.");
    },
    clearMask: () => {},
  };
  setup.scene._registerScoped(SceneRenderTreeKey, tree);
  setup.entity.add(new Transform({ position: { x: 100, y: 80 } }));
  registerTexture(SOURCE_TEXTURE, Texture.EMPTY);
  const visual = setup.entity.add(
    new SpriteComponent({
      texture: SOURCE_TEXTURE,
      anchor: { x: 0.5, y: 0.75 },
      alpha: 0.8,
    }),
  );
  return { ...setup, visual };
}

describe("feelAfterimage", () => {
  it("captures rendered sprite poses and removes every copy cleanly", () => {
    const { entity, scene, visual } = createRenderedHost();
    const sourceTransform = entity.get(Transform);
    const sourceModifier = visual.modifiers.addTransform({
      position: { x: 5, y: -3 },
      rotation: 0.1,
      scale: 1.2,
    });
    const feel = entity.add(
      new Feel({
        dash: feelAfterimage({
          target: visual,
          count: 2,
          interval: 0.05,
          lifetime: 0.2,
          tint: 0x123456,
        }),
      }),
    );

    const playback = feel.play("dash");
    let copies = scene.findEntities({ name: "feel:afterimage" });
    expect(copies).toHaveLength(1);
    expect(copies[0] && isSerializable(copies[0])).toBe(false);
    expect(copies[0]?.get(Transform).position).toEqual(new Vec2(105, 77));
    expect(copies[0]?.get(Transform).rotation).toBeCloseTo(0.1);
    expect(copies[0]?.get(Transform).scale).toEqual(new Vec2(1.2, 1.2));
    const firstVisual = copies[0]?.get(SpriteComponent);
    expect(firstVisual?.sprite.texture).toBe(visual.sprite.texture);
    expect(firstVisual?.sprite.anchor.x).toBe(0.5);
    expect(firstVisual?.sprite.anchor.y).toBe(0.75);
    expect(firstVisual?.tint).toBe(0x123456);

    sourceTransform.setPosition(130, 90);
    feel.update(0.05);
    copies = scene.findEntities({ name: "feel:afterimage" });
    expect(copies).toHaveLength(2);
    expect(copies[1]?.get(Transform).position).toEqual(new Vec2(135, 87));
    expect(sourceTransform.position).toEqual(new Vec2(130, 90));
    expect(visual.modifiers.size).toBe(1);

    playback?.stop();
    expect(copies.every((copy) => copy.isDestroyed)).toBe(true);
    expect(visual.modifiers.size).toBe(1);
    sourceModifier.remove();
  });

  it("expires copies independently after sampling stops", () => {
    const { entity, scene, visual } = createRenderedHost();
    const feel = entity.add(
      new Feel({
        dash: feelAfterimage({
          target: visual,
          count: 2,
          interval: 0.05,
          lifetime: 0.1,
        }),
      }),
    );

    feel.play("dash");
    feel.update(0.05);
    const copies = scene.findEntities({ name: "feel:afterimage" });
    expect(copies).toHaveLength(2);
    feel.update(0.05);
    expect(copies[0]?.isDestroyed).toBe(true);
    expect(copies[1]?.isDestroyed).toBe(false);
    feel.update(0.05);
    expect(copies[1]?.isDestroyed).toBe(true);
  });

  it("rejects invalid timing and copy counts", () => {
    const { visual } = createRenderedHost();
    expect(() => feelAfterimage({ target: visual, count: 0 })).toThrow(
      "count must be an integer >= 1",
    );
    expect(() => feelAfterimage({ target: visual, interval: 0 })).toThrow(
      "interval must be a finite number > 0",
    );
  });
});
