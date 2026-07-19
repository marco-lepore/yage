import { texture } from "@yagejs/renderer";
import { sound } from "@yagejs/audio";

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

export const FRAME_SIZE = 48;
