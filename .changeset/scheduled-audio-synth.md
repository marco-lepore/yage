---
"@yagejs-addons/synth": minor
---

Add scheduled playback, procedural instruments, and adaptive music through one audio path.

- Add 25 seeded instrument and noise descriptors, including plucked strings, mallets, electric piano, sustained pad, additive flute, clarinet, organ, and percussion. Export sample rendering with sustain-loop metadata alongside the existing patch and jingle APIs.
- Allow a dedicated worker to render the bank with explicit readiness, cancellation, error and fallback diagnostics. Engine startup awaits registration; worker transport failure or timeout reports its reason before using the main thread.

- Expose pure rendering and validated portable sound data through `/render` for build tools and previews.

- Keep basic synthesis separate from the instrument catalogue. Import individual definitions from `/instruments/<name>` and supply them through `instruments` to the plugin, worker and generic renderers. The complete catalogue is available from `/instruments`.
- Move `SynthPlugin` to `/plugin`; update imports from the package root. Basic rendering imports no engine integration or instrument implementations.
