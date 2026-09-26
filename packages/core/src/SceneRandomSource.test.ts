import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine } from "./Engine.js";
import { InspectorKey } from "./EngineContext.js";
import { InspectorPlugin } from "./InspectorPlugin.js";
import { RandomKey, createRandomService } from "./Random.js";
import type { RandomService } from "./Random.js";
import { Scene } from "./Scene.js";
import type { Plugin } from "./types.js";
import { SceneManager } from "./SceneManager.js";
import {
  SceneRandomSource,
  SceneRandomSourceKey,
} from "./SceneRandomSource.js";

class TestScene extends Scene {
  readonly name = "test";
}

function sequence(rng: RandomService, length = 4): number[] {
  return Array.from({ length }, () => rng.float());
}

async function startWithScene(
  ...plugins: Plugin[]
): Promise<{ engine: Engine; scene: Scene }> {
  const engine = new Engine();
  for (const plugin of plugins) engine.use(plugin);
  await engine.start();
  const scene = new TestScene();
  await engine.scenes.push(scene);
  return { engine, scene };
}

function sceneRandom(scene: Scene): RandomService {
  const rng = scene.tryResolveScoped(RandomKey);
  if (!rng) throw new Error("scene has no RandomKey service");
  return rng;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SceneRandomSource", () => {
  it("starts a scene RNG from a fresh seed when nothing is pinned", () => {
    vi.spyOn(Date, "now").mockReturnValue(5);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const source = new SceneRandomSource(new SceneManager());

    expect(source.createSceneRandom().getSeed()).toBe(5);
  });

  it("starts every later scene RNG from the seed passed to setSeed", () => {
    const source = new SceneRandomSource(new SceneManager());
    source.setSeed(42);

    const a = source.createSceneRandom();
    const b = source.createSceneRandom();
    expect(a.getSeed()).toBe(42);
    expect(sequence(a)).toEqual(sequence(createRandomService(42)));
    expect(sequence(b)).toEqual(sequence(createRandomService(42)));
  });

  it("wraps a seed into the uint32 range", () => {
    const source = new SceneRandomSource(new SceneManager());
    source.setSeed(-1);
    expect(source.createSceneRandom().getSeed()).toBe(0xffffffff);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "setSeed(%s) throws and keeps the previous seed",
    (seed) => {
      const source = new SceneRandomSource(new SceneManager());
      source.setSeed(7);
      expect(() => source.setSeed(seed)).toThrow(
        `SceneRandomSource.setSeed: seed must be a finite number, got ${seed}.`,
      );
      expect(source.createSceneRandom().getSeed()).toBe(7);
    },
  );

  it("setDefaultSeed(NaN) throws and keeps the previous default", () => {
    const source = new SceneRandomSource(new SceneManager());
    source.setDefaultSeed(3);
    expect(() => source.setDefaultSeed(Number.NaN)).toThrow(
      "SceneRandomSource.setDefaultSeed: seed must be a finite number, got NaN.",
    );
    expect(source.createSceneRandom().getSeed()).toBe(3);
  });

  it("starts scene RNGs from the default seed until it is cleared", () => {
    vi.spyOn(Date, "now").mockReturnValue(5);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const source = new SceneRandomSource(new SceneManager());

    source.setDefaultSeed(0x00c0ffee);
    expect(source.createSceneRandom().getSeed()).toBe(0x00c0ffee);

    source.setDefaultSeed(undefined);
    expect(source.createSceneRandom().getSeed()).toBe(5);
  });

  it("prefers the setSeed seed over the default seed", () => {
    const source = new SceneRandomSource(new SceneManager());
    source.setDefaultSeed(1);
    source.setSeed(2);
    source.setDefaultSeed(3);
    expect(source.createSceneRandom().getSeed()).toBe(2);
  });

  describe("on an engine", () => {
    it("is the engine's sceneRandom and is registered under its key", () => {
      const engine = new Engine();
      expect(engine.context.resolve(SceneRandomSourceKey)).toBe(
        engine.sceneRandom,
      );
      engine.destroy();
    });

    it("gives an entering scene an RNG that starts from the pinned seed", async () => {
      const engine = new Engine();
      engine.sceneRandom.setSeed(11);
      await engine.start();
      const scene = new TestScene();
      await engine.scenes.push(scene);

      expect(sequence(sceneRandom(scene))).toEqual(
        sequence(createRandomService(11)),
      );
      engine.destroy();
    });

    it("setSeed reseeds the RNG of a scene already on the stack", async () => {
      const { engine, scene } = await startWithScene();
      const rng = sceneRandom(scene);
      rng.float();

      engine.sceneRandom.setSeed(99);

      expect(sceneRandom(scene)).toBe(rng);
      expect(rng.getSeed()).toBe(99);
      expect(sequence(rng)).toEqual(sequence(createRandomService(99)));
      engine.destroy();
    });

    it("setDefaultSeed reseeds scenes on the stack unless a seed is pinned", async () => {
      const { engine, scene } = await startWithScene();

      engine.sceneRandom.setDefaultSeed(4);
      expect(sceneRandom(scene).getSeed()).toBe(4);

      engine.sceneRandom.setSeed(5);
      engine.sceneRandom.setDefaultSeed(6);
      expect(sceneRandom(scene).getSeed()).toBe(5);
      engine.destroy();
    });

    it("Inspector.setSeed reseeds through the engine's sceneRandom", async () => {
      const { engine, scene } = await startWithScene(new InspectorPlugin());
      const setSeed = vi.spyOn(engine.sceneRandom, "setSeed");

      engine.context.resolve(InspectorKey).setSeed(42);

      expect(setSeed).toHaveBeenCalledWith(42);
      expect(sceneRandom(scene).getSeed()).toBe(42);
      expect(engine.sceneRandom.createSceneRandom().getSeed()).toBe(42);
      engine.destroy();
    });
  });
});
