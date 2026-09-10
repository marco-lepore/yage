---
"@yagejs/core": minor
---

Add a typed state-machine primitive for stored game modes.

- Declare legal edges, timed transitions, and enter or exit hooks with `defineStates` and `StateMachine`.
- Bind component-owned machines to error attribution with `Component.stateMachine`.
- Serialize the current state and elapsed time; inspect those values and the last transition.
