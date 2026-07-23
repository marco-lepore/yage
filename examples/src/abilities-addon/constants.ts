export const WIDTH = 820;
export const HEIGHT = 580;
export const ARENA_MARGIN = 24;

/** Screen-space HUD layer (hotbar, HP/log text) — declared on
 *  `AbilitiesDemoScene.layers` so the camera's zoom/follow (see `onEnter`)
 *  never moves or scales it; every other entity stays on the default
 *  world-space layer and scrolls/zooms with the camera as normal. */
export const HUD_LAYER = "hud";

/** Camera zoom (see `AbilitiesDemoScene.onEnter`) — a light zoom-in without
 *  cropping the arena's short (height) axis out of view. */
export const CAMERA_ZOOM = 1.2;
/** Follow smoothing factor (0..1, lower = softer) — see `CameraFollow`. */
export const CAMERA_FOLLOW_SMOOTHING = 0.1;

// PLAYER_SPEED/ENEMY_SPEED keep their original ~2.07:1 ratio (145:70) — see
// the tuning note on `BOXER_ANIM_SPECS.run` for why both moved together.
export const PLAYER_SPEED = 195;
export const PLAYER_RUN_SPEED = 280;
export const ENEMY_SPEED = 95;
/** Beyond this distance the token-holding enemy closes in instead of attacking; within it, melee. */
export const ENEMY_MELEE_RANGE = 80;
/** Beyond this distance the token holder stops closing in and casts a fireball instead. */
export const ENEMY_FAR_RANGE = 230;
/** Non-token enemies orbit/strafe the player within this band instead of
 *  closing to melee range — see `EnemyAI.reposition`. */
export const ORBIT_MIN_RANGE = 140;
export const ORBIT_MAX_RANGE = 200;
/** Extra distance added to both `ORBIT_MIN_RANGE`/`ORBIT_MAX_RANGE` during
 *  the engagement token's handoff pause — a brief step back right after the
 *  current attacker's swing recovers. */
export const ORBIT_BACKOFF_RANGE = 45;
/** Push non-token enemies apart once closer than this to each other, so
 *  circlers don't stack on the same point around the player. */
export const ORBIT_SEPARATION_RANGE = 90;
/** Non-token enemies move a bit slower than the token holder's own chase
 *  speed — orbiting reads as patient circling, not a second rush. */
export const ORBIT_SPEED_MULT = 0.75;
/** Seconds the engagement token stays unclaimed after its holder's attack
 *  recovers — a visible beat between attackers, and (while it's ticking)
 *  the window `EnemyAI.reposition` reads to add a brief outward "backing
 *  off" push on top of the normal orbit. */
export const TOKEN_HANDOFF_PAUSE = 0.6;
export const PLAYER_TINT = 0xffffff;
export const ENEMY_TINT = 0xff8a8a;

export const CORPSE_LINGER = 3;
