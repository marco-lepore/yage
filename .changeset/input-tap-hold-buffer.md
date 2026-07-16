---
"@yagejs/input": minor
---

Add tap/hold classifier and buffered-press queries to `InputManager`, and move the hold-duration surface to seconds.

- `isJustHeldFor(action, seconds)` — hold-start edge, true only on the frame the hold crosses the threshold. Call-site thresholds, no per-action config.
- `getReleaseDuration(action)` — seconds the action was held, valid on the release frame (survives `getHoldDuration` resetting to 0 that frame).
- `isJustTapped(action, maxSeconds)` / `isJustReleasedAfter(action, minSeconds)` — release-frame conveniences over `isJustReleased` + `getReleaseDuration`.
- `consumeBufferedPress(action, windowSeconds)` — consuming query: true if the action was pressed within the last window and unclaimed; claims the press so it fires at most once, re-arming only on a new press. Scoped to this query — `isJustPressed` and listeners still see every press.

All four are manager-level, so synthetic and touch input (`fireActionDown` / `setActionHeld`) drive them with no extra work.

`getHoldDuration` and `isHeldFor` now take and return **seconds** instead of milliseconds, matching engine time everywhere else. Divide-by-1000 call sites go away; hold thresholds are now plain seconds (`isHeldFor("attack", 0.5)`).
