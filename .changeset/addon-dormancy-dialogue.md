---
"@yagejs-addons/dialogue": minor
---

Addon components now follow entity activeness, so disabling a component or deactivating its entity also sleeps resources that live outside `update()`.

- `DialogueController` hides and pauses its current conversation and releases input listeners while dormant. It restores the same conversation and requested visibility, pause, and input-focus settings on enable.
- `DialogueActor` unregisters and sleeps its callbacks while dormant, then restores its requested expression and speaking state.
- Keyboard and pointer bindings can bind again after disposal without retaining stale input state.
