---
"@yagejs-addons/perception": minor
---

Add 2D sight and last-seen memory through PerceptionSensor and the headless PerceptionMemory model.

- Configure acquisition and retention range, field of view, eligibility, visibility, and line-of-sight policies. An optional physics adapter reuses world raycasts.
- Read detected and remembered targets, rejection reasons, and observation ages through the component and existing Inspector. Entity events report detection, loss, and forgetting.
- Save data-only observations with explicit target resolution on restore. Entity handles prevent pooled lives from inheriting stale target references.
