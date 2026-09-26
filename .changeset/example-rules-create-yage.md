---
"create-yage": patch
---

The templates teach the recommended structure. The `recommended` template's player respawns through its own `PlayerRespawn` component instead of a closure in `onEnter`, slimes return home by listening for `PlayerHit`, and coins emit `CoinCollected`, which a `CoinCounter` component on a keyed `Hud` entity shows on screen. Asset handles and events live in `src/assets.ts` and `src/events.ts`. The `minimal` template spawns a `Placeholder` entity subclass. Both templates' `AGENTS.md` gain a "Writing game code" section: entity subclasses, rules in components, game state on a keyed host entity, `ProcessComponent` slots instead of `setTimeout`, and `RandomKey` instead of `Math.random`.
