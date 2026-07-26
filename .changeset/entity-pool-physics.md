---
"@yagejs/physics": minor
---

The collision drain reads every pair before it dispatches any of them, so a collision queued for an entity's previous life is dropped instead of reaching whatever the pool handed out next. Both sides of a pair are captured with the life they were queued for, and each side is re-checked immediately before its own handler runs, because the first handler can retire the second side's receiver.

- Releasing an entity from inside `onCollision` or `onTrigger` is safe, including releasing the other side of the pair being handled.
- Events still queued for an entity a handler released are dropped for the rest of that drain.
