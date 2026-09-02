---
"@yagejs/core": minor
---

Component lookup and queries match subclasses, so a base class can name a family.

- `entity.has(Cls)` is true when the entity carries `Cls` or any subclass of
  it, and a `QueryCache` filter matches the same way — `register([Transform,
VisualComponent])` now finds an entity carrying a `SpriteComponent`.
- Add `entity.getAll(Cls)`: every component assignable to `Cls`, in add order,
  as a read-only view. Removing a component replaces the list rather than
  mutating it, so a walk already in flight visits every member it started
  with. A `QueryResult` holds entities, not components, so this is how a
  system reads several matching components off one entity.
- `entity.get(Cls)` and `tryGet(Cls)` prefer an exact match, then return the
  single assignable component. They throw when more than one is assignable,
  naming the candidates and pointing at `getAll`.
- `ComponentClass` accepts an abstract constructor, so an abstract base works
  as a query filter and as a `getAll` argument.
- Breaking: `get`/`tryGet` throw on an ambiguous base class, and `has` and
  queries report entities they previously missed. Uniqueness is unchanged —
  `add` still rejects a second instance of the same exact class.
- A throwing scene-transition `begin`, `tick`, `end`, or finalize step is
  reported through the error boundary, so it reaches
  `Inspector.getErrors().callbackErrors` instead of only the log. The
  transition still continues, as documented.
