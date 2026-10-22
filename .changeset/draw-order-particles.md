---
"@yagejs/particles": patch
---

`ParticleEmitterComponent` has `zIndex` and `sortOffset`. `zIndex` orders the emitter among its siblings on a layer without `sort`; on a sorted layer, `ySort` keys the emitter at its entity's y plus `sortOffset`, and a non-zero `zIndex` logs one development warning. Both throw on a non-finite value.
