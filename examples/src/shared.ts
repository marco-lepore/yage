/** Shared utilities for YAGE examples. */

/** Inject optional extra CSS for a specific example. Base styles are in shared.css. */
export function injectStyles(extra?: string): void {
  if (!extra) return;
  const style = document.createElement("style");
  style.textContent = extra;
  document.head.appendChild(style);
}

/** Keyboard state tracker. Keys are lowercase. */
export const keys = new Set<string>();
window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

/** Get the #game-container element or throw. */
export function getContainer(): HTMLElement {
  const el = document.getElementById("game-container");
  if (!el) throw new Error("#game-container element not found");
  return el;
}
