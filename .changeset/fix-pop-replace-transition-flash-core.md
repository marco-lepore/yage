---
"@yagejs/core": patch
---

Fix a one-frame flash of the outgoing scene at the end of a `pop`/`replace` transition.

- Tear the outgoing scene down inside the transition's finalize step so the stack is in its post-mutation shape before `scene:transition:ended` is emitted. End-of-transition listeners (e.g. the renderer's visibility recompute) now see the settled stack instead of the stale pre-teardown one.
