import { AssetHandle } from "@yagejs/core";
import type { Sound, SoundLibrary } from "@pixi/sound";

/** Create a typed asset handle for a sound effect. */
export function sound(path: string): AssetHandle<Sound> {
  return new AssetHandle("sound", path);
}

/**
 * The audio library, handed over by `AudioPlugin.install`. It arrives that way
 * rather than through a static import because `@pixi/sound` reads `document`
 * while it evaluates, which would stop this package being imported outside a
 * browser.
 */
let library: SoundLibrary | undefined;

interface Registration {
  readonly buffer: AudioBuffer;
  /** The library entry, once there is a library holding it. */
  sound: Sound | undefined;
}

const registeredSounds = new Map<string, Registration>();

/** Put one alias into the library, replacing this API's own prior entry. */
function addToLibrary(
  soundLibrary: SoundLibrary,
  alias: string,
  buffer: AudioBuffer,
): Sound {
  const registered = registeredSounds.get(alias)?.sound;
  if (
    registered !== undefined &&
    soundLibrary.exists(alias) &&
    soundLibrary.find(alias) === registered
  ) {
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
  return soundLibrary.add(alias, { source: buffer, preload: true });
}

/**
 * Hand the loaded library over and add every alias registered while there was
 * none. @internal
 */
export function _setSoundLibrary(loaded: SoundLibrary): void {
  library = loaded;
  for (const [alias, registration] of registeredSounds) {
    registration.sound = addToLibrary(loaded, alias, registration.buffer);
  }
}

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
 * Callable at module scope, before `AudioPlugin` installs: the alias is held
 * and added to the audio library when the plugin loads it.
 *
 * ```ts
 * const buffer = synthesizeShot(); // any code that produces an AudioBuffer
 * registerSound("shoot", buffer);
 * audio.play("shoot");
 * ```
 */
export function registerSound(alias: string, buffer: AudioBuffer): void {
  const entry =
    library === undefined ? undefined : addToLibrary(library, alias, buffer);
  registeredSounds.set(alias, { buffer, sound: entry });
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
 * place. An alias registered before `AudioPlugin` installs is dropped before
 * it ever reaches the library.
 */
export function unregisterSound(alias: string): void {
  const registration = registeredSounds.get(alias);
  if (registration === undefined) return;
  removeFromLibrary(alias, registration);
  registeredSounds.delete(alias);
}

/** Drop every registered sound entry — test isolation only. @internal */
export function clearRegisteredSounds(): void {
  for (const [alias, registration] of registeredSounds) {
    removeFromLibrary(alias, registration);
  }
  registeredSounds.clear();
}

/** Evict one alias while the library still holds the registered sound. */
function removeFromLibrary(alias: string, registration: Registration): void {
  const registered = registration.sound;
  if (library === undefined || registered === undefined) return;
  if (library.exists(alias) && library.find(alias) === registered) {
    library.remove(alias);
  }
}
