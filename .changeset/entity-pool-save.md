---
"@yagejs/save": minor
---

Snapshots skip `EntityPool` members and everything parented under one. A pool restores empty and refills on demand, so a pooled entity in flight at save time is gone after a load rather than coming back as an entity no pool owns.
