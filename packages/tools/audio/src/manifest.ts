import { parseSoundBankManifest } from "@yagejs/audio";
import type { SoundBankEntry, SoundBankManifest } from "@yagejs/audio";

/** A manifest entry as this tool writes it: every build diagnostic present. */
export interface ExportedSoundBankEntry extends SoundBankEntry {
  frames: number;
  bytes: number;
  samplePeak: number;
  rms: number;
  clippedSamples: number;
}
/** A manifest as this tool writes it. */
export interface ExportedSoundBankManifest extends SoundBankManifest {
  sounds: Record<string, ExportedSoundBankEntry>;
}

/**
 * Validate a manifest this tool wrote. The runtime parser accepts entries
 * without build diagnostics; inspection and rebuilds need them.
 */
export function parseExportedManifest(
  value: unknown,
): ExportedSoundBankManifest {
  const manifest = parseSoundBankManifest(value);
  for (const [alias, entry] of Object.entries(manifest.sounds)) {
    for (const field of [
      "frames",
      "bytes",
      "samplePeak",
      "rms",
      "clippedSamples",
    ] as const)
      if (entry[field] === undefined)
        throw new Error(
          `AudioBank ${alias}.${field}: missing from an exported manifest.`,
        );
  }
  return manifest as ExportedSoundBankManifest;
}
