---
"@yagejs-addons/abilities": minor
---

Addon components now follow entity activeness, so disabling a component or deactivating its entity also sleeps resources that live outside `update()`.

- `Abilities` pauses active phases, linger, and cooldowns while dormant. It refuses new actions and temporarily releases effects owned by open windows without changing sibling component state.
- Custom window steps can implement `onDisable` and `onEnable` hooks to apply the same lifecycle to game-owned effects.
- `AbilityDriverComponent` releases input listeners and owned holds, `TouchDamage` releases collision callbacks, `HitReceiver` ignores direct hits, and `Stagger` writes zero velocity while dormant.
