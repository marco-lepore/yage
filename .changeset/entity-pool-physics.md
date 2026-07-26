---
"@yagejs/physics": minor
---

The collision-event drain runs with pool releases held, so an entity a collision handler returns to its `EntityPool` rejoins the pool only once the batch finishes. Without the hold, an event queued for that entity's previous life could reach its next one.
