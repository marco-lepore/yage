import { AssetManagerKey, ErrorBoundaryKey, globalRandom } from "@yagejs/core";
import type { EngineContext, Plugin } from "@yagejs/core";
import type { Sound as PixiSound, SoundLibrary } from "@pixi/sound";
import { AudioManager } from "./AudioManager.js";
import { _setSoundLibrary } from "./assets.js";
import { AudioManagerKey, type AudioConfig } from "./types.js";

const GESTURE_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

export class AudioPlugin implements Plugin {
  readonly name = "audio";
  readonly version = "2.0.0";

  private readonly _config: AudioConfig;
  private _cleanupFns: Array<() => void> = [];
  private _sound: SoundLibrary | undefined;
  private _destroyed = false;

  constructor(config?: AudioConfig) {
    this._config = config ?? {};
  }

  /**
   * Importing `@yagejs/audio` needs no browser: the audio library it plays
   * through is loaded here, when the plugin installs. Sounds registered with
   * `registerSound` before that are added to the library at the same point.
   */
  async install(context: EngineContext): Promise<void> {
    const { sound } = await import("@pixi/sound");
    // The engine can be destroyed while the library is still loading, and
    // `onDestroy` then runs with nothing to tear down. Registering into a
    // context that is already gone would leave the manager and the gesture
    // listeners behind.
    if (this._destroyed) {
      sound.close();
      return;
    }
    this._sound = sound;
    _setSoundLibrary(sound);

    const manager = new AudioManager(sound, this._config, globalRandom);
    manager._setErrorBoundary(context.tryResolve(ErrorBoundaryKey));
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

    if (typeof document === "undefined") return;

    // Pause-on-blur is delegated to pixi-sound's WebAudioContext.autoPause
    // (configured by AudioManager from `autoMuteOnBlur`). No listener here.

    // Attach gesture listeners only if audio is not already unlocked. These
    // run in bubble phase so @pixi/sound's capture-phase `_unlock()` has
    // already toggled `context.state` to "running" by the time we check.
    if (!manager.isUnlocked()) {
      const onGesture = (): void => {
        manager._handleGesture();
        if (manager.isUnlocked()) removeGestureListeners();
      };
      const removeGestureListeners = (): void => {
        for (const ev of GESTURE_EVENTS) {
          document.removeEventListener(ev, onGesture);
        }
      };
      for (const ev of GESTURE_EVENTS) {
        document.addEventListener(ev, onGesture);
      }
      this._cleanupFns.push(removeGestureListeners);
    }
  }

  onDestroy(): void {
    this._destroyed = true;
    for (const cleanup of this._cleanupFns) cleanup();
    this._cleanupFns.length = 0;
    this._sound?.close();
  }
}
