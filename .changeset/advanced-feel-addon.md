---
"@yagejs-addons/feel": minor
---

Add advanced visual cue helpers to the Feel addon.

- Add `feelGlitch`, which enters quickly, holds, and refreshes deterministic
  glitch patterns during cue playback. Add `feelDissolve`, which advances a
  dissolve from intact to transparent.
- Add the `/recipes` entry with `impact`, `damageImpact`, `dashBurst`,
  `spawnPop`, `enemyDeath`, and `voidCollapse` compositions. `voidCollapse`
  stages inward blur, a center-expanding implosion, a short peak hold, and an
  optional color shift.
- Keep sequence-boundary callbacks behind the cleanup of preceding effects
  when decimal durations differ by floating-point rounding.
