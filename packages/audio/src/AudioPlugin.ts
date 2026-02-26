import type { EngineContext, Plugin } from "@yage/core";
import { sound } from "@pixi/sound";
import { AudioManager } from "./AudioManager.js";
import { AudioManagerKey, type AudioConfig } from "./types.js";

export class AudioPlugin implements Plugin {
  readonly name = "audio";
  readonly version = "2.0.0";

  private readonly _config: AudioConfig;

  constructor(config?: AudioConfig) {
    this._config = config ?? {};
  }

  install(context: EngineContext): void {
    const manager = new AudioManager(sound, this._config);
    context.register(AudioManagerKey, manager);
  }

  onDestroy(): void {
    sound.close();
  }
}
