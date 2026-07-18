---
"@yagejs/particles": patch
---

Snapshot restore order is now driven by a `restorePriority` static on each component class.

- `ParticleEmitterComponent` declares priority 50, keeping it inside the engine band so it restores before undeclared game components.
