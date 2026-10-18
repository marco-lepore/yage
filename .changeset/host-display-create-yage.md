---
"create-yage": patch
---

Report fullscreen and screen orientation through one display contract that a host can supply.

- The Recommended template's fullscreen button reads `renderer.fullscreenSupport` to decide whether to show itself, which covers iPhone, a frame from another origin, and an installed app that already opens fullscreen in one check.
- The button's label starts from the game's current state, so a game that opens fullscreen shows the exit label from the first frame.
