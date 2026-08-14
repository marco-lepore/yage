---
"@yagejs/effects": patch
---

An engine peer range names the one engine minor the package was built and tested against.

- The `@yagejs/renderer` peer range is `>=0.10.2 <0.11.0`. It admitted every renderer from 0.3.0 up to 1.0.0 before, which npm read as a promise that any of them would work. Nothing built or ran those combinations, and the oldest are broken outright: the presets call `defineEffect` and are typed against `Effect` and `EffectHandle`, none of which a renderer below 0.4.0 exports.
- A game holding renderer and effects on different minors now gets a version conflict from npm at install time, instead of an install that resolves a second copy of a shared package and fails later.
