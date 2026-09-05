---
"@yagejs-addons/quests": minor
---

Clarify addon composition and lifecycle contracts.

- Install the full restored quest log before notifying listeners. Active automatic quests that meet current targets emit `questCompleted` before `changed`, allowing listeners to start dependent quests. Restore does not replay objective-completion events or auto-complete manual, completed, or failed quests.
