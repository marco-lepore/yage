---
"@yagejs-addons/sequence": minor
---

Add authored sequence playback and editing.

- Play validated keyframes and typed event markers against replaceable target contracts.
- Map proportional and anchored positions into a rectangle without scaling actors, with transform and renderer helpers, scene-time playback, pause, seek, loop and restore policies.
- Convert preview positions back to authored values with `SequenceClip.unmapPosition`, preserving proportional and anchored mappings.
- Expose pure document validation for tools and apply entity world positions in hierarchy order during playback and restoration.
- Preserve target lifetime methods and stop remaining writes or events when a binding callback pauses, cancels or seeks playback.
