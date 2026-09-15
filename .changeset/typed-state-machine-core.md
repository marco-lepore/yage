---
"@yagejs/core": patch
---

Add a typed state-machine primitive for stored game modes.

- Declare legal edges, timed transitions, and enter or exit hooks with `defineStates` and `StateMachine`. The first `tick()` runs the initial `enter` hook, and `start()` runs it earlier.
- Restart a state by listing it in its own `to`: `go(current)` then runs `exit`, resets the timer, and runs `enter`.
- Follow a machine from another layer with `machine.events.changed`, `.entered` and `.exited`, subscribed through `machine.on(...)` or `this.listen(machine, ...)`. Name them with `{ events: "mode" }` to publish them on the entity as `mode:changed` and friends, for `entity.on` and `scene.on`.
- Give a state a phase sequence with `states` and `start`. Leaving the parent exits the current phase first, so a sequence cannot outlive the state that holds it.
- Reach the states a whole machine falls into, such as `hit` and `die`, by marking them `fromAny: true` instead of repeating them in every `to` list.
- Give `for` a function to resolve a duration each time the state is entered, for tuning a field initializer cannot read.
- Ask `canGo(state)` before a `go()` that a late callback may no longer be allowed to make.
- Bind component-owned machines to error attribution with `Component.stateMachine`.
- Serialize the current state and elapsed time; inspect those values and the last transition.

`Component.listen` now accepts any event source, an entity or a state machine, in its first argument.
