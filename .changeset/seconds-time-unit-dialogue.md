---
"@yagejs-addons/dialogue": minor
---

Adapt to the seconds-based engine time unit.

`Component.update(dt)` now delivers seconds, so the dialogue clocks integrate in seconds: the typewriter reveal (`charsPerSec`), the auto-advance timer, the voice liveness budget, and the caret/bob animations. The authored millisecond durations are unchanged — `[pause=<ms>/]`, `autoAdvanceMs`, `livenessMs`, and `caret.blinkMs` are still milliseconds. This release requires the `@yagejs/*` engine build that ships the seconds-based time unit.
