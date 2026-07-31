import { isPatchStack } from "./render.js";
import type { SynthPatch, SynthSound } from "./types.js";

/** Pitch spread `synthVariants` uses when the caller doesn't pick one: ±6%. */
export const SYNTH_VARIANT_DETUNE = 0.06;

/** One take of a sound, under the alias `SynthPlugin` registers it with. */
export interface SynthVariant {
  alias: string;
  sound: SynthSound;
}

/**
 * Take one sound and return `count` versions of it — evenly spread across
 * ±`detune` in pitch, each with its own noise, under `alias.1` … `alias.n`.
 *
 * A baked buffer sounds identical every play. Registering a few takes and
 * reaching for `AudioManager.playRandom` restores the per-shot variation a
 * live synth would give. `SynthPlugin` does this for any config entry with a
 * `variants` count; call it directly when registering sounds yourself.
 */
export function synthVariants(
  alias: string,
  sound: SynthSound,
  count: number,
  detune: number = SYNTH_VARIANT_DETUNE,
): SynthVariant[] {
  assertCount("synthVariants", count);
  if (!Number.isFinite(detune) || detune < 0) {
    throw new Error(
      `synthVariants: detune must be a finite number of at least 0 (got ${detune}).`,
    );
  }
  const takes: SynthVariant[] = [];
  for (let i = 0; i < count; i++) {
    const spread = count > 1 ? (i / (count - 1)) * 2 - 1 : 0;
    takes.push({
      alias: `${alias}.${i + 1}`,
      sound: shiftSound(sound, 1 + detune * spread, i),
    });
  }
  return takes;
}

/**
 * The aliases a `variants: count` entry registers: `alias.1` … `alias.n`.
 * Pass the result to `AudioManager.playRandom`.
 */
export function synthVariantAliases(alias: string, count: number): string[] {
  assertCount("synthVariantAliases", count);
  const aliases: string[] = [];
  for (let i = 1; i <= count; i++) aliases.push(`${alias}.${i}`);
  return aliases;
}

function assertCount(fn: string, count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`${fn}: count must be an integer of at least 1 (got ${count}).`);
  }
}

function shiftSound(
  sound: SynthSound,
  factor: number,
  seedOffset: number,
): SynthSound {
  if (isPatchStack(sound)) {
    return sound.map((patch) => shiftPatch(patch, factor, seedOffset));
  }
  if ("notes" in sound) {
    return {
      ...sound,
      notes: sound.notes.map((note) =>
        typeof note === "number"
          ? note * factor
          : { ...note, frequency: note.frequency * factor },
      ),
      voice: { ...sound.voice, seed: (sound.voice?.seed ?? 1) + seedOffset },
    };
  }
  return shiftPatch(sound, factor, seedOffset);
}

function shiftPatch(
  patch: SynthPatch,
  factor: number,
  seedOffset: number,
): SynthPatch {
  const shifted: SynthPatch = { ...patch, seed: (patch.seed ?? 1) + seedOffset };
  // Materialize the default pitch: a tonal patch that leaves `frequency`
  // unset must still land on a different pitch per take.
  if (patch.wave !== "noise") shifted.frequency = (patch.frequency ?? 440) * factor;
  if (patch.glideTo !== undefined) shifted.glideTo = patch.glideTo * factor;
  return shifted;
}
