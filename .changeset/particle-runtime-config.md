---
"@yagejs/particles": patch
---

Change a particle emitter after it is built, and vary a single burst.

`configure(options)` sets the emitter's configuration from now on: `lifetime`, `speed`, `angle`, `scale`, `alpha`, `rotation`, `rotationSpeed`, `tint`, `spawnOffset`, `radialSpeed`, `rate`, `gravity`, `damping` and `blendMode`. The spawn-time options — everything in that list up to `radialSpeed` — are resolved once per particle, so a particle already in flight keeps what it was spawned with and the next particle spawned uses the new value. `gravity` and `damping` are read from the emitter every frame for every live particle, so they reach particles already in flight on the next frame.

`burst` takes an optional overrides object as its last argument. Those values apply to the particles that burst spawns and to nothing else — not to the emitter's own configuration, and not to any particle already alive. An effect whose direction follows the action can now aim per burst instead of holding one emitter per direction:

```ts
emitter.burst(2, fistX, fistY, { angle: [swing - 0.18, swing + 0.18] });
```

Both surfaces check the whole merged configuration and throw on a bad value, the same way construction does; a rejected `configure` leaves every previous value in force. `maxParticles`, `layer`, `simulationSpace` and the texture source are allocated when the emitter is built, so passing one of them to either method is a type error rather than a silent no-op.

The `sparks` preset described itself as "directional" while it emits into a full circle with downward gravity. Its description now says what it does.
