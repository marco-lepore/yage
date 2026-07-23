/** Shared utilities for YAGE examples. */
import type { Engine } from "@yagejs/core";

/**
 * Install `DebugPlugin` when the page URL opts in via a `debug` query param:
 * `?debug=1` (any value) installs the plugin — inspector `time`/`input`
 * control plus the backquote overlay toggle — and `?debug=overlay` also
 * starts with the overlay visible. Without the param the plugin is neither
 * installed nor loaded. Call it where `engine.use(new DebugPlugin())` would
 * go, before `engine.start()`. Examples that showcase the overlay itself
 * install `DebugPlugin` directly instead.
 *
 * Reaching the inspector at `window.__yage__` additionally requires the
 * engine to be constructed with `new Engine({ debug: true })` — every
 * example does.
 */
export async function installDebugFromUrl(engine: Engine): Promise<void> {
  const mode = new URLSearchParams(window.location.search).get("debug");
  if (mode === null) return;
  try {
    const { DebugPlugin } = await import("@yagejs/debug");
    engine.use(new DebugPlugin({ startEnabled: mode === "overlay" }));
  } catch (err) {
    // Debug support is opt-in sugar; a failed chunk load (offline, stale
    // deployment) must not keep the example from booting.
    console.warn("[examples] ?debug requested but @yagejs/debug failed to load:", err);
  }
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
