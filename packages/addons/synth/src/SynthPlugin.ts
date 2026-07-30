import { registerSound, unregisterSound } from "@yagejs/audio";
import type { Plugin } from "@yagejs/core";
import { synthBuffer } from "./buffer.js";
import { SYNTH_SAMPLE_RATE } from "./core/render.js";
import { synthVariants } from "./core/variants.js";
import type { SynthSound } from "./core/types.js";

/** A sound registered as several detuned takes instead of one buffer. */
export interface SynthVariantEntry {
  sound: SynthSound;
  /** How many takes to render, under `alias.1` … `alias.n`. */
  variants: number;
  /** Pitch spread across the takes, as a fraction. Default 0.06 (±6%). */
  detune?: number;
}

export type SynthSoundEntry = SynthSound | SynthVariantEntry;

export interface SynthPluginConfig {
  /** Alias → the sound to render under it. */
  sounds: Record<string, SynthSoundEntry>;
  /** Sample rate for the rendered buffers. Default 44100. */
  sampleRate?: number;
}

/**
 * Renders every configured sound at install time and registers the buffers
 * with `@yagejs/audio`, so the aliases play through `AudioManager` like
 * preloaded files — same channels, volumes, mute, and blur auto-pause.
 *
 * ```ts
 * engine.use(new AudioPlugin());
 * engine.use(
 *   new SynthPlugin({
 *     sounds: {
 *       shoot: { sound: synthPresets.shoot(), variants: 4 },
 *       explosion: synthPresets.explosion(),
 *     },
 *   }),
 * );
 *
 * // From a Component, Entity, or Scene:
 * const audio = this.use(AudioManagerKey);
 * audio.play("explosion");
 * audio.playRandom(synthVariantAliases("shoot", 4));
 * ```
 *
 * Rendering is synchronous and takes no `AudioContext`, so it runs before the
 * browser's first-gesture unlock. Nothing is saved: the plugin re-registers
 * from its config on every boot, so a snapshot only ever holds the alias.
 */
export class SynthPlugin implements Plugin {
  readonly name = "synth";
  readonly version = "0.1.0";
  readonly dependencies = ["audio"] as const;

  private readonly _config: SynthPluginConfig;
  private readonly _aliases: string[] = [];

  constructor(config: SynthPluginConfig) {
    this._config = config;
  }

  /** Every alias this plugin registered, variant suffixes included. */
  get aliases(): readonly string[] {
    return this._aliases;
  }

  install(): void {
    if (this._aliases.length > 0) {
      throw new Error(
        "SynthPlugin: install() called while its aliases are still registered.",
      );
    }
    const sampleRate = this._config.sampleRate ?? SYNTH_SAMPLE_RATE;

    // Expand every entry to its final aliases and render every buffer BEFORE
    // registering anything: a collision (a variants entry "shoot" next to an
    // explicit "shoot.1") or a bad patch then fails with nothing registered.
    const owners = new Map<string, string>();
    const prepared: Array<{ alias: string; buffer: AudioBuffer }> = [];
    for (const [alias, entry] of Object.entries(this._config.sounds)) {
      const takes = isVariantEntry(entry)
        ? synthVariants(alias, entry.sound, entry.variants, entry.detune)
        : [{ alias, sound: entry }];
      for (const take of takes) {
        const owner = owners.get(take.alias);
        if (owner !== undefined) {
          throw new Error(
            `SynthPlugin: config entries "${owner}" and "${alias}" both ` +
              `produce the alias "${take.alias}" — rename one.`,
          );
        }
        owners.set(take.alias, alias);
        prepared.push({
          alias: take.alias,
          buffer: synthBuffer(take.sound, sampleRate),
        });
      }
    }

    // Register as one unit: if the audio package rejects an alias (already
    // used by a loaded file asset), roll the earlier ones back.
    try {
      for (const { alias, buffer } of prepared) {
        registerSound(alias, buffer);
        this._aliases.push(alias);
      }
    } catch (error) {
      for (const alias of this._aliases) unregisterSound(alias);
      this._aliases.length = 0;
      throw error;
    }
  }

  onDestroy(): void {
    for (const alias of this._aliases) unregisterSound(alias);
    this._aliases.length = 0;
  }
}

function isVariantEntry(entry: SynthSoundEntry): entry is SynthVariantEntry {
  return !Array.isArray(entry) && "sound" in entry;
}
