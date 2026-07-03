---
"@yagejs/input": minor
---

Analog read coherence for synthetic stick sources (virtual/touch controls, test probes):

- `getStick` / `getTrigger` now fall back to synthetic axis state (`fireGamepadAxis`) not only when no pad is active but also when the active pad's own input rests inside its deadzone — an idle controller sitting plugged in no longer masks an actively-deflected virtual stick. A pad deflected past the deadzone always wins.
- Export `applyRadialDeadzone(x, y, deadzone)` — the exact radial dead-zone + magnitude-rescale curve `getStick` applies to pad hardware, so synthetic stick sources shape their values with the same response instead of re-deriving the formula.
