---
"@yagejs-addons/abilities": minor
---

Remove `HealthSnapshot` and automatic `Health` serialization. Games that treat
health as durable state should store `{ hp, max }` in their explicit save root
and construct `Health` from those values.
