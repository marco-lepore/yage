import { AssetHandle } from "@yagejs/core";
import { sound as soundLibrary } from "@pixi/sound";
import type { Sound } from "@pixi/sound";

/** Create a typed asset handle for a sound effect. */
export function sound(path: string): AssetHandle<Sound> {
  return new AssetHandle("sound", path);
}

const registeredSounds = new Map<string, Sound>();

/**
 * Register a runtime-generated `AudioBuffer` under an alias, so `alias`
 * resolves and plays exactly like a preloaded sound — through the same
 * `AudioManager` channels, mute, and blur auto-pause. This is the audio
 * analogue of the renderer's `registerTexture(key, texture)`.
 *
 * Registered aliases are engine-global, outside the asset manager's ref
 * counts and unloads, and live until {@link unregisterSound}. A game that
 * stores an alias in its own save data must re-register its runtime sound
 * before reconstructing playback.
 *
 * Re-registering an alias this API still owns replaces the entry. An alias
 * already used by a loaded sound asset (or one that overwrote a stale
 * registration) throws: shadowing a loaded asset would let its unload
 * destroy the registered sound later.
 *
 * ```ts
 * const buffer = synthesizeShot(); // any code that produces an AudioBuffer
 * registerSound("shoot", buffer);
 * audio.play("shoot");
 * ```
 */
export function registerSound(alias: string, buffer: AudioBuffer): void {
  const registered = registeredSounds.get(alias);
  if (
    registered !== undefined &&
    soundLibrary.exists(alias) &&
    soundLibrary.find(alias) === registered
  ) {
    // Replacing our own prior registration.
    soundLibrary.remove(alias);
  } else if (soundLibrary.exists(alias)) {
    // A loaded asset's alias, or an asset that overwrote a stale
    // registration — foreign either way: shadowing it would let the
    // asset's unload destroy the registered sound later.
    throw new Error(
      `registerSound("${alias}"): the alias is already used by a loaded sound — ` +
        `pick an alias that doesn't collide with an asset path.`,
    );
  }
  // `preload: true` is required: it makes `@pixi/sound` decode an
  // AudioBuffer source synchronously, so `AudioManager.play()` never sees
  // the "not preloaded" Promise branch.
  registeredSounds.set(
    alias,
    soundLibrary.add(alias, { source: buffer, preload: true }),
  );
}

/**
 * Remove a sound registered by {@link registerSound}. A no-op for aliases
 * this API never registered. An `AudioBuffer` is a plain GC'd object with no
 * destroy step, so unlike `unregisterTexture` there's no resource to release
 * — the registered alias simply stops resolving.
 *
 * Only evicts the library entry while it still holds the registered sound:
 * if an asset preloaded under the same alias overwrote it after
 * registration, that entry belongs to the asset pipeline and is left in
 * place.
 */
export function unregisterSound(alias: string): void {
  const registered = registeredSounds.get(alias);
  if (registered === undefined) return;
  if (soundLibrary.exists(alias) && soundLibrary.find(alias) === registered) {
    soundLibrary.remove(alias);
  }
  registeredSounds.delete(alias);
}

/** Drop every registered sound entry — test isolation only. @internal */
export function clearRegisteredSounds(): void {
  for (const [alias, registered] of registeredSounds) {
    if (soundLibrary.exists(alias) && soundLibrary.find(alias) === registered) {
      soundLibrary.remove(alias);
    }
  }
  registeredSounds.clear();
}
