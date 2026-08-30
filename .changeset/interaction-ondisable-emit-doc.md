---
"@yagejs-addons/interaction": patch
---

Correct the `Interactor.onDisable` doc comment describing when its range and focus transitions reach listeners. Destroying the interactor's own entity marks it first, so the emits are dropped; destroying an ancestor deactivates it before the cascade marks it, so there they are delivered.
