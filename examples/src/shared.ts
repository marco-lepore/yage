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

// Auto-set aspect-ratio on #game-container once a canvas is added.
// Reads the logical game size from the inline style PixiJS sets.
{
  const container = document.getElementById("game-container");
  if (container) {
    new MutationObserver((_mutations, observer) => {
      const canvas = container.querySelector("canvas");
      if (!canvas) return;
      observer.disconnect();
      const w = parseFloat(canvas.style.width) || canvas.width;
      const h = parseFloat(canvas.style.height) || canvas.height;
      container.style.aspectRatio = `${w} / ${h}`;
      container.style.maxWidth = `${w}px`;
    }).observe(container, { childList: true });
  }
}
