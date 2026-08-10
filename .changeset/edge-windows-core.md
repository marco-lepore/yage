---
"@yagejs/core": patch
---

Input edge queries resolve against the caller's execution context — frame code reads frame windows, fixed-step code reads per-step windows.

- `SystemScheduler` exposes `currentPhase` (the phase whose systems are executing, or `null` outside any phase) and `fixedStepIndex` (monotonic count of fixed steps started), so code reachable from several phases can resolve behavior against its calling context instead of assuming one.
