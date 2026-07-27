---
"@yagejs-addons/quests": minor
---

Addon components now follow entity activeness, so disabling a component or deactivating its entity also sleeps resources that live outside `update()`.

`QuestController` stops its model-to-entity event mirror while dormant and restores it on enable. The standalone `QuestLog` remains live, and dormant events are not replayed.
