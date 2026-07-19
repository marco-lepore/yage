/**
 * 2D platformer example — coyote-time + jump-buffered movement, moving
 * platforms, collectible coins, death pits, and a goal flag. The HUD (coin
 * counter + win banner) renders in-canvas on a screen-space layer; there is
 * no DOM overlay. Wiring lives in the sibling modules (constants, hud, player,
 * level, scene).
 */
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { AudioPlugin } from "@yagejs/audio";
import { InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { setupGameContainer } from "../shared/bootstrap.js";
import { WIDTH, HEIGHT } from "./constants.js";
import { PlatformerScene } from "./scene.js";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0f172a,
    container: setupGameContainer(WIDTH, HEIGHT),
  }));
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
  engine.use(new AudioPlugin());
  engine.use(new InputPlugin({
    actions: {
      left: ["KeyA", "ArrowLeft", "GamepadDPadLeft"],
      right: ["KeyD", "ArrowRight", "GamepadDPadRight"],
      jump: ["Space", "GamepadA"],
    },
    preventDefaultKeys: ["Space"],
  }));
  // Test fixtures opt into a fixed RNG seed and a paused-from-frame-zero
  // clock so playback snapshots are bit-identical across runs. Production
  // builds leave both unset. `startFrozen` runs at plugin `install()` so
  // no auto-frames tick before scene push — without it, the few frames
  // that slip in between RendererPlugin install and user-space resumption
  // of `await engine.start()` move physics state non-deterministically.
  const globals = globalThis as {
    __YAGE_DETERMINISTIC_SEED__?: number;
    __YAGE_START_FROZEN__?: boolean;
  };
  const debugConfig: {
    deterministicSeed?: number;
    startFrozen?: boolean;
  } = {};
  if (globals.__YAGE_DETERMINISTIC_SEED__ !== undefined) {
    debugConfig.deterministicSeed = globals.__YAGE_DETERMINISTIC_SEED__;
  }
  if (globals.__YAGE_START_FROZEN__) {
    debugConfig.startFrozen = true;
  }
  engine.use(new DebugPlugin(debugConfig));

  await engine.start();
  await engine.scenes.push(new PlatformerScene());
}

main().catch(console.error);
