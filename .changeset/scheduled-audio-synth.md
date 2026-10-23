---
"@yagejs-addons/synth": patch
---

Render synth instruments in the game: 25 built-ins or the game's own.

- Add 25 seeded instruments and noise sources: plucked strings, mallets, bells, electric piano, pad, flute, clarinet, organ, drums and percussion. Import them by name from `@yagejs-addons/synth/instruments`; an ESM bundle keeps only the instruments it imports. A `require()` of `@yagejs-addons/synth/instruments` loads all 25 instruments, because CommonJS cannot drop unused exports. Each definition has `sound(options)` for a portable descriptor and `render(options, sampleRate)` for samples with sustain loop points. A pitched instrument's sample reports `rootNote`, the MIDI pitch of its frequency; drums and noise have `pitched: false`, and the tuned tom reports the fixed pitch it sounds at.
- `SynthPlugin` takes the definitions its sounds use through `instruments` and registers each alias with its sustain loop and root note. Installation awaits rendering. An optional module `worker` renders the sounds off the main thread, with a timeout, a main-thread fallback and `getDiagnostics()`.
- `@yagejs-addons/synth/render` renders sounds without importing the engine, for Node tools and previews. `parseSynthSound` validates portable sound data. `@yagejs-addons/synth/worker` serves render requests inside a worker.
- `defineInstrument(name, render, { pitched, rootNote })` on `@yagejs-addons/synth/render` makes a game's own instrument, usable in `SynthPlugin`, a worker and music tracks. The same entry exports the DSP building blocks: `renderString`, `renderModal`, `renderAdditive`, `renderMetal`, `renderNoise`, `biquad`, `svf`, `normalize`, `limit`, `saturate`, `dcBlock`, `fadeIn`, `fadeOut`, `prepareTonalLoop` and `seededRandom`.
- Instrument names are type parameters: `harp.sound()` is a `SynthInstrument<"harp">`, and with an inline `instruments` set, `SynthPlugin` and the render and parse functions reject a descriptor naming another instrument at compile time. A set resolves descriptors by each definition's `name`.
