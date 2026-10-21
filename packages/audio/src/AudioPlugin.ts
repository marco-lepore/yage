import { AssetManagerKey, ErrorBoundaryKey, InspectorKey } from "@yagejs/core";
import type { EngineContext, Plugin, Inspector } from "@yagejs/core";
import { AudioManager } from "./AudioManager.js";
import { registerLoadedSound, unloadSound, parseSoundLoop } from "./assets.js";
import { AudioManagerKey, type AudioConfig } from "./types.js";

const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

/** Owns the live audio context and its browser lifecycle. */
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
  private unlocked = false;
  private resumePending: Promise<void> | undefined;

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
        const loop = parseSoundLoop(data);
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
        registerLoadedSound(path, buffer, loop);
        return buffer;
      },
      unload: (path: string) => unloadSound(path),
    });
    this.unlocked = manager.isUnlocked();
    if (typeof document !== "undefined") {
      const gesture = (): void => {
        void this.resume();
      };
      const visibility = (): void => {
        if (!manager.autoMuteOnBlur) return;
        if (document.hidden || !document.hasFocus()) {
          void audioContext.suspend().catch((error: unknown) => {
            manager._reportFailure("Audio suspend", error);
            throw error;
          });
        } else if (this.unlocked) void this.resume();
      };
      for (const type of GESTURES)
        document.addEventListener(type, gesture, {
          capture: true,
          passive: true,
        });
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("blur", visibility);
      window.addEventListener("focus", visibility);
      this.cleanup = () => {
        for (const type of GESTURES)
          document.removeEventListener(type, gesture, true);
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("blur", visibility);
        window.removeEventListener("focus", visibility);
      };
    }
    // Audio lookahead must continue while scene time is paused or scaled.
    // eslint-disable-next-line no-restricted-globals
    this.timer = setInterval(() => {
      if (manager.isUnlocked()) {
        manager._handleGesture();
        manager.updateSchedule();
      }
    }, manager.tickInterval * 1000);
  }
  onStart(): void {
    this.inspector = this.engineContext?.tryResolve(InspectorKey);
    this.inspector?.addExtension("audio", {
      getDiagnostics: () => this.manager!.getDiagnostics(),
    });
  }
  private resume(): Promise<void> {
    if (this.destroyed || !this.audioContext || !this.manager)
      return Promise.resolve();
    if (this.resumePending) return this.resumePending;
    const context = this.audioContext;
    const manager = this.manager;
    this.resumePending = context.resume().then(
      () => {
        this.resumePending = undefined;
        if (this.destroyed) return;
        this.unlocked = context.state === "running";
        manager._handleGesture();
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
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close().catch((error: unknown) => {
        this.manager?._reportFailure("Audio close", error);
        throw error;
      });
    }
  }
}
