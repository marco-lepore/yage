import { describe, expect, it } from "vitest";
import { Transform, createMockEntity, isSerializable } from "@yagejs/core";
import {
  GraphicsComponent,
  RenderLayerManager,
  SceneRenderTreeKey,
  TextComponent,
  type SceneRenderTree,
} from "@yagejs/renderer";
import { Feel } from "../Feel.js";
import {
  feelDamageNumber,
  feelFloatingText,
  feelImpactRing,
} from "./transient.js";

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
  return { ...setup, layers, root };
}

describe("Feel transient visuals", () => {
  it("spawns, animates, and removes floating text without moving its base transform", () => {
    const { entity, scene } = createRenderedHost();
    const feel = entity.add(
      new Feel({
        text: feelFloatingText({
          text: "Level up!",
          duration: 1,
          spread: 0,
          sway: 0,
        }),
      }),
    );

    const playback = feel.play("text");
    const spawned = scene.findEntity("feel:floating-text");
    const transform = spawned?.get(Transform);
    const text = spawned?.get(TextComponent);
    expect(text?.text.text).toBe("Level up!");
    expect(spawned && isSerializable(spawned)).toBe(false);
    expect(transform?.position.x).toBe(100);
    expect(transform?.position.y).toBe(80);

    feel.update(0.5);
    expect(transform?.position.x).toBe(100);
    expect(transform?.position.y).toBe(80);
    expect(text?.modifiers.positionOffset.y).toBeLessThan(-16);
    expect(text?.modifiers.opacityFactor).toBeLessThan(1);

    playback?.stop();
    expect(spawned?.isDestroyed).toBe(true);
    expect(text?.modifiers.size).toBe(0);
    scene._flushDestroyQueue();
    expect(scene.findEntity("feel:floating-text")).toBeUndefined();
  });

  it("keeps overlapping damage numbers as separate owned entities", () => {
    const { entity, scene } = createRenderedHost();
    const feel = entity.add(
      new Feel({
        damage: {
          overlap: "allow",
          effect: feelDamageNumber({
            value: () => 99,
            critical: true,
            prefix: "-",
            duration: 1,
            spread: 0,
          }),
        },
      }),
    );

    const first = feel.play("damage");
    const second = feel.play("damage");
    const spawned = scene
      .findEntities()
      .filter((candidate) => candidate.name === "feel:floating-text");
    expect(spawned).toHaveLength(2);
    expect(spawned[0]?.get(TextComponent).text.text).toBe("-99");

    first?.stop();
    expect(spawned[0]?.isDestroyed).toBe(true);
    expect(spawned[1]?.isDestroyed).toBe(false);
    second?.stop();
    expect(spawned[1]?.isDestroyed).toBe(true);
  });

  it("owns an expanding impact ring and removes it on cancellation", () => {
    const { entity, scene } = createRenderedHost();
    const feel = entity.add(
      new Feel({
        ring: feelImpactRing({ duration: 1, spikes: 4 }),
      }),
    );

    const playback = feel.play("ring");
    const spawned = scene.findEntity("feel:impact-ring");
    const graphics = spawned?.get(GraphicsComponent);
    expect(graphics?.modifiers.size).toBe(2);

    feel.update(0.5);
    expect(graphics?.modifiers.scaleFactor.x).toBeGreaterThan(1);
    expect(graphics?.modifiers.opacityFactor).toBeLessThan(1);

    playback?.stop();
    expect(spawned?.isDestroyed).toBe(true);
    expect(graphics?.modifiers.size).toBe(0);
  });
});
