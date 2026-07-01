---
"create-yage": minor
---

Update the scaffolded template for the seconds-based engine time unit.

The `Oscillate` component in the recommended template integrates `dt` directly; `Component.update(dt)` now delivers seconds, so it accumulates `dt` without the old millisecond conversion.
