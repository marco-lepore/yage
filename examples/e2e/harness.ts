/**
 * Deterministic E2E harness for the shipped examples.
 *
 * This file is NOT part of the examples themselves — it exists purely so the
 * Playwright suite can drive the real, unmodified example pages. The examples
 * Vite plugin injects it ahead of each example's own module, but ONLY when the
 * dev server runs with `YAGE_E2E` set (the test server), so normal `npm run
 * dev` and production builds never include it.
 *
 * Even when injected it stays inert unless the page is loaded with `?test`.
 * Under `?test` it patches `Engine.start` to:
 *   1. expose the inspector on `window.__yage__` (the engine normally gates
 *      this behind `debug: true`), and
 *   2. guarantee a frozen, seeded `DebugPlugin` — reconfiguring the example's
 *      own DebugPlugin if it has one, otherwise installing a hidden one.
 *
 * The result: examples stay pristine, idiomatic YAGE code, while the suite
 * still gets a frozen clock and seeded RNG for reproducible snapshots.
 */
import { Engine } from "@yagejs/core";
import type { Plugin } from "@yagejs/core";
import { DebugPlugin } from "@yagejs/debug";

const params = new URLSearchParams(window.location.search);

if (params.has("test")) {
  const seed = Number(params.get("seed") ?? "1");

  // `debug` / `config` are `private` (compile-time only). We reach them at
  // runtime so the harness can opt examples into debug mode without leaking
  // any test concern into the public API or the example source.
  interface EngineInternals {
    debug: boolean;
    plugins: Map<string, Plugin>;
  }
  interface DebugPluginInternals {
    config: { startFrozen?: boolean; deterministicSeed?: number };
  }

  const originalStart = Engine.prototype.start;
  Engine.prototype.start = function patchedStart(this: Engine): Promise<void> {
    const engine = this as unknown as EngineInternals;
    engine.debug = true;

    const existingDebug = engine.plugins.get("debug");
    if (existingDebug) {
      const config = (existingDebug as unknown as DebugPluginInternals).config;
      config.startFrozen = true;
      config.deterministicSeed ??= seed;
    } else if (engine.plugins.has("renderer")) {
      this.use(new DebugPlugin({ startFrozen: true, deterministicSeed: seed }));
    }

    return originalStart.call(this);
  };
}
