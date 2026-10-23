---
"@yagejs/level": patch
---

Add `levelSceneKeys(prepared, namespace)`, which returns the scene keys `instantiateLevel` gives a level's entities without loading anything. A game that loads several levels together checks the keys with `scene.findByKey` first, so a taken key stops the whole load before any level is created.
