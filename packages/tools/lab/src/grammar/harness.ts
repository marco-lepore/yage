import type { Engine, Plugin } from "@yagejs/core";

export interface HarnessContext {
  /**
   * The element the renderer should mount into. Already sized to the
   * harness's `width` and `height`.
   */
  container: HTMLElement;
}

export interface HarnessDef {
  /** Canvas width in pixels. Defaults to 800. */
  width?: number | undefined;
  /** Canvas height in pixels. Defaults to 480. */
  height?: number | undefined;
  engine(): Engine;
  plugins(ctx: HarnessContext): Plugin[];
}

/**
 * Declares the engine and plugin set every scenario runs against. One per
 * project, in `lab/harness.ts`.
 *
 * Scenarios share a harness so they run against the same plugins as the real
 * game. A scenario that declared its own would drift from the game and prove
 * nothing about it.
 */
export function defineHarness(def: HarnessDef): HarnessDef {
  return def;
}

export const DEFAULT_HARNESS_WIDTH = 800;
export const DEFAULT_HARNESS_HEIGHT = 480;
