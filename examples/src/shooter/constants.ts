import { Vec2, defineEvent } from "@yagejs/core";
import { CollisionLayers } from "@yagejs/physics";
import { texture } from "@yagejs/renderer";
import { sound } from "@yagejs/audio";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const WIDTH = 800;
export const HEIGHT = 600;
export const WORLD_W = 1200;
export const WORLD_H = 800;
export const TOTAL_ENEMIES = 6;
export const SPAWN = new Vec2(100, 680);

/** Screen-space render layer for the in-canvas HUD (counter + win banner). */
export const HUD_LAYER = "hud";

// Collision layers
const layers = new CollisionLayers();
export const LAYER_PLAYER = layers.define("player");
export const LAYER_PLATFORM = layers.define("platform");
export const LAYER_BULLET = layers.define("bullet");
export const LAYER_ENEMY = layers.define("enemy");

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
/** Damage to an enemy, emitted on that enemy. `dir` is the bullet's direction. */
export const Hurt = defineEvent<{ dir: number }>("hurt");
/** Emitted on a bullet as it hits an enemy or a wall, at the point of impact. */
export const BulletHit = defineEvent<{
  x: number;
  y: number;
  dir: number;
  hitEnemy: boolean;
}>("bullet:hit");
/** Emitted on an enemy when its health runs out, at its position. */
export const EnemyKilled = defineEvent<{ x: number; y: number }>(
  "enemy:killed",
);
/** Emitted on the HUD entity once the last enemy is killed. */
export const AllEnemiesDefeated = defineEvent("enemies:defeated");

// ---------------------------------------------------------------------------
// Sound asset handles
// ---------------------------------------------------------------------------
export const ShootSfx = sound("/assets/laser_gun_shot.wav");
export const HurtSfx = sound("/assets/hurt.wav");
export const ExplosionSfx = sound("/assets/explosion.wav");
export const JumpSfx = sound("/assets/jump.wav");
export const LandSfx = sound("/assets/land.wav");
export const BgMusic = sound("/assets/bgm.mp3");

// ---------------------------------------------------------------------------
// Texture asset handles
// ---------------------------------------------------------------------------
/** Width and height of one frame in the player's sprite sheets. */
export const FRAME_SIZE = 48;

export const PlayerIdleTex = texture("/assets/player_idle.png");
export const PlayerWalkTex = texture("/assets/player_walk.png");
export const PlayerJumpTex = texture("/assets/player_jump.png");
export const PlayerLandTex = texture("/assets/player_land.png");
export const PlayerShootTex = texture("/assets/player_shoot.png");
export const PlayerHurtTex = texture("/assets/player_hurt.png");

export const EnemyIdleTex = texture("/assets/skeleton_idle.png");
export const EnemyWalkTex = texture("/assets/skeleton_walk.png");
export const EnemyReactTex = texture("/assets/skeleton_react.png");
export const EnemyAttackTex = texture("/assets/skeleton_attack.png");
export const EnemyHitTex = texture("/assets/skeleton_hit.png");
export const EnemyDieTex = texture("/assets/skeleton_die.png");
