export function injectStyles(extra?: string): void {
  const style = document.createElement("style");
  style.textContent = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #111;
      color: #ccc;
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 1rem;
      gap: 0.75rem;
    }
    #game-container { border: 1px solid #333; }
    ${extra ?? ""}
  `;
  document.head.appendChild(style);
}

/**
 * Give `#game-container` explicit CSS dimensions so the renderer's default
 * `ResizeObserver` fit has a stable host. Without a fixed size the container
 * auto-sizes to its canvas child, and the canvas auto-sizes to the container —
 * a feedback loop that Playwright reports as "element is not stable".
 */
export function setupContainer(width: number, height: number): HTMLElement {
  const el = document.getElementById("game-container");
  if (!el) throw new Error("#game-container element not found");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  return el;
}
