---
"@yagejs-tools/audio": minor
---

Render selected synth instruments and sound effects to WAV files during the build.

- New package. `yage-audio build <config> --out <dir>` renders the sounds a JSON config selects into deduplicated mono PCM16 WAV files and a manifest with sustain loops, level measurements and each pitched instrument's root note, derived from its frequency. `--watch` rebuilds when the config changes and keeps watching after a failed build, the first one included. `yage-audio inspect` checks an exported bank, including every build measurement, and `yage-audio instruments` lists the instrument names.
- `renderAudioBank` renders a bank in memory, and `@yagejs-tools/audio/node` writes one to disk. A clipped or non-finite render fails before any file is written.
- `renderAudioBank`, `buildAudioBank`, `parseAudioBankConfig` and `listAudioInstruments` accept an `instruments` set, so a bank can include instruments a game defines with `defineInstrument`.
- `yage-audio build --instruments <module>` and `yage-audio instruments --instruments <module>` import a game's instrument module through the project's own Vite, so aliases, extensionless imports and modules split across files resolve as in the game. Every exported instrument definition joins the built-ins. With `--watch`, an edit to the module or to any file it imports rebuilds the bank. `vite` is an optional peer dependency, needed only for `--instruments`; without it the flag fails with an error that names the fix.
