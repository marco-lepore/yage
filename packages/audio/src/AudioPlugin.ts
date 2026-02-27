import { AssetManagerKey } from "@yage/core";
import type { EngineContext, Plugin } from "@yage/core";
import { sound } from "@pixi/sound";
import type { Sound as PixiSound } from "@pixi/sound";
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

    // Register sound asset loader (if AssetManager is available)
    const am = context.tryResolve(AssetManagerKey);
    am?.registerLoader("sound", {
      load: (path: string) =>
        new Promise<PixiSound>((resolve, reject) => {
          sound.add(path, {
            url: path,
            preload: true,
            loaded: (err: Error, snd?: PixiSound) => {
              if (err) reject(err);
              else resolve(snd!);
            },
          });
        }),
      unload: (path: string) => {
        sound.remove(path);
      },
    });
  }

  onDestroy(): void {
    sound.close();
  }
}
