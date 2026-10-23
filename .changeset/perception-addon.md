---
"@yagejs-addons/perception": minor
---

Add 2D sight and last-seen memory through the `PerceptionSensor` component and the headless `PerceptionMemory` model.

- Configure acquisition and retention range, field of view, facing direction, eligibility, visibility, and line-of-sight checks. `perceptionRaycast()` from the `/physics` subpath blocks sight with the scene's colliders.
- Read the observation of a given entity with `observationOf(entity)`, every visible or remembered target, and the rejection reason of each candidate. Entity events report detection, loss, and forgetting.
- Save observations of keyed targets with `snapshot()` and restore them by entity key with `restore(snapshot)`. Observations are tracked per life of an entity, so a pooled entity's next life starts unobserved.
