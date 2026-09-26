import { ServiceKey } from "./EngineContext.js";
import type { SceneManager } from "./SceneManager.js";
import {
  RandomKey,
  createDefaultRandomSeed,
  createRandomService,
  normalizeSeed,
  type InternalRandomService,
  type RandomService,
} from "./Random.js";

/**
 * Creates the RNG each scene reads through {@link RandomKey}, and owns the
 * seed those RNGs start from. The engine owns one, reachable as
 * `engine.sceneRandom` or through {@link SceneRandomSourceKey}.
 *
 * A scene's RNG starts from the first seed that is set, in this order: the
 * seed passed to {@link setSeed}, the default seed a test harness installs
 * (`DebugPlugin`'s `deterministicSeed`), then a fresh non-deterministic seed.
 * `globalRandom` is a separate generator and none of these seeds reach it.
 */
export class SceneRandomSource {
  private defaultSeed: number | undefined;
  private seedOverride: number | undefined;

  constructor(private readonly scenes: SceneManager) {}

  /**
   * Create a scene RNG from the current seed policy. The engine calls this
   * as each scene enters and registers the result under {@link RandomKey}.
   */
  createSceneRandom(): RandomService {
    return createRandomService(
      this.seedOverride ?? this.defaultSeed ?? createDefaultRandomSeed(),
    );
  }

  /**
   * Reseed the RNG of every scene on the stack, and start every scene that
   * enters later from the same seed. The seed goes through
   * `normalizeSeed`, so `-1` and `0xffffffff` produce the same sequence, as
   * do `1.9` and `1`. Throws for `NaN` or an infinite seed.
   */
  setSeed(seed: number): void {
    const normalized = normalizeFiniteSeed("setSeed", seed);
    this.seedOverride = normalized;
    this.reseedStack(normalized);
  }

  /**
   * @internal `DebugPlugin` installs its `deterministicSeed` through this
   * hook and clears it with `undefined`. A seed set with {@link setSeed}
   * takes precedence.
   */
  setDefaultSeed(seed: number | undefined): void {
    this.defaultSeed =
      seed === undefined
        ? undefined
        : normalizeFiniteSeed("setDefaultSeed", seed);
    if (this.seedOverride !== undefined || this.defaultSeed === undefined) {
      return;
    }
    this.reseedStack(this.defaultSeed);
  }

  private reseedStack(seed: number): void {
    for (const scene of this.scenes.all) {
      (
        scene.tryResolveScoped(RandomKey) as InternalRandomService | undefined
      )?.setSeed(seed);
    }
  }
}

function normalizeFiniteSeed(method: string, seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new Error(
      `SceneRandomSource.${method}: seed must be a finite number, got ${seed}.`,
    );
  }
  return normalizeSeed(seed);
}

/** Key for the engine's {@link SceneRandomSource}. */
export const SceneRandomSourceKey = new ServiceKey<SceneRandomSource>(
  "sceneRandomSource",
);
