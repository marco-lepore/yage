import { ServiceKey } from "./EngineContext.js";

/** Seeded random service used by runtime systems that must be deterministic. */
export interface RandomService {
  /** Random float in the range [0, 1). */
  float(): number;
  /** Random float in the range [min, max). */
  range(min: number, max: number): number;
  /** Random integer in the range [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Pick a random element from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Shuffle an array in place and return the same array. */
  shuffle<T>(arr: T[]): T[];
  /** Return the seed this generator was constructed (or last reseeded) with. */
  getSeed(): number;
}

/**
 * Internal extension that exposes mid-stream reseeding. The Inspector uses
 * this to enforce deterministic E2E mode without leaking the foot-gun
 * (game code calling `setSeed` would corrupt other consumers' sequences in
 * the same scene).
 *
 * @internal
 */
export interface InternalRandomService extends RandomService {
  setSeed(seed: number): void;
}

/** Scene-scoped key for the active scene's deterministic RNG. */
export const RandomKey = new ServiceKey<RandomService>("random", {
  scope: "scene",
});

const UINT32_MAX = 0x1_0000_0000;

/** Normalize arbitrary numbers into the uint32 seed space. */
export function normalizeSeed(seed: number): number {
  return seed >>> 0;
}

/** Default seed for explicitly non-deterministic paths. */
export function createDefaultRandomSeed(): number {
  return normalizeSeed(Date.now() ^ Math.floor(Math.random() * 1e9));
}

class Mulberry32Random implements InternalRandomService {
  private seed: number;
  private state: number;

  constructor(seed: number) {
    const normalized = normalizeSeed(seed);
    this.seed = normalized;
    this.state = normalized;
  }

  float(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_MAX;
  }

  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error("RandomService.pick() requires a non-empty array.");
    }
    return arr[this.int(0, arr.length - 1)]!;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  setSeed(seed: number): void {
    const normalized = normalizeSeed(seed);
    this.seed = normalized;
    this.state = normalized;
  }

  getSeed(): number {
    return this.seed;
  }
}

/** Create a deterministic random service. */
export function createRandomService(
  seed = createDefaultRandomSeed(),
): RandomService {
  return new Mulberry32Random(seed);
}

/**
 * Explicitly non-deterministic global RNG for boot-time or cross-scene code.
 * Inspector seed control never touches this instance.
 */
export const globalRandom = createRandomService();
