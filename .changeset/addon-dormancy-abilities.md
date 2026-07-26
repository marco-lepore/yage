---
"@yagejs-addons/abilities": minor
---

Addon components now follow entity activeness, so disabling a component or deactivating its entity also sleeps resources that live outside `update()`.

- `Abilities` pauses active phases, linger, and cooldowns while dormant. It refuses new actions and temporarily releases open hitbox, guard, invulnerability, slow-motion, and stagger effects, then restores them on enable.
- Custom window steps can implement `suspend` and `resume` hooks to apply the same lifecycle to game-owned effects.
- `AbilityDriverComponent` releases input listeners and owned holds, `TouchDamage` releases collision callbacks, `HitReceiver` ignores direct hits, and `Stagger` writes zero velocity while dormant.
