/** Shared utilities for YAGE examples. */

import { Engine } from "@yagejs/core";
import type { EngineConfig } from "@yagejs/core";
import { DebugPlugin } from "@yagejs/debug";
import type { DebugConfig } from "@yagejs/debug";

const params = new URLSearchParams(
  typeof location !== "undefined" ? location.search : "",
);

/**
 * True when the example is loaded with `?test`. Enables the deterministic E2E
 * harness: the inspector is exposed on `window.__yage__` and the clock boots
 * frozen with a fixed RNG seed so snapshots only depend on explicit stepping.
 * Without `?test` every helper below is a no-op and examples behave normally.
 */
export const TEST_MODE = params.has("test");

/** Fixed RNG seed for deterministic runs. Override with `?seed=N`. */
export const TEST_SEED = Number(params.get("seed") ?? "1");

/**
 * Construct the engine for an example. Identical to `new Engine(config)` in
 * normal browsing; under `?test` it forces `debug: true` so the inspector is
 * reachable from the test harness.
 */
export function createExampleEngine(config?: EngineConfig): Engine {
  return new Engine({
    ...config,
    debug: TEST_MODE ? true : (config?.debug ?? false),
  });
}

/**
 * DebugPlugin for examples that surface the debug overlay. Behaves like
 * `new DebugPlugin(config)` normally; under `?test` it additionally boots the
 * clock frozen at frame zero and seeds scene RNG for deterministic snapshots.
 */
export function exampleDebugPlugin(config?: DebugConfig): DebugPlugin {
  if (!TEST_MODE) return new DebugPlugin(config);
  return new DebugPlugin({
    ...config,
    startFrozen: true,
    deterministicSeed: TEST_SEED,
  });
}

/**
 * Attach the deterministic test harness to examples that don't otherwise use
 * the debug overlay. A no-op outside `?test`, so normal browsing is unchanged;
 * under `?test` it installs a frozen, seeded DebugPlugin. Call right before
 * `engine.start()`, after all other plugins are registered.
 */
export function installTestHarness(engine: Engine, config?: DebugConfig): void {
  if (TEST_MODE) engine.use(exampleDebugPlugin(config));
}

/** Inject optional extra CSS for a specific example. Base styles are in shared.css. */
export function injectStyles(extra?: string): void {
  if (!extra) return;
  const style = document.createElement("style");
  style.textContent = extra;
  document.head.appendChild(style);
}

/** Get the #game-container element or throw. */
export function getContainer(): HTMLElement {
  const el = document.getElementById("game-container");
  if (!el) throw new Error("#game-container element not found");
  return el;
}

/**
 * Set `aspect-ratio` + `max-width` on `#game-container` so it flexes
 * responsively on narrow viewports while capping at the game's native size.
 * `RendererPlugin` defaults to letterbox fit against the container, so the
 * canvas stays pinned to it at every size.
 */
export function setupGameContainer(
  width: number,
  height: number,
): HTMLElement {
  const container = getContainer();
  container.style.aspectRatio = `${width} / ${height}`;
  container.style.maxWidth = `${width}px`;
  return container;
}
