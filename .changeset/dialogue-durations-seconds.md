---
"@yagejs-addons/dialogue": minor
---

All author-facing durations are now **seconds**, matching the engine's time unit (there is no millisecond option left in the addon).

- `SayStep.autoAdvanceMs` → `autoAdvance` (seconds); the compact format's `auto=` hint follows (`auto=1.5`).
- `setAutoAdvance(seconds | null)` on the controller and session.
- `[pause=N/]` markup holds N **seconds** (`[pause=0.4/]`); `PauseToken.ms` → `PauseToken.seconds`.
- `createVoiceChannel`: `livenessMs` → `liveness` (seconds).
- `KeyboardInputBinding` / `dialogueControls`: `skipHoldMs` → `skipHold` (seconds).
- `CaretTheme.blinkMs` → `blink` (seconds); `DEFAULT_CARET_BLINK_MS` → `DEFAULT_CARET_BLINK` (`0.26`).
- `evaluateEffect` / `caretAlpha` take elapsed **seconds** (same visual output).
- Engine peerDependencies move to `>=0.9.0 <0.10.0` — the addon requires the seconds-based engine and does not work on the millisecond-`dt` 0.8 line.

Migration: divide any previous millisecond value by 1000 (`autoAdvanceMs: 1500` → `autoAdvance: 1.5`, `[pause=400/]` → `[pause=0.4/]`). Every renamed option fails as a type error, so stale call sites can't run 1000x slow silently.
