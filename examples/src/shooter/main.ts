/**
 * 2D shooter example — platformer movement, buffered jumps, bullet firing,
 * and patrolling skeleton enemies with a state machine. The HUD (enemy
 * counter + win banner) renders in-canvas on a screen-space layer; only the
 * fullscreen toggle stays in the DOM. Wiring lives in the sibling modules
 * (constants, assets, ui, particles, player, enemies, scene).
 */
import { ParticlesPlugin } from "@yagejs/particles";
import { Engine, EventBusKey } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { AudioPlugin } from "@yagejs/audio";
import { InputPlugin } from "@yagejs/input";
import { installDebugFromUrl, setupGameContainer } from "../shared/bootstrap.js";
import { WIDTH, HEIGHT } from "./constants.js";
import { fullscreenBtn } from "./ui.js";
import { ShooterScene } from "./scene.js";
import "./styles.css";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  // Mount the fullscreen button inside the same container the renderer will
  // fullscreen, so it stays visible alongside the canvas in fullscreen mode.
  const gameContainer = setupGameContainer(WIDTH, HEIGHT);
  gameContainer.appendChild(fullscreenBtn);

  const renderer = new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0f172a,
    // Pixel art: nearest sampling plus rounded positions.
    pixelArtPreset: true,
    container: gameContainer,
  });
  engine.use(renderer);
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
  engine.use(new AudioPlugin());
  engine.use(new InputPlugin({
    actions: {
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      jump: ["Space"],
      shoot: ["KeyJ", "KeyK"],
      down: ["KeyS", "ArrowDown"],
    },
    preventDefaultKeys: ["Space", "ArrowDown"],
  }));
  await installDebugFromUrl(engine);

  engine.use(new ParticlesPlugin());
  await engine.start();

  // Fullscreen button: toggle on click, sync label from the bus event so
  // it stays correct when the user exits via Esc or the browser UI.
  const bus = engine.context.resolve(EventBusKey);
  const updateBtn = (active: boolean): void => {
    fullscreenBtn.textContent = active ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
  };
  bus.on("screen:fullscreen", ({ active }) => updateBtn(active));
  fullscreenBtn.addEventListener("click", () => {
    if (renderer.isFullscreen) {
      renderer.exitFullscreen().catch((err: unknown) => console.warn(err));
    } else {
      renderer.requestFullscreen().catch((err: unknown) => console.warn(err));
    }
  });

  await engine.scenes.push(new ShooterScene());
}

main().catch(console.error);
