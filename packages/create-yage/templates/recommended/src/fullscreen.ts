import type { Engine } from "@yagejs/core";
import type { RendererPlugin } from "@yagejs/renderer";

/**
 * Shows the `#fullscreen` button from `index.html` and toggles fullscreen on
 * click. The button stays hidden where the page cannot go fullscreen: on
 * iPhone, and in an iframe that does not allow it.
 */
export function setupFullscreenButton(
  engine: Engine,
  renderer: RendererPlugin,
): void {
  const button = document.getElementById("fullscreen");
  if (!button || !isFullscreenAvailable()) return;

  button.hidden = false;
  // Also fires when the player leaves fullscreen with Esc or the browser UI.
  engine.events.on("screen:fullscreen", ({ active }) => {
    button.textContent = active ? "Exit fullscreen" : "Fullscreen";
  });
  button.addEventListener("click", () => {
    // Give the keyboard back to the game, so Enter or Space does not press
    // the button again.
    button.blur();
    const toggle = renderer.isFullscreen
      ? renderer.exitFullscreen()
      : renderer.requestFullscreen();
    toggle.catch((err: unknown) => console.warn(err));
  });
}

function isFullscreenAvailable(): boolean {
  // Safari on iPad before 16.4 only has the webkit-prefixed flag.
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  return doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
}
