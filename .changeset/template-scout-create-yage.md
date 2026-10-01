---
"create-yage": patch
---

The `recommended` template's player is the scout from the YAGE examples, made for YAGE and released as CC0. Its strips are `public/assets/player-idle.png`, `player-walk.png` and `player-jump.png`, with 48 × 48 frames. The player's collider is 14 × 28 px to match the drawn body, and the sprite's anchor puts the body's center on the entity. `PlayerController`'s ground check casts its ray 20 px down from that center. `public/assets/CREDITS.md` and `AGENTS.md` credit the scout.
