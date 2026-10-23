import { Engine, InspectorPlugin, Scene } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { AudioPlugin, soundBank, type SoundBank } from "@yagejs/audio";
import { setupGameContainer } from "../shared/bootstrap.js";
import { MUSIC_KEY, MusicHostEntity } from "./director.js";
import { HudEntity } from "./hud.js";
import { AUDIO_MIX, RecordedAccent } from "./score.js";

const WIDTH = 800;
const HEIGHT = 300;

// ---------------------------------------------------------------------------
// MusicScene
// ---------------------------------------------------------------------------
class MusicScene extends Scene {
  readonly name = "adaptive-music";
  readonly preload;

  constructor(private readonly bank: SoundBank) {
    super();
    // The bank's handles preload like any other sound asset.
    this.preload = [RecordedAccent, ...Object.values(bank.sounds)];
  }

  onEnter(): void {
    this.spawn(MusicHostEntity, this.bank, { key: MUSIC_KEY });
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

  // `npm run audio:build` renders the instruments in `audio.config.json` to
  // WAV files and writes this manifest next to them.
  const base = `${import.meta.env.BASE_URL}generated/audio/`;
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok)
    throw new Error(
      `Music bank: HTTP ${response.status}. Run npm run audio:build.`,
    );
  const bank = soundBank(await response.json(), base);

  await engine.start();
  await engine.scenes.push(new MusicScene(bank));
}

void main();
