---
"@yagejs/audio": minor
---

Entities can now be turned off and reused instead of destroyed and respawned: `entity.setActive(false)` puts an entity and its whole subtree to sleep, and components get `onEnable` / `onDisable` to release and reacquire live resources.

- `SoundComponent` stops playback when the entity goes dormant. It does not restart on its own — call `play()` again if the sound should resume.
- `SoundComponent`'s `playOnAdd` starts the sound once the entity is active. Adding the component to a dormant entity leaves it silent until the entity is activated; later deactivate/reactivate cycles do not replay it.
