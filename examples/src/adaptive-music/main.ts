import { Engine, InspectorPlugin, Scene } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { AudioPlugin } from "@yagejs/audio";
import { SynthPlugin } from "@yagejs-addons/synth";
import { setupGameContainer } from "../shared/bootstrap.js";
import { MUSIC_KEY, MusicHostEntity } from "./director.js";
import { HudEntity } from "./hud.js";
import { AUDIO_MIX, INSTRUMENTS, RecordedAccent, SOUNDS } from "./score.js";

const WIDTH = 800;
const HEIGHT = 300;

// ---------------------------------------------------------------------------
// MusicScene
// ---------------------------------------------------------------------------
class MusicScene extends Scene {
  readonly name = "adaptive-music";
  // The synth sounds are registered at boot; only the recording preloads.
  readonly preload = [RecordedAccent];

  onEnter(): void {
    this.spawn(MusicHostEntity, { key: MUSIC_KEY });
    this.spawn(HudEntity);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      container: setupGameContainer(WIDTH, HEIGHT),
      backgroundColor: 0x111827,
    }),
  );
  // The e2e test reads the music probe through the inspector.
  engine.use(new InspectorPlugin());
  engine.use(new AudioPlugin(AUDIO_MIX));
  // Renders every sound in SOUNDS; engine.start() waits for it.
  engine.use(new SynthPlugin({ instruments: INSTRUMENTS, sounds: SOUNDS }));

  await engine.start();
  await engine.scenes.push(new MusicScene());
}

void main();
