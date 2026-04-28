---
"@yagejs/debug": patch
---

`DebugClock.step()` now drives `app.ticker.update(syntheticTime)` instead of calling `gameLoop.tick(dt)` and `app.render()` directly. This means every Pixi ticker subscriber (`AnimatedSprite.autoUpdate`, `pixi-filters` with internal time, anything subscribed via `app.ticker.add(...)`) advances by the same synthetic dt as the rest of the engine while frozen — previously they froze in step mode, silently breaking visual probes. `IDebugClock` public surface is byte-identical, so existing Inspector / e2e usage keeps working.

`step()` now also rejects non-finite or non-positive `dtMs` (matches the validation `setDelta` already enforces).
