import type { Engine } from "@yagejs/core";
import type { RendererPlugin } from "@yagejs/renderer";

/**
 * Shows the `#fullscreen` button from `index.html` and toggles fullscreen on
 * click. The button stays hidden where the host cannot change how the game is
 * presented: on iPhone, in a frame from another origin that does not allow
 * fullscreen, and in an installed app that already opens fullscreen.
 */
export function setupFullscreenButton(
  engine: Engine,
  renderer: RendererPlugin,
): void {
  const button = document.getElementById("fullscreen");
  if (!button || renderer.fullscreenSupport === "unsupported") return;

  const label = (active: boolean): void => {
    button.textContent = active ? "Exit fullscreen" : "Fullscreen";
  };

  button.hidden = false;
  // A game that starts fullscreen, such as a desktop window restored that
  // way, shows the exit label from the first frame.
  label(renderer.isFullscreen);
  // Also fires when the player leaves fullscreen with Esc or the browser UI.
  engine.events.on("screen:fullscreen", ({ active }) => {
    label(active);
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
