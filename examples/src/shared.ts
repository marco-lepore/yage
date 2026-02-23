/** Shared utilities for YAGE examples. */

/** Inject common dark-theme styles + optional extra CSS. */
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
    h1 { font-size: 1.2rem; color: #eee; }
    #game-container { border: 1px solid #333; }
    .back-link {
      align-self: flex-start;
      color: #888;
      text-decoration: none;
      font-size: 0.85rem;
    }
    .back-link:hover { color: #fff; }
    .controls {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      justify-content: center;
    }
    .controls kbd {
      background: #222;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 0.85rem;
      color: #fff;
    }
    .controls span { font-size: 0.85rem; }
    ${extra ?? ""}
  `;
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
