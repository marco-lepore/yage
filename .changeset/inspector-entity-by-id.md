---
"@yagejs/core": minor
---

The Inspector's per-entity reads take an entity id as well as a name, so the ids `getEntities()`, `snapshot()` and the event log hand out can be fed straight back in and several same-named entities are individually readable.

`getEntity(nameOrId)`, `getEntityPosition(nameOrId)`, `hasComponent(nameOrId, componentClass)` and `getComponentData(nameOrId, componentClass)` accept a `string | number`. A name resolves the first active entity of the active scene, unchanged. An entity id resolves one entity anywhere on the scene stack, dormant and inactive ones included and destroyed ones excluded — the population `getEntityCount()` counts. Both id spellings work: the number from `getEntities()[].id` and the string from `snapshot().scenes[].entities[].id` or an event log `targetId`. A string is matched as a name first, so a name wins over an id with the same spelling.

`getEntityByName` is renamed `getEntity`, with no alias: the method takes an id now, so its old name stated the opposite of its contract. Rename the call site.
