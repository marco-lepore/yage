---
"@yagejs/core": patch
---

Fix a one-frame flash of the outgoing scene at the end of a `pop`/`replace` transition.

- Tear the outgoing scene down inside the transition's finalize step so the stack is in its post-mutation shape before `scene:transition:ended` is emitted. End-of-transition listeners (e.g. the renderer's visibility recompute) now see the settled stack instead of the stale pre-teardown one.
- For a transitioned `pop`/`replace`, the stack-mutation event (`scene:popped` / `scene:replaced`) now fires just before `scene:transition:ended` rather than just after. `isTransitioning` is still `true` when it fires.
