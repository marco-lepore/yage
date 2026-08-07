---
"@yagejs/renderer": patch
---

Give `AnimatedSpriteComponent` direct frame control.

- `gotoFrame(index)` stops playback and holds the chosen frame, so a sheet can supply static poses that are not animations of their own. It throws when `index` falls outside the source's frames.
- `frame` reads the current frame index.
- `play({ fromStart: true })` starts at frame 0 instead of resuming. A completed non-looping animation replays in full rather than showing only its last frame. A bare `play()` still resumes from the current frame.
