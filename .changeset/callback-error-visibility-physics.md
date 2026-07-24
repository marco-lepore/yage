---
"@yagejs/physics": patch
---

A collision or trigger handler that throws is now attributed to the handler itself instead of silently disabling `PhysicsSystem` for the rest of the session.

Previously the throw propagated up through the system's update call, which permanently disabled physics for every entity with no console output. Now `ColliderComponent` catches the throw at the handler itself, reports it with a full stack trace naming the handler and entity, and rethrows: see the `@yagejs/core` changeset. The failure is recorded and readable via `engine.inspector.getErrors().callbackErrors`.
