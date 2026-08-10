---
"@yagejs-addons/abilities": minor
---

Ability timing is game logic, so it advances on the fixed timestep by default.

- **Breaking:** `Abilities` phase timelines, linger windows, and cooldowns advance on the fixed timestep. They counted rendered-frame time before, which made ability windows drift with the frame rate on displays faster or slower than the fixed step. Pass `new Abilities(defs, { clock: "frame" })` for a purely presentation-driven timeline with no simulation coupling; `abilities.clock` is readable so custom steps can schedule matching timers via `pc.run(p, { clock })`.
- **Breaking:** the addon's other gameplay timers moved with it: `HitReceiver` i-frames, `Stagger`, `TouchDamage` intervals, and hitbox `follow` tracking run in `fixedUpdate`, and `Projectile` lifetime counts fixed-step seconds — so projectile range (speed × lifetime) holds when frame time and simulation time diverge.
- Presentation is unaffected: `anim`-triggered `KeyframeAnimator` playback keeps rendered-frame time, and so does any tween a step starts unless the step schedules it on another clock explicitly. `AbilityDriverComponent` still samples input once per rendered frame.
- The `@yagejs/core` peer range floor rises to the first version whose `ProcessComponent` accepts the `clock` option, so an older core cannot silently ignore it.
