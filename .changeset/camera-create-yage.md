---
"create-yage": patch
---

pr: 21
commit: 32b35dcc89b5e28fdb852a08127f0a6f06ded819
author: marco-lepore

Rework the camera system into an entity + layer-binding model, and give every scene its own container.

- Template scenes (`minimal` and `recommended`) migrated to the new `CameraEntity` API.
