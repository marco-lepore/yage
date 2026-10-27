import {
  AssetManagerKey,
  ErrorBoundaryKey,
  HostKey,
  InspectorKey,
} from "@yagejs/core";
import type { EngineContext, Plugin, Inspector } from "@yagejs/core";
import { AudioManager } from "./AudioManager.js";
import {
  parseSoundMetadata,
  registerLoadedSound,
  unloadSound,
} from "./assets.js";
import { AudioManagerKey, type AudioConfig } from "./types.js";

const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

/**
 * Owns the live audio context. It follows `Host` for whether the app is
 * active, and listens for user gestures because a browser lets audio start
 * only from one.
 */
export class AudioPlugin implements Plugin {
  readonly name = "audio";
  readonly version = "3.0.0";
  private engineContext: EngineContext | undefined;
  private manager: AudioManager | undefined;
  private audioContext: AudioContext | undefined;
  private inspector: Inspector | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private cleanup: (() => void) | undefined;
  private destroyed = false;
  private resumePending: Promise<void> | undefined;
  /** Aliases this plugin's loader registered; released on destroy. */
  private readonly loaded = new Set<string>();

  constructor(private readonly config: AudioConfig = {}) {}
  install(context: EngineContext): void {
    if (typeof AudioContext === "undefined")
      throw new Error(
        "AudioPlugin: Web Audio is unavailable in this environment.",
      );
    this.engineContext = context;
    const audioContext = new AudioContext({ latencyHint: "interactive" });
    this.audioContext = audioContext;
    const manager = new AudioManager(audioContext, this.config);
    this.manager = manager;
    manager._setErrorBoundary(context.tryResolve(ErrorBoundaryKey));
    context.register(AudioManagerKey, manager);
    context.tryResolve(AssetManagerKey)?.registerLoader("sound", {
      load: async (path: string, data?: unknown) => {
        const metadata = parseSoundMetadata(data);
        const response = await fetch(path);
        if (!response.ok)
          throw new Error(`Audio asset "${path}": HTTP ${response.status}.`);
        const buffer = await audioContext.decodeAudioData(
          await response.arrayBuffer(),
        );
        if (this.destroyed)
          throw new Error(
            `Audio asset "${path}": plugin was destroyed during load.`,
          );
        const shared = registerLoadedSound(path, buffer, metadata);
        this.loaded.add(path);
        return shared;
      },
      unload: (path: string) => {
        // Destroy already released this engine's hold; a later unload of the
        // same file must not release another engine's.
        if (this.loaded.delete(path)) unloadSound(path);
      },
    });
    const host = context.resolve(HostKey);
    manager._setHostActive(host.active);
    const unobserve = host._observe(({ active }) =>
      manager._setHostActive(active),
    );
    const gesture = (): void => {
      // A gesture while the host is inactive must not end the hold. The
      // resume when the hold ends starts the context instead.
      if (!manager._isHeld()) void this.resume(audioContext, manager);
    };
    if (typeof document !== "undefined")
      for (const type of GESTURES)
        document.addEventListener(type, gesture, {
          capture: true,
          passive: true,
        });
    this.cleanup = () => {
      unobserve();
      if (typeof document !== "undefined")
        for (const type of GESTURES)
          document.removeEventListener(type, gesture, true);
    };
    // Audio lookahead must continue while scene time is paused or scaled.
    // eslint-disable-next-line no-restricted-globals
    this.timer = setInterval(() => {
      if (manager.isUnlocked()) manager.updateSchedule();
    }, manager.tickInterval * 1000);
  }
  onStart(): void {
    this.inspector = this.engineContext?.tryResolve(InspectorKey);
    this.inspector?.addExtension("audio", {
      getDiagnostics: () => this.manager!.getDiagnostics(),
    });
  }
  private resume(context: AudioContext, manager: AudioManager): Promise<void> {
    if (this.resumePending) return this.resumePending;
    this.resumePending = context.resume().then(
      () => {
        this.resumePending = undefined;
        if (this.destroyed || !manager.isUnlocked()) return;
        manager.updateSchedule();
      },
      (error: unknown) => {
        this.resumePending = undefined;
        manager._reportFailure("Audio resume", error);
        throw error;
      },
    );
    return this.resumePending;
  }
  onDestroy(): void {
    this.destroyed = true;
    this.cleanup?.();
    if (this.timer !== undefined) clearInterval(this.timer);
    this.inspector?.removeExtension("audio");
    this.manager?.dispose();
    // Workaround: Engine.destroy does not unload the AssetManager's assets,
    // and the sound registry outlives the engine. Release this engine's hold
    // on the files its loader registered, so each file goes once no engine
    // holds it. Unloading every asset on engine destroy would remove the need
    // for it.
    for (const alias of this.loaded) unloadSound(alias);
    this.loaded.clear();
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close().catch((error: unknown) => {
        this.manager?._reportFailure("Audio close", error);
        throw error;
      });
    }
  }
}
