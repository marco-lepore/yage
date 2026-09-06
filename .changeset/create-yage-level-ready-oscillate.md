---
"create-yage": patch
---

Take `Oscillate`'s centre on its first update instead of in `onAdd`, so a coin or a hazard placed by a level bobs around where the level put it. A level applies a placement's transform after `setup()` returns, so the position `onAdd` read was the one the entity had before it was placed, and the first update wrote that position back.
