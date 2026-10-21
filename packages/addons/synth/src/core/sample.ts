import type { SynthInstrumentBank } from "./instruments.js";
import { renderSynthSound } from "./render.js";
import { renderSynthInstrument, type SynthSample } from "./instruments.js";
import type { SynthSound } from "./types.js";

export function renderSynthSample(
  sound: SynthSound,
  sampleRate = 44100,
  instruments: SynthInstrumentBank = {},
): SynthSample {
  return "instrument" in sound
    ? renderSynthInstrument(sound, sampleRate, instruments)
    : { samples: renderSynthSound(sound, sampleRate, instruments), sampleRate };
}
