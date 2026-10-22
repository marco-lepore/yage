---
"@yagejs-addons/loot": minor
---

Add typed loot tables with explicit seeded randomness, weighted pools, quantity ranges, nested tables, eligibility conditions and draws without replacement.

Roll results include reward origins and a typed trace that explains each selection and exclusion. Definitions are validated before use, including nested references and cycles. An optional `LootComponent` uses scene randomness, emits `LootRolledEvent` with the rewards, and exposes the last roll and callback failures through the Inspector. Games keep item definitions, inventory acceptance, once-only rewards, pity counters and saved chest progress.
