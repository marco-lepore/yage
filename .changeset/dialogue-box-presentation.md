---
"@yagejs-addons/dialogue": minor
---

Fit dialogue boxes to their content and expose presentation configuration.

- Replace `box.height` with `box.minHeight` (default 0). Say lines and choices fit their complete wrapped content before reveal, up to the viewport height. Speakerless lines reserve no nameplate band, and choices start below the prompt or at the content top. Say frames reserve space for the configured continue indicator below text and portraits.
- Bind shared box layouts through `mount(scene)` or `setViewport(width, height)` before reading geometry. Built-in box presenters bind automatically; viewport and avatar-inset changes reflow text and choice targets.
- Require `ChoiceChannel.update(dt)` for presentation animation. Static custom presenters can implement an empty method. Conversation pause freezes it, including mixed presenters.
- Add `layerFrameOrder` and `layerTextOrder` to themes and screen chrome/choice configs, and `layerOrder` to screen text/avatar configs. Existing host layer orders and mismatch diagnostics remain in effect.
- Add speaker `avatar.flipX` for portraits and line `meta.flipX` for in-box portraits. Correct the voice playback example to use `SoundHandle.paused`.
