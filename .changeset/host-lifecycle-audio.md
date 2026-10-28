---
"@yagejs/audio": minor
---

Follow one host state for application activity, visibility and focus.

- `Breaking:` the `autoMuteOnBlur` config option and `AudioManager.autoMuteOnBlur` are `autoPause`.
- `autoPause` holds all audio while `Host.active` is `false`: the app is in the background, the page is hidden, or the window is unfocused. Playback continues from where it stopped, and channel and handle volume, mute and pause are left as the player set them.
- `isUnlocked()` documents what it returns: `false` before the first gesture, while audio is held for an inactive host, and until the context has resumed after the return.
- `onUnlock` runs a pending callback when the `AudioContext` next starts running, so a callback registered while audio is held runs when the hold ends.
