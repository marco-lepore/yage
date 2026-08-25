import { describe, expect, it } from "vitest";
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
  type SceneRenderTree,
} from "@yagejs/renderer";
import { Feel } from "../Feel.js";
import { feelFlightLines, feelMotionTrail } from "./trails.js";

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

describe("Feel flight lines and trails", () => {
  it("owns a temporary flight-line field without moving its base transform", () => {
    const { entity, scene } = createRenderedHost();
    const feel = entity.add(
      new Feel({
        flight: feelFlightLines({
          direction: { x: 1, y: 0 },
          count: 3,
          spread: 0,
          depth: 0,
          travel: 20,
          duration: 1,
        }),
      }),
    );

    const playback = feel.play("flight");
    const spawned = scene.findEntity("feel:flight-lines");
    const transform = spawned?.get(Transform);
    const graphics = spawned?.get(GraphicsComponent);
    expect(spawned && isSerializable(spawned)).toBe(false);
    expect(transform?.position).toEqual(new Vec2(100, 80));
    expect(graphics?.graphics.context.instructions.length).toBeGreaterThan(0);

    feel.update(0.5);
    expect(transform?.position).toEqual(new Vec2(100, 80));
    expect(graphics?.modifiers.positionOffset.x).toBeLessThan(0);
    expect(graphics?.modifiers.opacityFactor).toBeLessThan(1);

    playback?.stop();
    expect(spawned?.isDestroyed).toBe(true);
    expect(graphics?.modifiers.size).toBe(0);
  });

  it("samples live world positions and lets the completed trail fade", () => {
    const { entity, scene } = createRenderedHost();
    const ownerTransform = entity.get(Transform);
    const feel = entity.add(
      new Feel({
        trail: feelMotionTrail({
          duration: 0.2,
          lifetime: 0.2,
          sampleInterval: 0.01,
          minDistance: 0,
        }),
      }),
    );

    feel.play("trail");
    const spawned = scene.findEntity("feel:motion-trail");
    const graphics = spawned?.get(GraphicsComponent);
    ownerTransform.position = new Vec2(120, 80);
    feel.update(0.1);
    expect(graphics?.graphics.context.instructions.length).toBeGreaterThan(0);

    ownerTransform.position = new Vec2(140, 80);
    feel.update(0.1);
    feel.update(0.1);
    expect(spawned?.isDestroyed).toBe(false);
    expect(ownerTransform.position).toEqual(new Vec2(140, 80));

    feel.update(0.1);
    expect(spawned?.isDestroyed).toBe(true);
  });

  it("destroys a motion trail when its playback is cancelled", () => {
    const { entity, scene } = createRenderedHost();
    const feel = entity.add(
      new Feel({
        trail: feelMotionTrail({ duration: 1, lifetime: 0.2 }),
      }),
    );

    const playback = feel.play("trail");
    const spawned = scene.findEntity("feel:motion-trail");
    playback?.stop();

    expect(spawned?.isDestroyed).toBe(true);
  });
});
