---
"@yagejs/particles": minor
---

A particle emitter now copies the configuration it is constructed with.

Nested values used to be kept by reference — a `[min, max]` array, a `Lerped` pair, `gravity`, `spawnOffset` — and the emitter re-read them at every spawn. Changing one after construction therefore changed future particles. That was never a documented technique, it depended on the value's shape (`angle: [0.3, 0.3]` was shared while `angle: 0.3` was not), and it slipped past the checks that run once at construction, so a `NaN` written into a range array reached every particle's velocity unnoticed.

Each of those values is now copied, so changing the object you passed in does nothing. No type error surfaces this: a build that relied on it keeps compiling and stops following the object. In a development build the emitter reports the first such change once, naming the option.

Runtime changes go through the surfaces that exist for them:

```ts
emitter.configure({ angle: [aim - 0.2, aim + 0.2] }); // from now on
emitter.burst(2, x, y, { angle: [aim - 0.2, aim + 0.2] }); // this burst only
```
