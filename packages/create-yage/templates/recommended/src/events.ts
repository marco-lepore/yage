import { defineEvent } from "@yagejs/core";

// Game events. An entity emits one on itself (`this.entity.emit(...)`), and it
// bubbles to the scene, where any component can listen with `listenScene`.

/** The player touched a hazard or a slime and went back to the start. */
export const PlayerHit = defineEvent("game:player-hit");

/** The player picked up a coin. */
export const CoinCollected = defineEvent("game:coin-collected");
