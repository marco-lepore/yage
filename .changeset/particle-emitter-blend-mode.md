---
"@yagejs/particles": minor
---

`ParticleEmitterComponent` accepts a `blendMode` option, matching the renderer's visual components. Additive fire and sparks no longer need a reach into `emitter.container`:

```ts
const emitter = new ParticleEmitterComponent({
  ...ParticlePresets.fire(),
  blendMode: "add",
});

emitter.blendMode = "normal"; // also a live accessor
```

The mode applies to the emitter's container, so all of its particles blend the same way. It is saved and restored with the rest of the emitter config.
