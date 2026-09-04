import { describe, expect, it, vi } from "vitest";
import {
  ErrorBoundaryKey,
  RandomKey,
  Transform,
  Vec2,
  createMockEntity,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RenderLayerManager,
  SceneRenderTreeKey,
  type SceneRenderTree,
} from "@yagejs/renderer";
import { Feel } from "../Feel.js";
import { feelRepeat, feelSequence } from "../core/node.js";
import { feelCall } from "../effects/core.js";
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

  it.each([
    ["zero", { x: 0, y: 0 }],
    ["near-zero", { x: 0.7e-6, y: 0.7e-6 }],
  ])(
    "rejects a static %s flight direction during construction",
    (_, direction) => {
      expect(() => feelFlightLines({ direction })).toThrow(
        "feelFlightLines: direction must not be zero.",
      );
    },
  );

  it.each([
    ["NaN", { x: Number.NaN, y: 0 }],
    ["positive infinity", { x: 0, y: Number.POSITIVE_INFINITY }],
    ["negative infinity", { x: Number.NEGATIVE_INFINITY, y: 0 }],
  ])("rejects a static direction containing %s", (_, direction) => {
    expect(() => feelFlightLines({ direction })).toThrow(
      "feelFlightLines: direction must contain finite x/y values.",
    );
  });

  it.each([
    ["zero", { x: 0, y: 0 }],
    ["near-zero", { x: 0.7e-6, y: 0.7e-6 }],
  ])(
    "keeps a live %s direction as an empty timed burst",
    (_, liveDirection) => {
      const { entity, scene } = createRenderedHost();
      const direction = vi.fn(() => liveDirection);
      const position = vi.fn(() => new Vec2(30, 40));
      const random = scene._resolveScoped(RandomKey);
      if (!random) throw new Error("Test scene is missing its random service.");
      const randomRange = vi.spyOn(random, "range");
      const feel = entity.add(
        new Feel({
          flight: feelFlightLines({ direction, position, duration: 0.3 }),
        }),
      );

      const playback = feel.play("flight");

      expect(direction).toHaveBeenCalledOnce();
      expect(position).not.toHaveBeenCalled();
      expect(randomRange).not.toHaveBeenCalled();
      expect(scene.findEntity("feel:flight-lines")).toBeUndefined();
      expect(playback?.active).toBe(true);

      feel.update(0.299);
      expect(playback?.active).toBe(true);
      feel.update(0.001);
      expect(playback?.active).toBe(false);
      expect(direction).toHaveBeenCalledOnce();
    },
  );

  it("preserves a throwing live direction and its callback attribution", () => {
    const { entity, context, scene } = createRenderedHost();
    const boundary = context.resolve(ErrorBoundaryKey);
    const failure = new Error("direction unavailable");
    const feel = entity.add(
      new Feel({
        flight: feelFlightLines({
          direction: () => {
            throw failure;
          },
        }),
      }),
    );

    expect(() => feel.play("flight")).toThrow(failure);
    expect(boundary.getCallbackErrors()).toHaveLength(1);
    expect(boundary.getCallbackErrors()[0]?.kind).toBe(
      "Feel callback (flight-line direction source)",
    );
    expect(scene.findEntity("feel:flight-lines")).toBeUndefined();
  });

  it("attributes a non-finite live direction before creating visual state", () => {
    const { entity, context, scene } = createRenderedHost();
    const boundary = context.resolve(ErrorBoundaryKey);
    const position = vi.fn(() => new Vec2(30, 40));
    const feel = entity.add(
      new Feel({
        flight: feelFlightLines({
          direction: () => ({ x: Number.POSITIVE_INFINITY, y: 0 }),
          position,
        }),
      }),
    );

    expect(() => feel.play("flight")).toThrow(
      "feelFlightLines: direction must contain finite x/y values.",
    );
    expect(boundary.getCallbackErrors()).toHaveLength(1);
    expect(boundary.getCallbackErrors()[0]?.kind).toBe(
      "Feel callback (flight-line direction source)",
    );
    expect(position).not.toHaveBeenCalled();
    expect(scene.findEntity("feel:flight-lines")).toBeUndefined();
  });

  it("keeps empty live bursts on the authored repeat cadence", () => {
    const { entity } = createRenderedHost();
    const direction = vi.fn(() => Vec2.ZERO);
    const completed = vi.fn();
    const feel = entity.add(
      new Feel({
        flight: feelSequence(
          feelRepeat(feelFlightLines({ direction, duration: 0.1 }), 3, 0.05),
          feelCall(completed),
        ),
      }),
    );

    const playback = feel.play("flight");
    expect(direction).toHaveBeenCalledTimes(1);

    feel.update(0.149);
    expect(direction).toHaveBeenCalledTimes(1);
    feel.update(0.002);
    expect(direction).toHaveBeenCalledTimes(2);
    feel.update(0.148);
    expect(direction).toHaveBeenCalledTimes(2);
    feel.update(0.002);
    expect(direction).toHaveBeenCalledTimes(3);
    feel.update(0.098);
    expect(completed).not.toHaveBeenCalled();
    feel.update(0.002);
    expect(completed).toHaveBeenCalledOnce();
    expect(playback?.active).toBe(false);
  });

  it("normalizes finite directions without overflowing", () => {
    const { entity, scene } = createRenderedHost();
    const feel = entity.add(
      new Feel({
        flight: feelFlightLines({
          direction: { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
          count: 1,
          spread: 0,
          depth: 0,
          travel: 20,
          duration: 1,
        }),
      }),
    );

    feel.play("flight");
    feel.update(0.5);

    const modifiers = scene
      .findEntity("feel:flight-lines")
      ?.get(GraphicsComponent).modifiers;
    expect(Number.isFinite(modifiers?.positionOffset.x)).toBe(true);
    expect(Number.isFinite(modifiers?.positionOffset.y)).toBe(true);
    expect(modifiers?.positionOffset.x).toBeLessThan(0);
    expect(modifiers?.positionOffset.x).toBeCloseTo(
      modifiers?.positionOffset.y ?? 0,
    );
  });

  it("captures and normalizes a static direction during construction", () => {
    const { entity, scene } = createRenderedHost();
    const direction = { x: 3, y: 4 };
    const flight = feelFlightLines({
      direction,
      count: 1,
      spread: 0,
      depth: 0,
      travel: 20,
      duration: 1,
    });
    direction.x = 0;
    direction.y = 0;
    const feel = entity.add(new Feel({ flight }));

    feel.play("flight");
    feel.update(0.5);

    const offset = scene.findEntity("feel:flight-lines")?.get(GraphicsComponent)
      .modifiers.positionOffset;
    expect(offset?.x).toBeCloseTo(-9);
    expect(offset?.y).toBeCloseTo(-12);
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

  it("samples a held trail until release and drains its last points", () => {
    const { entity, scene } = createRenderedHost();
    const ownerTransform = entity.get(Transform);
    const feel = entity.add(
      new Feel({
        trail: feelMotionTrail({
          duration: "held",
          lifetime: 0.2,
          sampleInterval: 0.05,
          minDistance: 0,
        }),
      }),
    );

    const playback = feel.play("trail");
    ownerTransform.position = new Vec2(120, 80);
    feel.update(0.1);
    const spawned = scene.findEntity("feel:motion-trail");
    expect(spawned?.isDestroyed).toBe(false);

    playback?.release();
    expect(playback?.active).toBe(true);
    feel.update(0.19);
    expect(spawned?.isDestroyed).toBe(false);
    feel.update(0.01);
    expect(spawned?.isDestroyed).toBe(true);
    expect(playback?.active).toBe(false);
  });

  it("retimes finite trail sampling and drain together", () => {
    const { entity, scene } = createRenderedHost();
    const feel = entity.add(
      new Feel({
        trail: feelMotionTrail({
          duration: 0.2,
          lifetime: 0.2,
          sampleInterval: 0.05,
          minDistance: 0,
        }),
      }),
    );

    const playback = feel.play("trail", { duration: 0.8 });
    const spawned = scene.findEntity("feel:motion-trail");
    feel.update(0.4);
    expect(spawned?.isDestroyed).toBe(false);
    expect(playback?.active).toBe(true);

    feel.update(0.4);
    expect(spawned?.isDestroyed).toBe(true);
    expect(playback?.active).toBe(false);
  });
});
