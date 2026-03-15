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
