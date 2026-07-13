---
"@yagejs-addons/quests": minor
---

Add the `@yagejs-addons/quests` addon: a headless `QuestLog` model (`defineQuests` two-level id capture, flat `requires` prerequisites, per-objective progress, auto-complete rollup, snapshot/restore) plus an optional `QuestController` that mirrors model events onto the engine bus. Objectives bind to other addons' events through game-authored one-line adapters — no dialogue/inventory dependency.
