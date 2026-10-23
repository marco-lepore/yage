import type { SynthBankNames, SynthInstrumentBank } from "./instruments.js";
import { isSynthInstrument, renderSynthSound } from "./render.js";
import { renderSynthInstrument, type SynthSample } from "./instruments.js";
import type { SynthSound } from "./types.js";

/**
 * Render any sound to a sample. Instruments keep their sustain loop and root
 * note; patches and jingles carry only samples.
 */
export function renderSynthSample<
  Bank extends SynthInstrumentBank = SynthInstrumentBank,
>(
  sound: SynthSound<SynthBankNames<Bank>>,
  sampleRate = 44100,
  instruments?: Bank,
): SynthSample {
  return isSynthInstrument(sound)
    ? renderSynthInstrument(sound, sampleRate, instruments)
    : { samples: renderSynthSound(sound, sampleRate, instruments), sampleRate };
}
