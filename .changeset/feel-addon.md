---
"@yagejs-addons/feel": minor
---

Add composable game-feel cues with visual, time, camera, audio, filter, and
particle effects.

- Define named cues with parallel and sequential timing, delays, repeats,
  intensity, chance, cooldowns, and retrigger policies.
- Keep the root entry core-only and provide optional renderer, audio, and
  particle adapters.
- Add animated outline, glow, and colorize pulses plus floating text, damage
  numbers, and procedural impact rings.
- Add scale shake and camera rotation pulses through the existing modifier
  owners.
- Add directional flight lines, sampled motion trails, and fading sprite
  afterimages as temporary world-space visuals.
- Own visual, camera, filter, sound, and particle feedback through removable
  handles, so cancellation removes only the current playback's contribution.
- Keep the code-authored component, cue playback, and built-in temporary
  feedback out of save snapshots.
