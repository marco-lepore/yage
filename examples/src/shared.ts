/** Shared utilities for YAGE examples. */

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
