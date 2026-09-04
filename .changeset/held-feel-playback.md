---
"@yagejs-addons/feel": minor
---

Let Feel cues follow gameplay-owned lifetimes and play-time timing.

- Scale finite cue timelines with `play(..., { duration })`.
- Release held states and open loops through the playback handle or `Feel`
  component.
- Keep held trails and particle emission active until release, and keep sounds
  active until their audio handle or shared request completes.
- Advance timed SceneTime sequence steps when their retained request expires.
- Validate fixed flight-line directions when the node is built, and skip a
  timed burst when its live direction is zero or near zero.
- Share finite pulse timing across renderer pulse builders and `dashBurst`.
- Drive hit flash through Feel's pulse clock so its peak and easing can be
  configured without starting the preset's self-scheduled trigger ramp.
