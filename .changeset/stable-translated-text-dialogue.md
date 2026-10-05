---
"@yagejs-addons/dialogue": patch
---

Keep translated UI and dialogue consistent.

- Preserve computed text values during locale changes, choice selection, and confirmation. Each new visit to a step evaluates its expressions again.
- Evaluate previews with a variable snapshot and a separate random generator, so requesting a preview cannot alter gameplay randomness. Previewed random outcomes may differ from playback.
