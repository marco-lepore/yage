---
"@yagejs/physics": patch
---

Fix shape casts missing floors and walls when starting almost in contact with them under Rapier 0.20. Recover the nearest surface while retaining the requested cast distance, query filters, and escape from initial overlap with `stopAtPenetration: false`.
