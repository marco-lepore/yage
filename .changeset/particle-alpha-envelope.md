---
"@yagejs/particles": patch
---

Fade particles in and out with `alphaFadeIn` and `alphaFadeOut`.

Both are fractions of a particle's own lifetime, 0-1, and both default to 0. They multiply whatever `alpha` produces rather than replacing it, so a particle can ramp up, hold its lerp, and ramp down:

```ts
{ lifetime: [1, 2], alpha: 0.6, alphaFadeIn: 0.15, alphaFadeOut: 0.4 }
```

Alpha had two points and no ramp, so an emitter spreading particles across an area popped each one in at full opacity. A fade-in spawns the particle at 0 instead.

Two things to know. A hand-rolled fade such as `alpha: { start: 0, end: 1 }` multiplies with `alphaFadeIn` rather than being replaced by it, which ramps twice. Fractions that overlap — both above 0.5 — multiply in the middle, so alpha never reaches the value `alpha` asked for; that is legal, not an error. `scale` has no envelope, and the presets are unchanged.
