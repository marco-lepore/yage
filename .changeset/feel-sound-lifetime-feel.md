---
"@yagejs-addons/feel": minor
---

Control sound lifetimes and stopping fades.

- Add `feelSound({ lifetime: "sound" })` to let a recording finish after its cue or owner disappears. The default `"cue"` lifetime retains cue-owned stopping.
- Add opt-in `fadeOut` seconds for cue-owned sounds. Shared recordings fade only when their last owner releases them.
- Accept a non-empty alias list, sampled from the scene's seeded random source on each sound start.
- Explain repeated `feelLoop` sounds and continuous `SoundComponent` loops in the loop error.
- Suppress cue-owned completion callbacks after release or cancellation, including recordings that end during a fade. Sound-lifetime callbacks still run on natural completion.
