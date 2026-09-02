---
"@yagejs/core": minor
---

Scene emits reach the Inspector event log, engine event payloads carry the `Entity`, `defineEvent` validates its name, and components get `listenBus`.

- `scene.emit(token, data)` is recorded in `Inspector.events.getLog()` as `source: "scene"` with no `targetId`, and `events.waitFor(pattern, { source: "scene" })` matches it. `EventLogEntry.source` is `"bus" | "entity" | "scene"`. The log used to skip scene emits while the docs said it covered them.
- The `entity` field of `entity:created`, `entity:destroyed`, `component:added` and `component:removed` is typed as `Entity`. The runtime payload was always the live entity; the type said `{ id, name }`, so `entity.tags.has("enemy")` in a listener did not compile.
- `defineEvent` throws on an empty or non-string name. Entity and scene events dispatch by name, so two tokens with one name share a channel whose payload types are not checked against each other; in dev builds the second definition of a name logs a warning that says so.
- `entity.addChild(name, child)` throws when the child belongs to a different scene than the parent. Such a child kept bubbling its events to its original scene, and that scene's teardown destroyed it while the parent still listed it as a child. A scene-less child still joins the parent's scene.
- `Component.listenBus(event, handler)` subscribes to an engine `EventBus` event and releases the subscription when the component is removed or its entity is destroyed, like `listen` and `listenScene`.
- A throwing token-event observer (the Inspector log's hook on a scene) is recorded in `Inspector.getErrors().callbackErrors` as `"Scene event observer"` and rethrown; it used to escape unattributed.
- Fixed: an `EventBus` unsubscribe called twice removed a second, live registration of the same handler function, and an unsubscribe held across `clear(event)` removed a registration made after the clear. Each unsubscribe now removes only its own entry, once.
- Fixed: a `bus.once` handler fired twice when an earlier handler of the same emit re-emitted the event.
- `EventBus.tap` is documented as it behaves: observers run inside the same error boundary as handlers, so a throwing observer stops that emit's handlers.

**Breaking**, all pre-1.0: `addChild` throws on a cross-scene child it used to accept. Code that narrows `EventLogEntry.source` to two values sees a third. The `entity:*`/`component:*` payload type widens from `{ id, name }` to `Entity`, which only adds members.
