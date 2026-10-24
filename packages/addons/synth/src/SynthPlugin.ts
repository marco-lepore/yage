import { registerSound, unregisterSound } from "@yagejs/audio";
import { ErrorBoundaryKey } from "@yagejs/core";
import type { EngineContext, Plugin } from "@yagejs/core";
import type {
  SynthBankNames,
  SynthInstrumentBank,
} from "./core/instruments.js";
import { sampleBuffer } from "./sample.js";
import { RenderBank, type SynthRenderDiagnostics } from "./renderBank.js";
import type { SynthSample } from "./core/instruments.js";
import { SYNTH_SAMPLE_RATE } from "./core/render.js";
import { synthVariants } from "./core/variants.js";
import type { SynthSound } from "./core/types.js";

/** A sound registered as several detuned takes instead of one buffer. */
export interface SynthVariantEntry<Name extends string = string> {
  sound: SynthSound<Name>;
  /** How many takes to render, under `alias.1` … `alias.n`. */
  variants: number;
  /** Pitch spread across the takes, as a fraction. Default 0.06 (±6%). */
  detune?: number;
}

export type SynthSoundEntry<Name extends string = string> =
  | SynthSound<Name>
  | SynthVariantEntry<Name>;

/**
 * `SynthPlugin` configuration. Passing `instruments` as a literal checks every
 * instrument descriptor in `sounds` against it at compile time.
 */
export interface SynthPluginConfig<
  Bank extends SynthInstrumentBank = SynthInstrumentBank,
> {
  /** Instrument definitions the sounds may name. Default: none. */
  instruments?: Bank;
  /** Alias → the sound to render under it. */
  sounds: Record<string, SynthSoundEntry<SynthBankNames<Bank>>>;
  /** Sample rate for the rendered buffers. Default 44100. */
  sampleRate?: number;
  /** Optional dedicated module worker; the plugin owns and terminates it. */
  worker?: Worker;
  /** Worker inactivity timeout in milliseconds. Default 5000. */
  workerTimeout?: number;
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
 * Installation awaits rendering, which needs no `AudioContext` and can finish
 * before the browser's first-gesture unlock. Nothing is saved: the plugin re-registers
 * from its config on every boot, so a snapshot only ever holds the alias.
 */
export class SynthPlugin<
  Bank extends SynthInstrumentBank = SynthInstrumentBank,
> implements Plugin {
  readonly name = "synth";
  readonly version = "0.1.0";
  readonly dependencies = ["audio"] as const;

  private readonly _config: SynthPluginConfig<Bank>;
  private readonly _aliases: string[] = [];
  private readonly bank: RenderBank;
  private disposed = false;

  getDiagnostics(): Readonly<SynthRenderDiagnostics> {
    return { ...this.bank.diagnostics };
  }

  constructor(config: SynthPluginConfig<Bank>) {
    const timeout = config.workerTimeout ?? 5000;
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new Error(
        `SynthPlugin: workerTimeout must be finite and > 0, got ${timeout}.`,
      );
    this._config = config;
    this.bank = new RenderBank(config.worker, timeout, {
      ...config.instruments,
    });
  }

  /** Every alias this plugin registered, variant suffixes included. */
  get aliases(): readonly string[] {
    return this._aliases;
  }

  async install(context: EngineContext): Promise<void> {
    if (this.disposed) throw new Error("SynthPlugin: plugin is disposed.");
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
    const prepared: Array<{ alias: string; sound: SynthSound }> = [];
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
          sound: take.sound,
        });
      }
    }

    let samples: SynthSample[];
    try {
      samples = await this.bank.render(
        prepared.map((take) => take.sound),
        sampleRate,
        context.resolve(ErrorBoundaryKey),
      );
    } catch (error) {
      this.bank.diagnostics.state = this.disposed ? "disposed" : "failed";
      this.bank.diagnostics.failure =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
    if (this.disposed)
      throw new Error("SynthPlugin: disposed during rendering.");

    // Register as one unit: if the audio package rejects an alias (already
    // used by a loaded file asset), roll the earlier ones back.
    try {
      for (const [i, { alias }] of prepared.entries()) {
        const sample = samples[i]!;
        // registerSound keeps only the loop points and rootNote.
        registerSound(alias, sampleBuffer(sample), sample);
        this._aliases.push(alias);
      }
      this.bank.diagnostics.state = "ready";
    } catch (error) {
      this.bank.diagnostics.state = "failed";
      this.bank.diagnostics.failure =
        error instanceof Error ? error.message : String(error);
      for (const alias of this._aliases) unregisterSound(alias);
      this._aliases.length = 0;
      throw error;
    }
  }

  onDestroy(): void {
    this.disposed = true;
    this.bank.dispose();
    for (const alias of this._aliases) unregisterSound(alias);
    this._aliases.length = 0;
  }
}

function isVariantEntry(entry: SynthSoundEntry): entry is SynthVariantEntry {
  return !Array.isArray(entry) && "sound" in entry;
}
