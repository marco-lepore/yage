---
"@yagejs/input": patch
---

Input edge queries resolve against the caller's execution context — frame code reads frame windows, fixed-step code reads per-step windows.

- Read from `fixedUpdate` or a `Phase.FixedUpdate` system, the six edge queries (`isJustPressed`, `isJustReleased`, `isJustHeldFor`, `isJustTapped`, `isJustReleasedAfter`, `getReleaseDuration`) resolve against the current fixed step: the first step of a frame sees the pending edges, later steps in the same frame see none, and an edge landing in a frame that runs no step is held for the next step. Previously the queries were frame-scoped regardless of caller, so fixed-step readers saw the same edge on every step of a multi-step frame and lost edges on frames that ran none.
- Frame-phase callers are unchanged.
