---
"@yagejs-tools/audio": minor
---

Render selected instruments and sound effects during the build.

- Add `yage-audio build`, `instruments`, and `inspect`, with JSON configuration and watch mode. Export only selected sounds as deduplicated PCM16 WAV files with tuning, sustain loops and level measurements.
- Provide an in-memory rendering API and Node file export API. Validate configuration and reject clipped or non-finite output before writing a bank. Inspect exported hashes, file sizes and decoded memory estimates.
