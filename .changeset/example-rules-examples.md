---
"@yagejs/examples": patch
---

The examples follow the rules game code follows, written down in `examples/AGENTS.md`: entity types are `Entity` subclasses, components hold the rules, `onEnter` only assembles the scene, and game state lives in a component on a keyed host entity. Timers run on engine time instead of `setTimeout`/`setInterval`, randomness comes from the scene's seeded `RandomService` instead of `Math.random`, and `npm run lint` now covers the examples and rejects both. The platformer is the reference example to copy.

Bugs fixed along the way:

- dialogue-addon: Mira's screen-shake marker shook the camera for 320 seconds.
- world-ui-react: the namecards orbited 1000 times too slowly and looked static.
- audio: the music pulse took about 17 minutes per beat, and pads started at full brightness.
- camera: the landmarks' bob took up to 105 minutes per cycle and looked frozen.
- shooter: the enemy hit-shake never showed.
- abilities-addon: the hotbar panels covered their own labels, and the death banner said "Reload" where R resets.
- quests-addon: the healer's prompt was never destroyed. pathfinding: the pointer listener outlived its component.
- loading-scene runs in the e2e smoke suite again, now that its fake loader follows the game clock.
