import type { Engine } from "@yagejs/core";
import type { RendererPlugin } from "@yagejs/renderer";

/**
 * Shows the `#fullscreen` button from `index.html` and toggles fullscreen on
 * click. The button stays hidden where it would do nothing: on iPhone, in an
 * iframe that does not allow fullscreen, and in an installed app that already
 * opens fullscreen.
 */
export function setupFullscreenButton(
  engine: Engine,
  renderer: RendererPlugin,
): void {
  const button = document.getElementById("fullscreen");
  if (!button || !canEnterFullscreen()) return;

  button.hidden = false;
  // Also fires when the player leaves fullscreen with Esc or the browser UI.
  engine.events.on("screen:fullscreen", ({ active }) => {
    button.textContent = active ? "Exit fullscreen" : "Fullscreen";
  });
  button.addEventListener("click", () => {
    // Move focus back to the page, so a game key such as Enter does not
    // press the button again.
    button.blur();
    const toggle = renderer.isFullscreen
      ? renderer.exitFullscreen()
      : renderer.requestFullscreen();
    toggle.catch((err: unknown) => console.warn(err));
  });
}

function canEnterFullscreen(): boolean {
  // The installed app on Android opens fullscreen (see vite.config.ts).
  if (matchMedia("(display-mode: fullscreen)").matches) return false;
  // Safari on iPad before 16.4 only has the webkit-prefixed flag.
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  return doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
}
