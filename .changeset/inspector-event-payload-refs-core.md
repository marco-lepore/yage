---
"@yagejs/core": patch
---

Store a compact ref for a class instance in an Inspector event-log payload.

- `Entity` logs as `{ id, name }`, `Component` as `{ component: "Health" }`, `Scene` as `{ name }`, `Vec2` as `{ x, y }`, any other class instance as `{ _type: "ClassName" }`. Plain objects, arrays and primitives are cloned as before.
- Engine events carry live objects — `component:added` passes the `Component` itself — so an entry used to include the component's private fields, its entity backref, that entity's scene and the scene's internals. On an 11-entity scene the logged payloads drop from 18 KB to 1.2 KB.
- A payload holding a live engine object no longer degrades to `{ _unserializable: true }` on a cycle, and a `Map` or `Set` logs as `{ _type: "Map" }` rather than `{}`.
- Event subscribers are unaffected; only the log's stored copy is a ref. Component field values stay available in the entity snapshot.
