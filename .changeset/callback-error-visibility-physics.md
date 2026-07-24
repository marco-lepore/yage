---
"@yagejs/physics": patch
---

A collision or trigger handler that throws is now attributed to the handler itself instead of silently disabling `PhysicsSystem` for the rest of the session.

Previously the throw propagated up through the system's update call, which permanently disabled physics for every entity with no console output. Now `ColliderComponent` catches the throw at the handler itself. Under the engine's default `errors: "fatal"` policy, that means physics stops the game the same way any other developer-callback throw does, with a full stack trace naming the collision handler and entity — see the `@yagejs/core` changeset. Under `errors: "isolate"`, the handler is logged, unsubscribed, and physics keeps running for everyone else; the failure is recorded and readable via `engine.inspector.getErrors().callbackErrors`.
