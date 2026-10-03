---
"@yagejs/audio": minor
---

Add master volume and channel listing to AudioManager.

- Configure `masterVolume` in `AudioConfig` or change it at runtime without overwriting channel balance, sound volume, or fades. Master volume applies to playing and future sounds owned by the manager.
- List configured and subsequently created channels with `getChannelNames()`, which returns a read-only snapshot in creation order.
- Return the default volume of 1 from `getChannelVolume` for unknown channels without creating them.
