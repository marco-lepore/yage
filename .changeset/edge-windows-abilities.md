---
"@yagejs-addons/abilities": patch
---

Input edge queries resolve against the caller's execution context — frame code reads frame windows, fixed-step code reads per-step windows.

- Documentation only: `AbilityDriverComponent`'s note on per-frame input sampling states the current rationale (an intent is forwarded on the frame its edge lands, independent of the frame's fixed-step count) instead of the outdated claim that fixed-step polling would miss or double-see edges.
