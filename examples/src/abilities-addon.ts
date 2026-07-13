/**
 * The first example for @yagejs-addons/abilities: a close-quarters top-down
 * arena brawl exercising the full timeline-ability + hit-contract surface.
 *
 * - Player `Abilities`: a hand-rolled 1-2-3 combo (`attack1`/`attack2`/
 *   `attack3`, each a `hitbox` window) plus a tap-vs-hold charge attack,
 *   "dash" (`invulnerable` + a game-defined movement step, buffered mid-combo
 *   — see `PlayerController.updateCombat`'s dash-cancel), a hold-vs-tap
 *   guard (`GUARD_HOLD`/`PARRY`: holding reduces every landed hit in place
 *   with no stagger and never closes early, tapping cancels into a short
 *   negate-and-punish parry window with a hand-rolled counterattack/
 *   projectile-reflect on success — see `PlayerController.updateGuard`),
 *   "potion" (a `heal` point step on the `"item"` lane, so it plays even
 *   while the main lane is busy). Every player ability's timeline is windup
 *   → active (hitbox/effect) → recovery: `AbilityDef.duration` extends past
 *   the active window so landing (or whiffing) a swing leaves the lane busy
 *   for a beat afterward. Every combo/charge/counter def additionally sets
 *   `priority: SUPER_ARMOR_PRIORITY` (above the addon's built-in stagger
 *   reaction) so a committed attack still takes damage but can't be flinched
 *   or knocked back out of it — see the ability defs below.
 * - Enemies: a telegraphed melee `hitbox` (windup → active → recovery, with
 *   a `telegraph` step that flashes the sprite and bursts particles through
 *   the whole windup) plus a `projectile` ranged attack (`SHOOT`), aimed at
 *   the player and carrying the same telegraph through its cast. Unlike the
 *   player, enemies carry no `priority` (super armor) on these defs — a
 *   landed hit interrupts a telegraphed swing at any point, so punishing the
 *   tell actually stops the attack instead of only chipping through it (see
 *   `07-reactions.md`'s evidence note for the diagnosis). An engagement
 *   token (`EngagementToken`) lets only one enemy hold it at a time: the
 *   holder runs the melee / close-in / shoot logic below, everyone else
 *   orbits/strafes at mid range instead of piling onto the player.
 *   `EnemyAI` picks melee / close-in / shoot off distance to the player each
 *   frame, and attacks gate movement the same way the cast always has.
 * - `Health` + `Stagger` + `HitReceiver` on both sides. `Facing` on every
 *   combatant drives both ability aim and which 8-directional sprite frame
 *   plays. While an ability gates the player's movement, `PlayerController`
 *   freezes Facing except at the next action boundary — a combo stage
 *   firing, a buffered dash executing, a charge releasing, a parry starting
 *   — where it re-samples whatever movement direction is currently held (see
 *   `PlayerController.resampleFacing`), so a buffered action rolls out in
 *   the direction held when it actually fires rather than when it queued.
 *   Death turns an entity into an inert corpse — dead-specific
 *   components removed, body translation locked — instead of leaving it
 *   dealing damage or sliding around. A pale strobe on the sprite marks
 *   invulnerability from any source — the def-authored windows on dash and
 *   the parry counter (paired `invulnFlash` window steps at the same
 *   `from`/`to` as their `invulnerable` steps) and the post-hit i-frames
 *   `HitReceiver` arms automatically (`runInvulnFlash`, triggered off
 *   `HitReceived`, reading `HitReceiver.iframesRemaining`).
 * - Feedback: hitstop and camera shake scale with the landed ability's
 *   weight (`ABILITY_WEIGHTS`/`HITSTOP_BY_WEIGHT`/`SHAKE_BY_WEIGHT`), every
 *   landed hit bursts impact particles sized by damage and plays a thock, a
 *   parry sparks and rings, a blocked hit thuds, death booms, and the charge
 *   attack draws a hand-rolled ring of sparks converging on the caster
 *   (`ChargeSpark` — `@yagejs/particles`' emitter config can't correlate a
 *   particle's spawn position with its travel direction, so a converging
 *   effect isn't expressible through it) — see `VfxHub`, the SFX section,
 *   and `PlayerController.triggerHitstop`.
 * - A `CameraEntity` zoomed in and softly following the player, clamped to
 *   the arena; the hotbar/HP/log HUD lives on its own screen-space layer
 *   (`HUD_LAYER`) so it stays viewport-fixed under the zoom/follow — see
 *   `AbilitiesDemoScene.onEnter`. R tears down and rebuilds the whole scene
 *   (`PlayerController.resetDemo`) without a page reload.
 * - A bottom-center hotbar (`HotbarSlot`) mirrors the player's four action
 *   slots (combo/charge share one slot) with a per-frame clock-wipe arc and
 *   an `X.X` countdown, read off `Abilities.cooldownRemaining`/
 *   `cooldownRatio` for dash/guardHold/potion and off the active def's own
 *   elapsed/duration for the shared attack/charge slot, which has no single
 *   cooldown id to poll (see `PlayerController.attackSlotState`).
 *
 * Visuals are the CC0 "8-Directional Melee Character (Boxer)" sprite pack
 * (see `examples/public/assets/CREDITS.md`) via `AnimatedSpriteComponent` +
 * `AnimationController`. The addon's own `anim` timeline step drives a core
 * `KeyframeAnimator`, not a sprite sheet, so this example defines its own
 * `spriteAnim`/`spriteHold` steps (see the "Boxer sprite animation" section
 * below) that pick the right directional frames off `AnimationController`,
 * plus a `telegraph` step for the enemy windup tell.
 *
 * H toggles the engine's built-in physics debug overlay (`DebugPlugin`'s
 * `toggleKey`) — collider wireframes for every body, including the
 * sensors `hitbox`/`projectile` spawn, colored by body type (yellow for
 * sensors). No example-side hitbox overlay was needed; see the evidence
 * note on `20-example-ergonomics-batch.md`.
 */

import {
  Component,
  Engine,
  Entity,
  Process,
  ProcessComponent,
  ProcessSystemKey,
  Scene,
  Transform,
  Vec2,
  trait,
} from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import {
  AnimatedSpriteComponent,
  AnimationController,
  CameraEntity,
  GraphicsComponent,
  RendererKey,
  RendererPlugin,
  TextComponent,
  sliceTextureFrames,
  texture,
} from "@yagejs/renderer";
import type { AnimationDef, LayerDef, TextureHandle } from "@yagejs/renderer";
import {
  ColliderComponent,
  PhysicsPlugin,
  RigidBodyComponent,
} from "@yagejs/physics";
import {
  ParticleEmitterComponent,
  ParticlePresets,
  ParticlesPlugin,
} from "@yagejs/particles";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { AudioManagerKey, AudioPlugin, sound } from "@yagejs/audio";
import {
  Abilities,
  Facing,
  Health,
  HealthDamaged,
  HealthDied,
  HealthHealed,
  HitDealt,
  Hittable,
  HitGuarded,
  HitReceived,
  HitReceiver,
  Projectile,
  REACTION_PRIORITY,
  Stagger,
  createReportingDelivery,
  defineStep,
  guard,
  hitbox,
  invulnerable,
  spawn,
} from "@yagejs-addons/abilities";
import type {
  AbilityDef,
  AbilitySpawnContext,
  AbilityStep,
  GuardPolicy,
  Hit,
  HitResult,
  ProjectileConfig,
} from "@yagejs-addons/abilities";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles(`
  #dead-banner {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.85);
    color: #ef4444;
    font-family: system-ui, sans-serif;
    font-size: 1.8rem;
    padding: 1.5rem 2.5rem;
    border-radius: 12px;
    border: 2px solid #ef4444;
    text-align: center;
    pointer-events: none;
    display: none;
  }
`);

const WIDTH = 820;
const HEIGHT = 580;
const ARENA_MARGIN = 24;

/** Screen-space HUD layer (hotbar, HP/log text) — declared on
 *  `AbilitiesDemoScene.layers` so the camera's zoom/follow (see `onEnter`)
 *  never moves or scales it; every other entity stays on the default
 *  world-space layer and scrolls/zooms with the camera as normal. */
const HUD_LAYER = "hud";

/** Camera zoom (see `AbilitiesDemoScene.onEnter`) — a light zoom-in without
 *  cropping the arena's short (height) axis out of view. */
const CAMERA_ZOOM = 1.2;
/** Follow smoothing factor (0..1, lower = softer) — see `CameraFollow`. */
const CAMERA_FOLLOW_SMOOTHING = 0.1;

// PLAYER_SPEED/ENEMY_SPEED keep their original ~2.07:1 ratio (145:70) — see
// the tuning note on `BOXER_ANIM_SPECS.run` for why both moved together.
const PLAYER_SPEED = 195;
const ENEMY_SPEED = 95;
/** Beyond this distance the token-holding enemy closes in instead of attacking; within it, melee. */
const ENEMY_MELEE_RANGE = 80;
/** Beyond this distance the token holder stops closing in and casts a fireball instead. */
const ENEMY_FAR_RANGE = 230;
/** Non-token enemies orbit/strafe the player within this band instead of
 *  closing to melee range — see `EnemyAI.reposition`. */
const ORBIT_MIN_RANGE = 140;
const ORBIT_MAX_RANGE = 200;
/** Extra distance added to both `ORBIT_MIN_RANGE`/`ORBIT_MAX_RANGE` during
 *  the engagement token's handoff pause — a brief step back right after the
 *  current attacker's swing recovers. */
const ORBIT_BACKOFF_RANGE = 45;
/** Push non-token enemies apart once closer than this to each other, so
 *  circlers don't stack on the same point around the player. */
const ORBIT_SEPARATION_RANGE = 90;
/** Non-token enemies move a bit slower than the token holder's own chase
 *  speed — orbiting reads as patient circling, not a second rush. */
const ORBIT_SPEED_MULT = 0.75;
/** Seconds the engagement token stays unclaimed after its holder's attack
 *  recovers — a visible beat between attackers, and (while it's ticking)
 *  the window `EnemyAI.reposition` reads to add a brief outward "backing
 *  off" push on top of the normal orbit. */
const TOKEN_HANDOFF_PAUSE = 0.6;
const PLAYER_TINT = 0xffffff;
const ENEMY_TINT = 0xff8a8a;

// ---------------------------------------------------------------------------
// Boxer sprite animation
// ---------------------------------------------------------------------------
// CC0 "8-Directional Melee Character (Boxer)" pack, credited in
// examples/public/assets/CREDITS.md. Every sheet is a row-major grid of
// 126x132 frames, one sheet per animation per direction
// (`/assets/boxer/<Anim>_dir<1-8>.png`), some with empty trailing cells —
// `frames` below is each sheet's real (non-empty) frame count, re-verified
// pixel-by-pixel against every direction of every sheet this example uses:
// all match exactly, no shifted/partial cells from a wrong count.
//
// Direction convention: dir1=SW dir2=W dir3=NW dir4=N dir5=SE dir6=E dir7=NE
// dir8=S. This is NOT a uniform rotation by direction number — the pack
// orders the four diagonals as left/right mirror pairs of the nearest
// cardinal (dir1/dir5 and dir3/dir7 are mirror images), not by sweeping
// angle. In the engine's screen-space angle (0=east, 90°=south, clockwise,
// since Vec2 Y is down) the 8 sheet directions land exactly on 45° octants,
// so quantizing `Facing.unit`'s angle to the nearest octant and looking up
// the matching `dirN` is a straight table lookup.
//
// Verified per-sheet-family, not just once: every `dirN` of FightIdle,
// LeftJab, RightJab, FlyingKick, HighKick, ForwardRoll, FrontKick, Die1, and
// HitBody was diffed frame-by-frame at high zoom against the front-vs-back
// signature (face + chest visible vs. cap-from-behind + shoulder blades) —
// all 9 agree with the convention above. RunForward alone does not: its
// `_dir5.png` draws the back-right (NE) pose and `_dir7.png` draws the
// front-right (SE) pose, the two transposed from every other sheet in the
// pack — this is what read as "up-right/down-right swapped" during a run,
// not a wrong global mapping. `resolveSheetDir` below corrects for it.

const DIR_COUNT = 8;
const FRAME_W = 126;
const FRAME_H = 132;
/** Default direction (east) — matches `Facing`'s default unit vector `(1, 0)`. */
const DEFAULT_DIR = 6;

/** Octant index (0=E, 1=SE, 2=S, ... 7=NE, going clockwise) -> sheet `dirN`. */
const OCTANT_TO_DIR = [6, 5, 8, 1, 2, 3, 4, 7] as const;

/** Quantize a facing unit vector to the sprite sheet's nearest 45° direction (1-8). */
function facingToDir(facing: Vec2): number {
  const deg = (facing.angle() * 180) / Math.PI;
  const normalizedDeg = ((deg % 360) + 360) % 360;
  const octant = Math.round(normalizedDeg / 45) % 8;
  return OCTANT_TO_DIR[octant]!;
}

/** Corrects `facingToDir`'s otherwise-uniform octant table for RunForward's
 *  transposed dir5/dir7 files (see the direction-convention doc above) —
 *  every other animation uses the octant table's `dirN` as-is. */
function resolveSheetDir(anim: BoxerAnim, dir: number): number {
  if (anim !== "run") return dir;
  if (dir === 5) return 7;
  if (dir === 7) return 5;
  return dir;
}

type BoxerAnim =
  | "idle"
  | "run"
  | "attack1"
  | "attack2"
  | "attack3"
  | "chargeHold"
  | "chargeRelease"
  | "dash"
  | "guard"
  | "potion"
  | "melee"
  | "stagger"
  | "death"
  | "cast";

interface BoxerAnimSpec {
  /** Sheet basename under `/assets/boxer/`. */
  sheet: string;
  /** Real (non-empty) frame count for this sheet. */
  frames: number;
  /** `AnimatedSprite.animationSpeed`. */
  speed: number;
  loop: boolean;
}

const BOXER_ANIM_SPECS: Record<BoxerAnim, BoxerAnimSpec> = {
  idle: { sheet: "FightIdle", frames: 34, speed: 0.3, loop: true },
  // `speed` here (playback rate) is unchanged — the fix for feet visibly
  // sliding against the ground was on the movement side: `PLAYER_SPEED`/
  // `ENEMY_SPEED` above were low enough relative to this cycle's own pace
  // (14 frames at 0.32 covers one loop in ~0.73s) that the body barely
  // advanced across a full stride, so the planted foot in each frame read as
  // slipping backward under it rather than pushing off the ground. Judged by
  // running a straight line and comparing a burst of frames spaced across
  // one loop: at the original 145px/s the character covered only ~106px per
  // 0.73s loop (well under a scaled sprite-width — legs cycling with barely
  // any ground gained); at the current speed it covers ~140px per loop
  // (confirmed by sampling `AnimationController.frame` against `Transform`
  // position through a full loop), and consecutive frames in a run now show
  // steady, proportional forward progress with no stall or flail.
  run: { sheet: "RunForward", frames: 14, speed: 0.32, loop: true },
  // Attack/telegraph speeds (attack1/2/3, chargeRelease, melee, cast) are
  // ~12% slower than a plain sprite-accurate playback rate — every hitbox/
  // telegraph/projectile window below is timed against these speeds, not
  // the sheet's native pace, so contact still lands on the visible extension
  // frame; re-derive both together if either changes.
  attack1: { sheet: "LeftJab", frames: 15, speed: 0.696, loop: false },
  attack2: { sheet: "RightJab", frames: 11, speed: 0.714, loop: false },
  // The combo finisher: a leaping flying kick (48 real frames — the whole
  // sheet bar one empty trailing cell) instead of a third punch, paired with
  // a real forward lunge (see `lungeMove`/`ATTACK_3`) so the drawn leap and
  // the body's actual travel read as one motion.
  attack3: { sheet: "FlyingKick", frames: 48, speed: 0.893, loop: false },
  // A single held frame (no block/parry animation in the pack) — same
  // one-frame-slice trick as `guard` below, from the Battlecry sheet's
  // opening coiled-fists stance.
  chargeHold: { sheet: "Battlecry", frames: 1, speed: 1, loop: false },
  chargeRelease: { sheet: "HighKick", frames: 33, speed: 0.554, loop: false },
  dash: { sheet: "ForwardRoll", frames: 16, speed: 0.85, loop: false },
  // The pack has no block/parry animation — freeze on Pull's first frame (a
  // braced, hands-up lean) as a stand-in guard/block pose, shared by both
  // the hold-block and the parry it can cancel into.
  guard: { sheet: "Pull", frames: 1, speed: 1, loop: false },
  // The pack has no item-use animation — NotUsed/ButtonPush (a calm forward
  // reach) stands in for drinking a potion.
  potion: { sheet: "ButtonPush", frames: 44, speed: 0.9, loop: false },
  // A run-up-and-kick sheet: the leading frames double as the melee's own
  // windup (knee rising into the coil), which is exactly the telegraph the
  // enemy AI needs — see `MELEE` below.
  melee: { sheet: "FrontKick", frames: 29, speed: 0.491, loop: false },
  // Speed is overridden per-hit at runtime (see `playStaggerAnim`) so the
  // reaction's wall-clock length tracks the landed hit's actual stun.
  stagger: { sheet: "HitBody", frames: 21, speed: 0.55, loop: false },
  death: { sheet: "Die1", frames: 65, speed: 0.65, loop: false },
  cast: { sheet: "Fireball", frames: 48, speed: 0.759, loop: false },
};

/** Full wall-clock length of the enemy's cast animation — used to keep the
 *  `shoot` ability's own duration (and so `Abilities.isActive("main")`)
 *  spanning the whole throw, not just the projectile's release instant. */
const CAST_DURATION =
  BOXER_ANIM_SPECS.cast.frames / (60 * BOXER_ANIM_SPECS.cast.speed);

/** Composite `AnimationController` key for one (animation, direction) pair. */
function boxerKey(anim: BoxerAnim, dir: number): string {
  return `${anim}_dir${dir}`;
}

const boxerSheetHandles = new Map<string, TextureHandle[]>();

/** The 8 per-direction texture handles for a sheet, built once and cached. */
function handlesFor(sheet: string): TextureHandle[] {
  let handles = boxerSheetHandles.get(sheet);
  if (!handles) {
    handles = Array.from({ length: DIR_COUNT }, (_, i) =>
      texture(`/assets/boxer/${sheet}_dir${i + 1}.png`),
    );
    boxerSheetHandles.set(sheet, handles);
  }
  return handles;
}

/** Every texture handle the boxer pack needs, for the scene's `preload`. */
const BOXER_PRELOAD = (Object.keys(BOXER_ANIM_SPECS) as BoxerAnim[]).flatMap(
  (anim) => handlesFor(BOXER_ANIM_SPECS[anim].sheet),
);

const boxerFrameCache = new Map<string, ReturnType<typeof sliceTextureFrames>>();

/** Sliced frame textures for one (animation, direction) pair, cached — assets
 *  must already be loaded (via `preload`) before this is called. */
function framesFor(anim: BoxerAnim, dir: number) {
  const key = boxerKey(anim, dir);
  let frames = boxerFrameCache.get(key);
  if (!frames) {
    const spec = BOXER_ANIM_SPECS[anim];
    const handle = handlesFor(spec.sheet)[dir - 1]!;
    frames = sliceTextureFrames(handle, {
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      count: spec.frames,
    });
    boxerFrameCache.set(key, frames);
  }
  return frames;
}

/** Builds the `AnimationController` defs for the given animation subset,
 *  one entry per (animation, direction) — a player needs 8 animations x 8
 *  directions, an enemy fewer. `AnimationController` has no direction axis
 *  of its own, so directions are folded into the key name. */
function buildBoxerAnimDefs(anims: readonly BoxerAnim[]): Record<string, AnimationDef> {
  const defs: Record<string, AnimationDef> = {};
  for (const anim of anims) {
    const spec = BOXER_ANIM_SPECS[anim];
    for (let dir = 1; dir <= DIR_COUNT; dir++) {
      defs[boxerKey(anim, dir)] = {
        frames: framesFor(anim, dir),
        speed: spec.speed,
        loop: spec.loop,
      };
    }
  }
  return defs;
}

const PLAYER_ANIMS: readonly BoxerAnim[] = [
  "idle",
  "run",
  "attack1",
  "attack2",
  "attack3",
  "chargeHold",
  "chargeRelease",
  "dash",
  "guard",
  "potion",
  "stagger",
  "death",
];
const ENEMY_ANIMS: readonly BoxerAnim[] = ["idle", "run", "cast", "melee", "stagger", "death"];

const SPRITE_SCALE = 0.6;

/** Fallback anchor at the sprite's torso/body center — row 66 of each 132px-
 *  tall frame (the frame's own geometric center; measured by grid-overlaying
 *  FightIdle/Pull/Battlecry/LeftJab across several directions: head top
 *  ~row 38, shoulders ~row 57, chest ~row 62-68, waist ~row 80). This is the
 *  Transform's world-position convention for every combatant: entity spawn
 *  coordinates, the body collider, and every ability's aim-rotated `offset`
 *  (hitbox/projectile spawn point) are all torso positions, not feet — see
 *  the `contactPoint`/`BODY_COLLIDER_RADIUS` doc for why a hit's *screen-height*
 *  alignment has to come from this convention rather than from a step
 *  parameter. Correct for animations whose feet don't move relative to the
 *  frame across their own play — every one-shot attack/dash/guard/potion/
 *  cast/death — where the drawn motion (a lunge, a roll, a windup) is the
 *  point and must not be cancelled.
 *
 *  Looping locomotion (idle, run) and the hit/stagger reaction instead get
 *  a per-frame anchor — see `FOOT_ANCHOR_PX`/`GROUND_OFFSET_ROWS`/
 *  `applyFootAnchor` below. Their feet genuinely shift within the frame
 *  across the loop (measured: idle ground-line varies ≤2px per direction,
 *  but run and stagger vary 4-11px vertically and 4.5-11.5px horizontally
 *  per direction), which is what a single static anchor can't plant — it
 *  can only be correct for whichever frame it was measured against.
 */
const SPRITE_ANCHOR = { x: 0.5, y: 0.5 };

/** Matches both combatants' `ColliderComponent` circle radius — shared so
 *  the contact-point approximation in `contactPoint` (see `reactToHit`)
 *  stays in sync with the actual collider size. The collider is centered on
 *  the Transform (no offset): the Transform origin already sits at
 *  `SPRITE_ANCHOR`'s torso row. */
const BODY_COLLIDER_RADIUS = 21;

const HP_BAR_WIDTH = 32;
const HP_BAR_HEIGHT = 5;
const HP_BAR_TOP = -34;

/**
 * GENERATED per-frame foot anchors for the three compensated animations
 * (idle/run/stagger — see `SPRITE_ANCHOR`'s doc for why only these three).
 * One `[groundRow, feetX]` pair per (direction, frame), in source frame px
 * on the 126x132 grid: `groundRow` is the bottom-most opaque pixel row of
 * that frame; `feetX` is the x-centroid of opaque pixels in the 14px band
 * just above it (the feet specifically, not the whole silhouette, so a
 * swinging arm doesn't drag the anchor sideways with it). Measured by
 * slicing each sheet at its real frame count and scanning per-pixel alpha
 * (threshold 10) over `examples/public/assets/boxer/{FightIdle,RunForward,
 * HitBody}_dir{1-8}.png`; regenerate the same way if those sheets change.
 * `applyFootAnchor` turns a `[groundRow, feetX]` pair into the frame's
 * `AnimatedSprite.anchor`, offset by `GROUND_OFFSET_ROWS` so the ground line
 * renders a fixed distance below the torso anchor instead of at it.
 */
const FOOT_ANCHOR_PX: Partial<
  Record<BoxerAnim, readonly (readonly [number, number])[][]>
> = {
  idle: [
    [[114,50], [114,49], [115,49], [115,48], [115,48], [115,48], [115,48], [114,49], [114,49], [114,49], [114,50], [113,50], [113,51], [113,51], [113,51], [113,50], [113,50], [113,50], [114,49], [114,49], [114,49], [114,49], [114,49], [114,49], [114,49], [114,49], [114,49], [114,50], [113,50], [113,50], [113,50], [113,50], [114,50], [114,50]], // dir1
    [[106,54], [106,53], [106,52], [106,52], [106,52], [106,52], [106,53], [106,53], [106,53], [106,54], [106,54], [106,55], [106,56], [106,56], [106,56], [106,55], [106,55], [106,54], [106,54], [106,54], [106,53], [106,53], [106,53], [106,53], [106,53], [106,54], [106,54], [106,54], [106,55], [106,55], [106,56], [106,55], [106,55], [106,54]], // dir2
    [[108,66], [107,65], [107,65], [107,65], [107,65], [107,65], [107,65], [107,65], [107,66], [107,66], [108,67], [108,68], [108,68], [108,68], [108,68], [108,68], [108,68], [108,67], [107,66], [107,66], [107,66], [107,66], [107,66], [107,66], [107,66], [107,66], [107,66], [108,67], [108,67], [108,68], [108,67], [108,67], [108,67], [108,67]], // dir3
    [[111,69], [110,69], [110,69], [110,69], [110,69], [110,69], [110,69], [110,69], [110,70], [111,69], [111,69], [111,70], [112,69], [112,69], [112,69], [111,70], [111,70], [111,70], [111,70], [110,70], [110,70], [110,70], [110,70], [110,70], [110,70], [110,70], [111,69], [111,70], [111,70], [111,70], [111,70], [111,70], [111,69], [111,69]], // dir4
    [[111,60], [111,60], [111,61], [111,61], [111,61], [111,61], [111,61], [111,60], [111,60], [111,60], [112,59], [112,59], [112,58], [112,58], [112,58], [112,58], [112,59], [112,59], [112,60], [111,60], [111,61], [111,61], [111,60], [111,60], [111,60], [111,60], [112,60], [112,59], [112,59], [112,59], [112,59], [112,59], [112,59], [112,59]], // dir5
    [[110,66], [110,67], [110,68], [110,68], [110,69], [110,69], [110,68], [110,68], [110,68], [110,67], [110,66], [110,65], [110,65], [110,64], [110,64], [110,65], [110,65], [110,66], [110,66], [110,67], [110,67], [110,67], [110,68], [110,68], [110,67], [110,67], [110,66], [110,66], [110,65], [110,65], [110,65], [110,65], [110,65], [110,66]], // dir6
    [[113,71], [114,72], [114,72], [114,72], [114,72], [114,72], [114,72], [114,72], [114,71], [114,71], [113,70], [113,70], [113,69], [113,69], [113,69], [113,69], [113,70], [113,69], [113,70], [114,71], [114,71], [114,71], [114,71], [114,71], [114,71], [114,71], [113,70], [113,70], [113,70], [113,70], [113,70], [113,70], [113,70], [113,70]], // dir7
    [[118,66], [118,66], [118,66], [119,66], [119,66], [119,66], [119,66], [118,66], [118,65], [118,65], [118,65], [117,65], [117,65], [117,65], [117,65], [117,65], [117,65], [117,65], [118,65], [118,65], [118,65], [118,65], [118,65], [118,65], [118,65], [118,65], [118,65], [117,65], [117,65], [117,65], [117,65], [117,65], [117,65], [117,66]], // dir8
  ],
  run: [
    [[104,73], [108,71], [110,66], [111,62], [111,63], [111,66], [109,70], [107,73], [105,71], [103,66], [102,65], [104,62], [103,66], [101,69]], // dir1
    [[109,73], [109,69], [108,62], [108,55], [109,55], [109,59], [109,64], [109,70], [109,74], [110,77], [109,75], [107,70], [106,72], [106,73]], // dir2
    [[111,71], [107,69], [107,69], [108,68], [106,67], [108,65], [110,65], [112,65], [112,66], [113,67], [114,70], [114,72], [113,71], [112,70]], // dir3
    [[112,64], [111,66], [113,69], [115,72], [114,70], [111,66], [110,65], [110,62], [110,60], [111,59], [113,56], [114,58], [113,60], [112,62]], // dir4
    [[112,56], [113,56], [114,54], [115,52], [114,53], [112,56], [112,58], [111,57], [108,58], [106,61], [107,60], [107,58], [109,58], [111,58]], // dir5
    [[109,49], [109,48], [109,50], [108,54], [106,55], [105,55], [107,54], [109,54], [110,56], [109,63], [109,67], [109,67], [109,62], [109,57]], // dir6
    [[104,50], [102,54], [104,59], [104,65], [105,68], [104,61], [102,57], [104,54], [108,54], [110,57], [111,60], [111,60], [110,56], [108,53]], // dir7
    [[99,62], [104,66], [108,72], [110,72], [110,72], [109,72], [106,72], [103,64], [104,60], [107,56], [108,52], [110,53], [107,54], [104,55]], // dir8
  ],
  stagger: [
    [[113,57], [112,57], [112,57], [111,55], [111,54], [110,54], [110,53], [110,52], [110,52], [111,51], [111,51], [111,53], [112,53], [112,54], [113,55], [113,56], [113,56], [113,57], [113,57], [113,57], [113,57]], // dir1
    [[109,56], [109,56], [108,57], [106,57], [105,56], [106,55], [106,56], [106,55], [106,55], [106,55], [106,55], [107,54], [108,54], [108,54], [109,54], [109,54], [109,54], [109,55], [109,55], [109,55], [109,55]], // dir2
    [[107,65], [107,66], [106,66], [104,67], [102,68], [103,69], [104,70], [104,70], [103,70], [104,69], [104,69], [104,68], [105,67], [105,66], [105,65], [106,65], [106,64], [106,64], [106,65], [106,65], [106,65]], // dir3
    [[112,72], [112,72], [112,73], [111,75], [111,77], [111,77], [112,79], [111,78], [111,79], [111,78], [111,77], [111,77], [111,75], [111,74], [111,74], [111,73], [111,72], [111,72], [111,72], [111,72], [111,72]], // dir4
    [[114,62], [114,62], [114,62], [115,64], [116,65], [116,65], [116,66], [116,67], [116,68], [116,67], [115,67], [115,66], [114,66], [114,65], [114,64], [113,64], [113,63], [113,63], [113,63], [113,63], [113,62]], // dir5
    [[113,59], [113,58], [113,59], [115,58], [115,58], [116,58], [116,59], [116,60], [116,60], [116,60], [116,60], [115,61], [114,61], [114,61], [114,60], [113,61], [113,61], [113,60], [113,60], [113,60], [113,59]], // dir6
    [[110,63], [110,63], [110,62], [111,61], [112,59], [112,58], [112,58], [113,58], [113,58], [113,60], [113,59], [112,60], [112,62], [112,62], [111,63], [111,64], [111,64], [111,64], [110,64], [110,64], [110,63]], // dir7
    [[114,69], [114,69], [114,68], [114,65], [114,64], [114,63], [114,62], [114,61], [115,62], [115,62], [115,63], [115,64], [115,66], [115,66], [115,67], [115,69], [115,69], [115,69], [115,70], [115,70], [115,70]], // dir8
  ],
};

/** Per-entity record of what's currently playing — `applyFootAnchor` (called
 *  from the `onFrameChange` hook `installFootAnchorTracking` installs) reads
 *  this to know which `FOOT_ANCHOR_PX` row a texture-array frame index
 *  belongs to; the frame index alone doesn't say which (anim, dir) it's
 *  from. Written by `playBoxerAnim`. */
const boxerAnimState = new WeakMap<Entity, { anim: BoxerAnim; dir: number }>();

/** Frame rows from the torso anchor (`SPRITE_ANCHOR`'s row 66) down to a
 *  typical ground-contact line — subtracted from each frame's own measured
 *  `groundRow` in `applyFootAnchor` below, so the torso (not the foot) stays
 *  this many rows above wherever the foot actually lands that frame. Keeps
 *  the same per-frame wobble compensation `FOOT_ANCHOR_PX` was measured for,
 *  just referenced from the torso row instead of the ground row itself. */
const GROUND_OFFSET_ROWS = 45;

/** Per-frame ground-plant compensation for idle/run/stagger, falling back to
 *  the static `SPRITE_ANCHOR` for every other animation (see its doc for the
 *  split). Sets the sprite's anchor to the currently-showing frame's own
 *  measured foot position offset by `GROUND_OFFSET_ROWS`, so the ground line
 *  renders a fixed distance below the torso anchor no matter which frame or
 *  direction is showing — a fixed offset, not the wobble across frames the
 *  table itself compensates for. */
function applyFootAnchor(entity: Entity, frame: number): void {
  const state = boxerAnimState.get(entity);
  const px = state && FOOT_ANCHOR_PX[state.anim]?.[state.dir - 1]?.[frame];
  const sprite = entity.get(AnimatedSpriteComponent).animatedSprite;
  if (px) {
    sprite.anchor.set(px[1] / FRAME_W, (px[0] - GROUND_OFFSET_ROWS) / FRAME_H);
  } else {
    sprite.anchor.set(SPRITE_ANCHOR.x, SPRITE_ANCHOR.y);
  }
}

/** Hooks `AnimatedSprite.onFrameChange` once so `applyFootAnchor` runs on
 *  every displayed frame, including a freshly-switched animation's first
 *  (Pixi fires `onFrameChange` synchronously when `AnimatedSprite.textures`
 *  is reassigned, which `AnimationController.play`/`playOneShot` does on
 *  every real animation switch). Call once per entity, after its
 *  `AnimatedSpriteComponent` is added. */
function installFootAnchorTracking(entity: Entity): void {
  entity.get(AnimatedSpriteComponent).animatedSprite.onFrameChange = (frame) =>
    applyFootAnchor(entity, frame);
}

/** Play a boxer animation on the entity's `AnimationController`, direction
 *  from its `Facing` (falling back to `DEFAULT_DIR` without one). Records
 *  the (anim, dir) pair in `boxerAnimState` for `applyFootAnchor` to read.
 *  `startFrame` jumps a one-shot past its own opening frames instead of
 *  always starting at 0 — `CHARGE_RELEASE` uses this to open onto the kick's
 *  windup already partway coiled, landing contact sooner without re-timing
 *  the whole clip. `lockDuration` overrides `AnimationController`'s own
 *  frames/speed-derived lock length to match, so `AnimationController.locked`
 *  clears in step with the shortened clip rather than the un-skipped one. */
function playBoxerAnim(
  entity: Entity,
  anim: BoxerAnim,
  options: { oneShot: boolean; startFrame?: number; lockDuration?: number },
): void {
  const facing = entity.tryGet(Facing);
  const dir = resolveSheetDir(anim, facing ? facingToDir(facing.unit) : DEFAULT_DIR);
  const state = boxerAnimState.get(entity);
  if (state) {
    state.anim = anim;
    state.dir = dir;
  } else {
    boxerAnimState.set(entity, { anim, dir });
  }
  const controller = entity.get(AnimationController);
  const key = boxerKey(anim, dir);
  if (options.oneShot) {
    controller.playOneShot(
      key,
      options.lockDuration !== undefined ? { duration: options.lockDuration } : undefined,
    );
    if (options.startFrame !== undefined) {
      entity.get(AnimatedSpriteComponent).animatedSprite.gotoAndPlay(options.startFrame);
    }
  } else {
    controller.play(key);
  }
}

/** Readable-frame-rate bounds for the stagger reaction — see `playStaggerAnim`. */
const STAGGER_SPEED_MIN = 0.32;
const STAGGER_SPEED_MAX = 0.7;

/** Plays the stagger reaction at whatever `AnimatedSprite.animationSpeed`
 *  makes its full playthrough take about as long as the hit's actual `stun`
 *  — mechanic and animation agree instead of the anim running on a fixed
 *  clock unrelated to how long the character is actually stunned for.
 *  Clamped to stay in a readable range regardless of how short or long a
 *  given hit's stun is (a very brief stun still gets a legible flinch; a
 *  long one doesn't turn into slow motion). Setting `animationSpeed`
 *  directly (rather than `AnimationController.speed`, which is shared by
 *  every animation on the controller) confines the override to this one
 *  play — the next `playOneShot`/`play` call recomputes it fresh. */
function playStaggerAnim(entity: Entity, stun: number): void {
  playBoxerAnim(entity, "stagger", { oneShot: true });
  const frames = BOXER_ANIM_SPECS.stagger.frames;
  const rawSpeed = frames / (60 * Math.max(stun, 0.05));
  const speed = Math.min(STAGGER_SPEED_MAX, Math.max(STAGGER_SPEED_MIN, rawSpeed));
  entity.get(AnimatedSpriteComponent).animatedSprite.animationSpeed = speed;
}

const FLASH_TINT = 0xff5a5a;
const FLASH_DURATION = 0.08;
const ATTACKER_FLASH_TINT = 0xffffff;
const ATTACKER_FLASH_DURATION = 0.06;

/** Coarse weight classes driving hitstop length, camera shake, the attacker
 *  flash, and impact-burst size — see `ABILITY_WEIGHTS`/`damageWeight`. */
type HitWeight = "light" | "medium" | "heavy";

/** Impact-burst particle count by the landed hit's raw damage — used on the
 *  *victim* side, where the only signal available is the hit itself (not
 *  which specific ability the attacker used). */
function damageWeight(damage: number): HitWeight {
  if (damage >= 25) return "heavy";
  if (damage >= 14) return "medium";
  return "light";
}

const IMPACT_BURST_COUNT: Record<HitWeight, number> = { light: 12, medium: 22, heavy: 38 };

/** Pale strobe marking invulnerability from any source — distinct from both
 *  combatants' base tints (pure white for the player, a pink cast for
 *  enemies) so it reads even against the player's already-white sprite,
 *  and from the red damage flash / cyan block flash it never overlaps with
 *  (see `runInvulnFlash`'s doc). */
const INVULN_FLASH_TINT = 0xeaffff;
const INVULN_FLASH_INTERVAL = 0.07;

/** Runs the invulnerability strobe on `entity`'s sprite for `duration`
 *  seconds, restoring `baseTint` when it ends — the post-hit i-frame half of
 *  the invulnerability flash (see `reactToHit`/`reactToBlockedHit`, which
 *  read `HitReceiver.iframesRemaining` for `duration`). The def-authored
 *  half (dash, the parry counter) is the `invulnFlash` window step below
 *  instead, since those durations are already timeline windows with their
 *  own `enter`/`tick`/`exit`. No-ops for a non-positive duration (a receiver
 *  with no i-frames configured). */
function runInvulnFlash(
  entity: Entity,
  pc: ProcessComponent,
  baseTint: number,
  duration: number,
): void {
  if (duration <= 0) return;
  const sprite = entity.get(AnimatedSpriteComponent).animatedSprite;
  pc.run(
    new Process({
      duration,
      update: (_dt, elapsed) => {
        const on = Math.floor(elapsed / INVULN_FLASH_INTERVAL) % 2 === 0;
        sprite.tint = on ? INVULN_FLASH_TINT : baseTint;
      },
      onComplete: () => {
        sprite.tint = baseTint;
      },
    }),
  );
}

/** Approximates the world-space impact point: the spot on the victim's
 *  body-collider circle facing wherever the hit came from. `Hit` carries no
 *  impact position of its own (see the friction log) — but `hit.direction`
 *  already IS the unit vector from that origin toward the victim, resolved
 *  at delivery time against the actual attacking collider's position (the
 *  hitbox's spawn point for a melee swing, the projectile's own position at
 *  contact for a projectile — not `hit.source`'s position, which for a
 *  projectile is the caster who fired it, long gone from the impact site).
 *  Walking back from the collider center by the radius along `-direction`
 *  lands on the struck side without ever needing the source entity's own
 *  position. */
function contactPoint(entity: Entity, hit: Hit): Vec2 {
  const bodyCenter = entity.get(Transform).worldPosition;
  return bodyCenter.sub(hit.direction.scale(BODY_COLLIDER_RADIUS));
}

/** Shared hit-reaction: the stagger pose, a brief tint flash back to
 *  `baseTint`, an impact particle burst sized by the hit's damage, and a hit
 *  thock — positioned at the struck side of the body (see `contactPoint`)
 *  rather than the entity's own anchor — all timed on the entity's own
 *  `ProcessComponent` (so the flash freezes along with everything else
 *  during hitstop rather than ticking through it). Used by both
 *  `PlayerController` and `EnemyAI`'s `HitReceived` listeners. */
function reactToHit(
  entity: Entity,
  pc: ProcessComponent,
  baseTint: number,
  hit: Hit,
): void {
  playStaggerAnim(entity, hit.data.stun ?? 0.2);
  const sprite = entity.get(AnimatedSpriteComponent).animatedSprite;
  sprite.tint = FLASH_TINT;
  pc.run(
    Process.delay(FLASH_DURATION, () => {
      sprite.tint = baseTint;
      // Hand off to the invulnerability strobe for whatever's left of the
      // i-frame window this hit just armed (read fresh here, after the red
      // flash's own delay, so the two never fight for the sprite's tint).
      runInvulnFlash(entity, pc, baseTint, entity.get(HitReceiver).iframesRemaining);
    }),
  );
  const weight = damageWeight(hit.data.damage ?? 0);
  fxOf(entity).impactBurst(contactPoint(entity, hit), IMPACT_BURST_COUNT[weight]);
  playHitSfx(entity);
}

/** Lighter counterpart to `reactToHit` for a hold-block's reduced hit (the
 *  `"modified"` guard verdict — see `GUARD_HOLD`): a brief cool-toned flash
 *  and a small burst instead of the full stagger-flinch animation, so
 *  absorbing a hit reads as "blocked calmly" rather than "hit" — the guard
 *  pose stays on screen throughout. Only `PlayerController` currently uses
 *  this (enemies never guard). */
const BLOCK_FLASH_TINT = 0x93f7ff;
const BLOCK_FLASH_DURATION = 0.06;
const BLOCK_BURST_COUNT = 8;

function reactToBlockedHit(
  entity: Entity,
  pc: ProcessComponent,
  baseTint: number,
  hit: Hit,
): void {
  const sprite = entity.get(AnimatedSpriteComponent).animatedSprite;
  sprite.tint = BLOCK_FLASH_TINT;
  pc.run(
    Process.delay(BLOCK_FLASH_DURATION, () => {
      sprite.tint = baseTint;
      // A hold-block's "modified" verdict still ends in a `"hit"` result
      // (see `GUARD_HOLD`), so `HitReceiver` still arms its post-hit
      // i-frames — same hand-off as `reactToHit`.
      runInvulnFlash(entity, pc, baseTint, entity.get(HitReceiver).iframesRemaining);
    }),
  );
  fxOf(entity).impactBurst(contactPoint(entity, hit), BLOCK_BURST_COUNT);
  playBlockSfx(entity);
}

/** A brief white flash on the attacker for a heavy landed hit — separate
 *  from the victim's red `reactToHit` flash, and skipped for light taps so
 *  a fast combo doesn't strobe. */
function flashAttacker(entity: Entity, pc: ProcessComponent, baseTint: number): void {
  const sprite = entity.get(AnimatedSpriteComponent).animatedSprite;
  sprite.tint = ATTACKER_FLASH_TINT;
  pc.run(
    Process.delay(ATTACKER_FLASH_DURATION, () => {
      sprite.tint = baseTint;
    }),
  );
}

// ---------------------------------------------------------------------------
// VFX hub — two scene-wide particle emitters (impact / charge-burst), shared
// by every combatant rather than one instance per entity: `burst()` takes
// explicit world coordinates, so a single emitter can fire at any position
// without tracking a sibling Transform. The player's own charge-hold visual
// is a hand-rolled converging effect on `PlayerController` instead (see
// `ChargeSpark` below) — the particle package's emitter config can't express
// it (see that section's doc comment) — so this hub's `charge` emitter is
// used only for `chargeBurst`'s one-shot bursts (the enemy melee/cast
// telegraph's "energy building" tell).
// ---------------------------------------------------------------------------

class VfxHub {
  constructor(
    private readonly impact: ParticleEmitterComponent,
    private readonly charge: ParticleEmitterComponent,
    private readonly parry: ParticleEmitterComponent,
  ) {}

  impactBurst(pos: Vec2, count: number): void {
    this.impact.burst(count, pos.x, pos.y);
  }

  /** The enemy melee/cast telegraph's periodic "energy building" bursts. */
  chargeBurst(pos: Vec2, count: number): void {
    this.charge.burst(count, pos.x, pos.y);
  }

  parrySpark(pos: Vec2): void {
    this.parry.burst(18, pos.x, pos.y);
  }
}

function createVfxHub(scene: Scene): VfxHub {
  const tex = scene.context.resolve(RendererKey).createTexture((g) => {
    g.circle(0, 0, 6).fill({ color: 0xffffff });
  });

  const impactEntity = scene.spawn("fx-impact");
  impactEntity.add(new Transform());
  const impact = impactEntity.add(
    new ParticleEmitterComponent({
      ...ParticlePresets.sparks(tex),
      tint: 0xffb454,
      maxParticles: 220,
      lifetime: [0.16, 0.32],
    }),
  );

  const chargeEntity = scene.spawn("fx-charge");
  chargeEntity.add(new Transform());
  const charge = chargeEntity.add(
    new ParticleEmitterComponent({
      ...ParticlePresets.fire(tex),
      tint: 0xffe066,
      maxParticles: 150,
      rate: 28,
    }),
  );

  const parryEntity = scene.spawn("fx-parry");
  parryEntity.add(new Transform());
  const parry = parryEntity.add(
    new ParticleEmitterComponent({
      ...ParticlePresets.sparks(tex),
      tint: 0x93f7ff,
      maxParticles: 60,
      lifetime: [0.15, 0.3],
      speed: [220, 380],
    }),
  );

  return new VfxHub(impact, charge, parry);
}

function fxOf(entity: Entity): VfxHub {
  return (entity.scene as AbilitiesDemoScene).fx;
}

function cameraOf(entity: Entity): CameraEntity {
  return (entity.scene as AbilitiesDemoScene).camera;
}

// ---------------------------------------------------------------------------
// Engagement token — at most one enemy "holds" it and is allowed to close to
// melee range / cast a fireball; every other `EnemyAI` orbits/strafes
// instead (see `EnemyAI.reposition`), so the player faces one clear threat
// at a time rather than every enemy converging at once. A scene-wide
// Component (spawned once in `onEnter`, alongside the VFX hub) rather than
// per-enemy state, since "who's engaging" is inherently a single shared
// answer. Auto-assigns to the living enemy nearest the player once free and
// past its handoff pause — `EnemyAI` never claims the token itself, only
// releases it.
// ---------------------------------------------------------------------------

class EngagementToken extends Component {
  private holder: Entity | null = null;
  private handoffPause = 0;

  hasToken(entity: Entity): boolean {
    return this.holder === entity;
  }

  /** True while the token is free but not yet reassigned — the beat
   *  between one enemy's attack recovering and the next one engaging.
   *  `EnemyAI.reposition` reads this to add a brief outward "backing off"
   *  push on top of the normal orbit. */
  get isHandoffPause(): boolean {
    return this.holder === null && this.handoffPause > 0;
  }

  /** Frees the token; `update` won't reassign it until `TOKEN_HANDOFF_PAUSE`
   *  seconds pass, so attacks don't chain back-to-back with no visible gap. */
  release(entity: Entity): void {
    if (this.holder !== entity) return;
    this.holder = null;
    this.handoffPause = TOKEN_HANDOFF_PAUSE;
  }

  /** Drops a dead/removed holder immediately, skipping the handoff pause —
   *  nothing is "recovering" from an attack a death already interrupted. */
  clear(entity: Entity): void {
    if (this.holder === entity) this.holder = null;
  }

  update(dt: number): void {
    if (this.handoffPause > 0) {
      this.handoffPause = Math.max(0, this.handoffPause - dt);
      return;
    }
    if (this.holder) return;
    const player = this.scene.findEntity("PlayerEntity");
    if (!player || (player.tryGet(Health)?.isDead ?? true)) return;
    const playerPos = player.get(Transform).worldPosition;

    let nearest: Entity | null = null;
    let nearestDist = Infinity;
    for (const entity of this.scene.getEntities()) {
      if (!entity.tags.has("enemy") || (entity.tryGet(Health)?.isDead ?? true)) continue;
      const dist = entity.get(Transform).worldPosition.sub(playerPos).length();
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = entity;
      }
    }
    this.holder = nearest;
  }
}

function tokenOf(entity: Entity): EngagementToken {
  return (entity.scene as AbilitiesDemoScene).token;
}

// ---------------------------------------------------------------------------
// SFX — three CC0 wavs (see `examples/public/assets/CREDITS.md`) doing the
// job of five cues: a hit thock (`hurt.wav`) on every landed/blocked hit, the
// same clip pitched up as a bright "ring" on a successful parry (no bespoke
// parry asset exists in the pack), a muted thud (`land.wav`) reused for a
// blocked hit's duller impact, and `explosion.wav` for a death beat.
// ---------------------------------------------------------------------------

const HitSfx = sound("/assets/hurt.wav");
const BlockSfx = sound("/assets/land.wav");
const DeathSfx = sound("/assets/explosion.wav");

function playHitSfx(entity: Entity, options?: { speed?: number; volume?: number }): void {
  entity.scene.context
    .resolve(AudioManagerKey)
    .play(HitSfx.path, { channel: "sfx", speed: options?.speed ?? 1, volume: options?.volume ?? 0.7 });
}

function playBlockSfx(entity: Entity): void {
  entity.scene.context
    .resolve(AudioManagerKey)
    .play(BlockSfx.path, { channel: "sfx", volume: 0.5 });
}

function playDeathSfx(entity: Entity): void {
  entity.scene.context
    .resolve(AudioManagerKey)
    .play(DeathSfx.path, { channel: "sfx", volume: 0.55 });
}

// ---------------------------------------------------------------------------
// Game-defined steps — the extension mechanism `defineStep` is meant for.
// None of these belong in the addon: dashing is movement, healing is an
// item, sprite animation is a presentation choice the addon can't see, and
// the enemy windup tell is bespoke game feel.
// ---------------------------------------------------------------------------

/** Entities with a step currently owning their body's velocity — `dashMove`
 *  (the dash roll), `lungeMove` (the combo finisher's forward kick), and
 *  `punchMove` (the jabs' forward step) all add themselves for their
 *  window's life. Read by `PlayerController`'s movement-gate damping (see
 *  its `update`) so it stops fighting these steps' own velocity writes
 *  instead of guessing from the active ability id, which would also have to
 *  know about every future velocity-owning step. */
const velocityOwnedByStep = new Set<Entity>();

/** Builds a step that owns the body's velocity for its window, in the
 *  caster's `Facing`, at a fixed speed — the mechanism shared by `dashMove`
 *  (the dash roll), `lungeMove` (the combo finisher's forward kick), and
 *  `punchMove` (the jabs' forward step). */
function velocityStep(kind: string) {
  return defineStep<{ speed: number }>(kind, {
    enter(params, ctx) {
      velocityOwnedByStep.add(ctx.entity);
      const facing = ctx.entity.get(Facing);
      ctx.entity.get(RigidBodyComponent).setVelocity(facing.unit.scale(params.speed));
    },
    exit(_params, ctx) {
      velocityOwnedByStep.delete(ctx.entity);
      ctx.entity.get(RigidBodyComponent).setVelocity(Vec2.ZERO);
    },
  });
}

const dashMove = velocityStep("dashMove");
/** A forward lunge — the finisher's leaping kick (`ATTACK_3`) and the
 *  charge release's kick-drive (`CHARGE_RELEASE`) both ride this same step
 *  kind at their own speed/window. */
const lungeMove = velocityStep("lungeMove");
/** The 1-2 combo jabs' forward step — see `ATTACK_1`/`ATTACK_2`. */
const punchMove = velocityStep("punchMove");

/** A point step: restore HP through the sibling `Health`. */
const heal = defineStep<{ amount: number }>("heal", {
  fire(params, ctx) {
    ctx.entity.get(Health).heal(params.amount);
  },
});

/** Point step: plays a one-shot boxer animation, direction-aware. The
 *  sibling `AnimationController` (built by `buildBoxerAnimDefs`) must
 *  include `name` for every direction. `startFrame`/`lockDuration` are the
 *  windup-skip escape hatch `CHARGE_RELEASE` uses — see `playBoxerAnim`. */
const spriteAnim = defineStep<{ name: BoxerAnim; startFrame?: number; lockDuration?: number }>(
  "spriteAnim",
  {
    fire(params, ctx) {
      playBoxerAnim(ctx.entity, params.name, {
        oneShot: true,
        ...(params.startFrame !== undefined ? { startFrame: params.startFrame } : {}),
        ...(params.lockDuration !== undefined ? { lockDuration: params.lockDuration } : {}),
      });
    },
  },
);

/** Window step: holds a boxer animation (its first frame, for the one-frame
 *  `guard`/`chargeHold` stand-ins) for the window's duration. Used where an
 *  ability needs a sustained pose rather than a one-shot. */
const spriteHold = defineStep<{ name: BoxerAnim }>("spriteHold", {
  enter(params, ctx) {
    playBoxerAnim(ctx.entity, params.name, { oneShot: false });
  },
});

const TELEGRAPH_TINT = 0xfff2a8;

/** Window step spanning an enemy attack's windup: tints the sprite a
 *  warning color for the whole span (restored to `baseTint` on exit) and
 *  bursts "charging" particles on enter and every `every` tick — the
 *  player's visual cue to dash or guard before the attack goes active. */
const telegraph = defineStep<{ baseTint: number; burstCount?: number }>("telegraph", {
  enter(params, ctx) {
    ctx.entity.get(AnimatedSpriteComponent).animatedSprite.tint = TELEGRAPH_TINT;
    fxOf(ctx.entity).chargeBurst(ctx.entity.get(Transform).worldPosition, params.burstCount ?? 10);
  },
  tick(params, ctx) {
    fxOf(ctx.entity).chargeBurst(
      ctx.entity.get(Transform).worldPosition,
      Math.round((params.burstCount ?? 10) / 2),
    );
  },
  exit(params, ctx) {
    ctx.entity.get(AnimatedSpriteComponent).animatedSprite.tint = params.baseTint;
  },
});

/** Per-entity strobe phase for `invulnFlash` below — a plain boolean toggled
 *  each tick, the same WeakMap-per-entity-state shape as `boxerAnimState`. */
const invulnFlashOn = new WeakMap<Entity, boolean>();

/** Window step: strobes the sprite between `baseTint` and the pale
 *  `INVULN_FLASH_TINT` for its span. Paired at the *same* `from`/`to` as an
 *  `invulnerable` window on the same def (`DASH`, `COUNTER`) so a
 *  def-authored invulnerability window is visually legible, not just
 *  mechanical — `runInvulnFlash` above is the post-hit i-frame twin, whose
 *  duration isn't a timeline window so it can't use `enter`/`tick`/`exit`. */
const invulnFlash = defineStep<{ baseTint: number }>("invulnFlash", {
  enter(_params, ctx) {
    invulnFlashOn.set(ctx.entity, true);
    ctx.entity.get(AnimatedSpriteComponent).animatedSprite.tint = INVULN_FLASH_TINT;
  },
  tick(params, ctx) {
    const on = !(invulnFlashOn.get(ctx.entity) ?? false);
    invulnFlashOn.set(ctx.entity, on);
    ctx.entity.get(AnimatedSpriteComponent).animatedSprite.tint = on
      ? INVULN_FLASH_TINT
      : params.baseTint;
  },
  exit(params, ctx) {
    invulnFlashOn.delete(ctx.entity);
    ctx.entity.get(AnimatedSpriteComponent).animatedSprite.tint = params.baseTint;
  },
});

// ---------------------------------------------------------------------------
// Ability defs — every timeline below is windup → active → recovery:
// `duration` extends past the last hitbox/effect window so committing to an
// attack leaves the lane busy (and the caster exposed) for a beat after the
// damage window closes, not just until it does. Hitbox/telegraph windows are
// timed against the ~12%-slowed attack speeds in `BOXER_ANIM_SPECS` above, so
// contact still lands on the visible extension frame.
//
// `SUPER_ARMOR_PRIORITY` (above the built-in stagger reaction's own
// `REACTION_PRIORITY`) marks every player attack def below as uninterruptible
// once committed: a landed hit still deals damage, but `HitReceiver`'s
// reaction step forcing the stagger reaction onto this def's lane is refused
// (lower priority), so neither the flinch nor the knockback ramp it carries
// ever starts. The enemy's `melee`/`shoot` carry no `priority` at all
// (default 0, below `REACTION_PRIORITY`) — a landed hit always interrupts a
// telegraphed swing, punishing the tell instead of just chipping through it.
// See `07-reactions.md`'s evidence note for the diagnosis that led here: the
// two were symmetric until a playtest pass found enemy attacks never
// flinching or losing ground even when hit mid-telegraph.
// ---------------------------------------------------------------------------

const SUPER_ARMOR_PRIORITY = REACTION_PRIORITY + 10;

/** 1-2-3 combo, stage 1: a quick opening jab. Chained/buffered by the
 *  hand-rolled combo state machine in `PlayerController` — see the section
 *  below `PlayerController.updateCombat`. LeftJab's one-shot at this speed
 *  runs ~0.36s; the hitbox sits on the punch's extension and recovery
 *  stretches ~0.2s past it. `punchMove` rides the same window as the hitbox
 *  — a step into the punch, ~31px, so the jab reads as weight thrown forward
 *  rather than a stationary arm swing. */
const ATTACK_1: AbilityDef = {
  id: "attack1",
  priority: SUPER_ARMOR_PRIORITY,
  duration: 0.448,
  timeline: [
    spriteAnim({ at: 0, name: "attack1" }),
    punchMove({ from: 0.123, to: 0.246, speed: 250 }),
    hitbox({
      from: 0.123,
      to: 0.246,
      shape: { type: "capsule", halfHeight: 24, radius: 14, axis: "x" },
      offset: { x: 39, y: 0 },
      hit: { damage: 10, knockback: 240, stun: 0.16 },
    }),
  ],
};

/** Combo stage 2: a faster follow-up cross. RightJab's shorter one-shot
 *  (~0.26s) lands its contact frame earlier; recovery still runs ~0.19s
 *  past it. `punchMove`'s window is narrower than stage 1's (the cross's
 *  hitbox window is itself narrower) at a higher speed, landing a
 *  comparable ~28px step. */
const ATTACK_2: AbilityDef = {
  id: "attack2",
  priority: SUPER_ARMOR_PRIORITY,
  duration: 0.358,
  timeline: [
    spriteAnim({ at: 0, name: "attack2" }),
    punchMove({ from: 0.078, to: 0.168, speed: 310 }),
    hitbox({
      from: 0.078,
      to: 0.168,
      shape: { type: "capsule", halfHeight: 24, radius: 14, axis: "x" },
      offset: { x: 37, y: 0 },
      hit: { damage: 12, knockback: 265, stun: 0.18 },
    }),
  ],
};

/** Combo finisher: a leaping flying kick that always resets the chain,
 *  whether it was reached by chaining or by the post-swing window (see
 *  `PlayerController.updateCombat`). Also the parry counter's sprite — see
 *  `COUNTER` below, which plays the same animation with different numbers
 *  and a shorter recovery (and no lunge — a point-blank counter has nowhere
 *  to travel to). `lungeMove` rides the FlyingKick sheet's own airborne
 *  extension (measured apex around frame 24 of 48, i.e. ~0.45s in at this
 *  speed): it opens partway through the leap so the kick is already
 *  carrying the body forward by the time the hitbox opens on top of it. The
 *  speed is tuned against a colliding target, not free space — a body-to-body
 *  collision with the struck target eats a big chunk of the requested
 *  velocity, so covering 90-120px on landing (measured at collider-contact
 *  distances from a tight clinch to `ENEMY_MELEE_RANGE`) takes ~820px/s,
 *  which covers ~180px if nothing is in the way. This is a one-shot attack,
 *  exempt from the per-frame foot compensation in `FOOT_ANCHOR_PX` — the
 *  leap's own in-frame motion is the point. The finisher's own recovery
 *  (~0.2s past the animation's natural end) is the longest of the three
 *  combo stages — the commitment move. `hitbox`'s `follow: true` re-anchors
 *  the sensor to the caster's position every frame through the whole active
 *  window — the lunge is still accelerating when the window opens, so a
 *  fire-time-snapshot hitbox lands short of where the kick visually
 *  connects. */
const ATTACK_3: AbilityDef = {
  id: "attack3",
  priority: SUPER_ARMOR_PRIORITY,
  duration: 1.12,
  timeline: [
    spriteAnim({ at: 0, name: "attack3" }),
    lungeMove({ from: 0.32, to: 0.54, speed: 820 }),
    hitbox({
      from: 0.403,
      to: 0.515,
      shape: { type: "capsule", halfHeight: 26, radius: 16, axis: "x" },
      offset: { x: 46, y: 0 },
      follow: true,
      hit: { damage: 26, knockback: 530, stun: 0.45 },
    }),
  ],
};

/** Charge windup: an indefinite hold — `chargeHold`'s single-frame sprite
 *  sits until `PlayerController` closes the window with `abilities.cancel()`
 *  on key-up. The large `to` is the addon's own documented workaround for a
 *  window step with no natural duration (see the friction log). Force-only:
 *  never registered by id, only ever `force()`d. */
const CHARGE_HOLD: AbilityDef = {
  id: "chargeHold",
  timeline: [spriteHold({ from: 0, to: 999, name: "chargeHold" })],
};

/** The heavy attack a completed charge releases: a bigger hitbox, more
 *  damage, and a longer stun/knockback than any combo stage, plus the
 *  longest recovery in the kit (~0.41s past the hit). Force-only, fired by
 *  `PlayerController` on key-up once the hold threshold is met.
 *
 *  The hold itself (`CHARGE_HOLD`, held for the ≥500ms `CHARGE_HOLD_MS`
 *  threshold before this fires) already reads as the windup, so this
 *  shouldn't wind up a second time — `spriteAnim`'s `startFrame: 6` opens
 *  HighKick already 6 frames into its own coil (~0.18s of the sheet's real
 *  frames at this speed) instead of at frame 0, and `hitbox.from`/`to` are
 *  shifted back by the same amount so contact still lands on the same
 *  visual extension frame it always did — just ~0.18s after release instead
 *  of ~0.38s (measured end-to-end from a real keyup event to the hit
 *  landing: ~0.19-0.22s, the extra few ms being real dispatch/physics-step
 *  latency on top of the timeline's own 0.18s). `lockDuration` matches the
 *  trimmed total below so `AnimationController.locked` clears on schedule
 *  instead of holding for the un-skipped clip's full length. The active
 *  window's own width and the recovery tail after it (`duration - to`) are
 *  both unchanged from before. `lungeMove` covers the kick's drive
 *  (starting a touch before the hitbox opens, closing a touch after it does)
 *  so the heavy release closes distance instead of landing on a
 *  stationary-legged kick — ~72px in free space at this speed (measured
 *  frozen-clock: `Transform` before/after with `scene.timeScale` at 0 and
 *  single `Process` ticks), less against a colliding target the same way
 *  `ATTACK_3`'s lunge is. `hitbox`'s `follow: true` keeps the sensor over
 *  the caster through that same travel, matching `ATTACK_3`. */
const CHARGE_RELEASE: AbilityDef = {
  id: "chargeRelease",
  priority: SUPER_ARMOR_PRIORITY,
  duration: 0.751,
  timeline: [
    spriteAnim({ at: 0, name: "chargeRelease", startFrame: 6, lockDuration: 0.751 }),
    lungeMove({ from: 0.08, to: 0.32, speed: 300 }),
    hitbox({
      from: 0.18,
      to: 0.337,
      shape: { type: "capsule", halfHeight: 34, radius: 24, axis: "x" },
      offset: { x: 60, y: 0 },
      follow: true,
      hit: { damage: 32, knockback: 645, stun: 0.55 },
    }),
  ],
};

/** Fast punish thrown by `PlayerController.counterattack` on a successful
 *  parry against a target within melee reach. `priority` clears both the
 *  still-open `parry` window's default 0 (so forcing this from `HitGuarded`
 *  — emitted mid-fold, before the guard step's own `exit` — is what actually
 *  closes the parry pose out) and the stagger reaction's `REACTION_PRIORITY`,
 *  so the counter itself commits like any other attack. Snappier than the
 *  plain finisher (shorter windup and recovery) — it's a reward hit, not a
 *  committed swing. Force-only. Rides the same (now ~12%-slower) `attack3`
 *  sprite as the finisher, so its own window is scaled the same way.
 *  `invulnerable` covers the counter start-to-active-end (the same
 *  def-authored pattern `DASH` uses), paired with `invulnFlash` at the same
 *  `from`/`to` so a second enemy landing a hit mid-counter is visibly
 *  no-sold instead of only mechanically ignored. */
const COUNTER: AbilityDef = {
  id: "counter",
  priority: SUPER_ARMOR_PRIORITY,
  duration: 0.381,
  timeline: [
    spriteAnim({ at: 0, name: "attack3" }),
    invulnerable({ from: 0, to: 0.213 }),
    invulnFlash({ from: 0, to: 0.213, every: INVULN_FLASH_INTERVAL, baseTint: PLAYER_TINT }),
    hitbox({
      from: 0.101,
      to: 0.213,
      shape: { type: "capsule", halfHeight: 26, radius: 16, axis: "x" },
      offset: { x: 42, y: 0 },
      hit: { damage: 16, knockback: 420, stun: 0.35 },
    }),
  ],
};

const DASH: AbilityDef = {
  id: "dash",
  cooldown: 1.15,
  duration: 0.36,
  timeline: [
    spriteAnim({ at: 0, name: "dash" }),
    // A brief 0.03s startup before the roll (and its invulnerability) takes
    // over — dash still reads as fast, but doesn't erase input-to-motion
    // entirely — and a ~0.12s landing recovery afterward, so the roll can't
    // be chained frame-perfectly into the next action. `invulnFlash` pairs
    // the same window with a visible pale strobe (see its doc).
    invulnerable({ from: 0.03, to: 0.24 }),
    invulnFlash({ from: 0.03, to: 0.24, every: INVULN_FLASH_INTERVAL, baseTint: PLAYER_TINT }),
    dashMove({ from: 0.03, to: 0.24, speed: 480 }),
  ],
};

/** Hold-block: starts the instant the guard key is pressed and stays open
 *  for as long as it's held (the same large-`to`-plus-`cancel()`-on-release
 *  pattern `CHARGE_HOLD` uses) — nothing in this def ever forces a
 *  higher-priority activation onto the lane, so the window stays open across
 *  as many hits as land while the key is down. `policy` reduces every landed
 *  hit in place rather than negating it: damage and knockback both survive
 *  at a fraction, and stun is zeroed so a blocked hit never triggers the
 *  stagger reaction. No `punish` — see `PARRY` below for the tap-release
 *  counter-punishing window this cancels into. `PlayerController.updateGuard`
 *  owns the press/hold/release state machine. */
const GUARD_HOLD_ID = "guardHold";
const BLOCK_DAMAGE_MULT = 0.3;
const BLOCK_KNOCKBACK_MULT = 0.4;
const blockPolicy: GuardPolicy = (hit) => {
  hit.data.damage = (hit.data.damage ?? 0) * BLOCK_DAMAGE_MULT;
  hit.data.knockback = (hit.data.knockback ?? 0) * BLOCK_KNOCKBACK_MULT;
  hit.data.stun = 0;
  return "modified";
};
const GUARD_HOLD: AbilityDef = {
  id: GUARD_HOLD_ID,
  cooldown: 0.4,
  timeline: [
    spriteHold({ from: 0, to: 999, name: "guard" }),
    guard({ from: 0, to: 999, outcome: "blocked", policy: blockPolicy }),
  ],
};

/** Parry: what a hold-block cancels into on a quick release (see
 *  `PARRY_TAP_WINDOW`/`PlayerController.updateGuard`) — a window where any
 *  landed hit is negated and punished back at the attacker (see
 *  `HitReceiver`'s guard resolution). `PlayerController` layers a
 *  hand-rolled counterattack/reflect on top via `HitGuarded` — see `COUNTER`
 *  above and `counterattack` below; this punish (chip damage back through
 *  the guard) stays as-is alongside it. Costlier than the hold-block's own
 *  cooldown — the negate-and-punish payoff is the higher-risk, higher-reward
 *  half of the split. Widened from an original 0.22s active window (and a
 *  1.1s cooldown) to 0.35s/0.85s after a playtest pass found the original
 *  frame-perfect against a telegraphed hit — see `06-guard-resolution.md`'s
 *  2026-07-12 tuning note. */
const PARRY_ID = "parry";
const PARRY_ACTIVE_WINDOW = 0.35;
const PARRY: AbilityDef = {
  id: PARRY_ID,
  cooldown: 0.85,
  duration: 0.44,
  timeline: [
    spriteHold({ from: 0, to: PARRY_ACTIVE_WINDOW, name: "guard" }),
    guard({
      from: 0,
      to: PARRY_ACTIVE_WINDOW,
      outcome: "parried",
      policy: () => "negate",
      punish: { damage: 10, knockback: 335, stun: 0.45 },
    }),
  ],
};

/** Item-lane: plays concurrently with whatever the main lane is doing
 *  (attacking, dashing, even stunned) — that's the point of the lane. The
 *  explicit duration roughly matches the drink animation's own length. */
const POTION: AbilityDef = {
  id: "potion",
  lane: "item",
  cooldown: 5,
  duration: 0.85,
  timeline: [heal({ at: 0, amount: 30 }), spriteAnim({ at: 0, name: "potion" })],
};

/** Enemy melee: `FrontKick`'s own run-up-and-kick cycle doubles as the
 *  windup — the `telegraph` step covers the run-in and knee-raise (the
 *  coil), ending right as the hitbox opens on the leg's extension.
 *  Recovery runs well past the kick landing (~0.64s), leaving a clearly
 *  punishable enemy on a whiff or a parry. No `priority` (default 0, below
 *  `REACTION_PRIORITY`): unlike the player's own attacks, a landed hit
 *  always interrupts this — punishing the telegraph stops the kick outright
 *  instead of only trading damage for damage (see the ability-defs section
 *  doc above). Cooldown raised from 1.3s alongside the engagement-token
 *  handoff pause (`TOKEN_HANDOFF_PAUSE`) to slow the overall attack rate —
 *  see `EnemyAI`. */
const MELEE: AbilityDef = {
  id: "melee",
  cooldown: 1.6,
  duration: 1.176,
  timeline: [
    spriteAnim({ at: 0, name: "melee" }),
    telegraph({ from: 0, to: 0.437, every: 0.168, baseTint: ENEMY_TINT, burstCount: 8 }),
    hitbox({
      from: 0.437,
      to: 0.538,
      shape: { type: "capsule", halfHeight: 24, radius: 15, axis: "x" },
      offset: { x: 48, y: 0 },
      hit: { damage: 12, knockback: 280, stun: 0.35 },
    }),
  ],
};

class FireballProjectile extends Projectile {
  override setup(context: AbilitySpawnContext<ProjectileConfig>): void {
    super.setup(context);
    this.add(
      new GraphicsComponent().draw((graphics) => {
        graphics.circle(0, 0, 7).fill({ color: 0xfb923c });
        graphics.circle(0, 0, 3.5).fill({ color: 0xfde68a });
      }),
    );
  }
}

/** Ranged enemy attack: `aim` is an explicit fire-time resolver — the other
 *  half of the aim vocabulary (the player instead omits `aim` and falls
 *  back to its `Facing`). The explicit `duration` spans the whole cast
 *  animation, not just the projectile's release instant, so
 *  `Abilities.isActive("main")` stays true (and `EnemyAI` stays planted,
 *  holding the throwing pose) through the follow-through — see `EnemyAI`.
 *  The `telegraph` step covers the whole hold, ending exactly as the
 *  projectile fires. `spawn`'s `at` is timed to the Fireball sheet's
 *  own release frame (the arm snapping down past the shoulder, ~0.83 of the
 *  way through the windup-spin-throw cycle at this speed). No `priority`,
 *  same as `MELEE` — a landed hit cancels the cast before it releases. */
const SHOOT: AbilityDef = {
  id: "shoot",
  cooldown: 2,
  duration: CAST_DURATION,
  timeline: [
    spriteAnim({ at: 0, name: "cast" }),
    telegraph({ from: 0, to: 0.874, every: 0.213, baseTint: ENEMY_TINT, burstCount: 7 }),
    spawn({
      at: 0.874,
      entity: FireballProjectile,
      params: {
        speed: 240,
        lifetime: 2.5,
        shape: { type: "circle", radius: 7 },
      },
      aim: (ctx) => {
        const from = ctx.entity.get(Transform).worldPosition;
        const player = ctx.entity.scene.findEntity("PlayerEntity");
        return player ? player.get(Transform).worldPosition.sub(from) : Vec2.RIGHT;
      },
      hit: { damage: 10, knockback: 180, stun: 0.3 },
    }),
  ],
};

/** The four player abilities that occupy the `"main"` lane, keyed by id —
 *  used by `PlayerController.attackSlotState` to read the shared attack/
 *  charge hotbar slot's own progress off the active def's `duration`,
 *  since no single `cooldownRemaining(id)` covers all four. */
const PLAYER_MAIN_DEFS: Readonly<Record<string, AbilityDef>> = {
  attack1: ATTACK_1,
  attack2: ATTACK_2,
  attack3: ATTACK_3,
  chargeRelease: CHARGE_RELEASE,
  counter: COUNTER,
};

/** Ability id -> feedback weight, read off the *attacker's* own active def
 *  (`Abilities.activeId("main")` at hit time) — drives hitstop length,
 *  camera shake, and whether the attacker itself flashes. Ids with no entry
 *  (the enemy's `melee`/`shoot`) default to `"light"`, since only the
 *  player currently gets attacker-side feedback on landing a hit. */
const ABILITY_WEIGHTS: Partial<Record<string, HitWeight>> = {
  attack1: "light",
  attack2: "light",
  attack3: "heavy",
  chargeRelease: "heavy",
  counter: "medium",
};

function weightFor(abilities: Abilities): HitWeight {
  const id = abilities.activeId("main");
  return (id ? ABILITY_WEIGHTS[id] : undefined) ?? "light";
}

const HITSTOP_BY_WEIGHT: Record<HitWeight, number> = { light: 0.05, medium: 0.08, heavy: 0.12 };
const SHAKE_BY_WEIGHT: Record<"medium" | "heavy", { intensity: number; duration: number }> = {
  medium: { intensity: 5, duration: 0.12 },
  heavy: { intensity: 9, duration: 0.18 },
};

// ---------------------------------------------------------------------------
// Combat log — a scene-wide listener on the addon's own events, so the HUD
// never pokes at component internals to know what happened.
// ---------------------------------------------------------------------------

function label(entity: Entity): string {
  return entity.tags.has("player") ? "Player" : "Enemy";
}

class CombatLog extends Component {
  private lines: string[] = [];

  onAdd(): void {
    this.listenScene(HealthDamaged, ({ amount }, entity) => {
      if (entity) this.push(`${label(entity)} took ${amount} dmg`);
    });
    this.listenScene(HealthHealed, ({ amount }, entity) => {
      if (entity) this.push(`${label(entity)} healed ${amount}`);
    });
    this.listenScene(HealthDied, (_data, entity) => {
      if (entity) this.push(`${label(entity)} died`);
    });
    this.listenScene(HitGuarded, ({ outcome }, entity) => {
      if (entity) this.push(`${label(entity)} ${outcome} an attack`);
    });
  }

  private push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > 3) this.lines.shift();
  }

  get text(): string {
    return this.lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Shared HP bar
// ---------------------------------------------------------------------------

function drawHealthBar(gfx: GraphicsComponent, hpFrac: number, color: number): void {
  const frac = Math.max(0, hpFrac);
  gfx.graphics
    .clear()
    .rect(-HP_BAR_WIDTH / 2, HP_BAR_TOP, HP_BAR_WIDTH, HP_BAR_HEIGHT)
    .fill({ color: 0x1e293b })
    .rect(-HP_BAR_WIDTH / 2, HP_BAR_TOP, HP_BAR_WIDTH * frac, HP_BAR_HEIGHT)
    .fill({ color });
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/** 1-2-3 combo stages, in order — ids match the `AbilityDef`s above. */
const COMBO_STAGES = ["attack1", "attack2", "attack3"] as const;
const COMBO_STAGE_IDS: ReadonlySet<string> = new Set(COMBO_STAGES);

/** The attacks a buffered dash may cancel out of — the three combo stages
 *  plus the charge release (not `counter`: a parry reward hit is already
 *  short and snappy, and cancelling a punish felt like it undercut the
 *  reward). See `PlayerController.updateCombat`'s dash-buffer handling. */
const DASH_CANCELLABLE_IDS: ReadonlySet<string> = new Set([
  ...COMBO_STAGES,
  "chargeRelease",
]);

/** The point in `def`'s timeline (seconds from ability start) after which a
 *  buffered dash may cancel it — the moment its last `hitbox` window closes,
 *  so the cancel always lands after the hit and skips only the recovery
 *  tail. Scans the timeline instead of a hardcoded table so it stays correct
 *  whenever an attack's hitbox window is re-timed (see the ability defs
 *  above). Falls back to 0 (immediately cancellable) for a def with no
 *  hitbox step. */
function activeCloseTime(def: AbilityDef): number {
  let close = 0;
  for (const step of def.timeline as readonly AbilityStep[]) {
    if (step.kind === "hitbox" && "to" in step) close = Math.max(close, step.to);
  }
  return close;
}

/** Seconds after a non-finisher stage lands to accept the next press before
 *  the chain resets to stage 1. A touch more forgiving than the combo's
 *  original tuning — the ~12% slower attack animations (see
 *  `BOXER_ANIM_SPECS`) stretch the whole combo's pace, and this window
 *  didn't scale with them the way in-swing timings did. */
const COMBO_WINDOW = 0.6;
/** Milliseconds the attack key must be held before it's a charge rather
 *  than a tap. */
const CHARGE_HOLD_MS = 500;
/** Player melee reach for the parry counter — comfortably past contact
 *  range but short of the enemy's ranged stand-off distance, so a parried
 *  touch hit counters in melee and a parried fireball (whose source is far
 *  away) reflects instead. */
const MELEE_COUNTER_RANGE = 90;
const REFLECT_DAMAGE = 14;
const REFLECT_KNOCKBACK = 280;
const REFLECT_STUN = 0.3;
const REFLECT_SPEED = 260;

/** Seconds: releasing the guard key at or before this elapsed hold time
 *  cancels the hold-block into a parry (see `PlayerController.updateGuard`
 *  and `GUARD_HOLD`/`PARRY` above) — a tap, not a hold. Widened from 0.25s
 *  alongside `PARRY_ACTIVE_WINDOW` — see its doc. */
const PARRY_TAP_WINDOW = 0.3;

// ---------------------------------------------------------------------------
// Charge convergence sparks — a hand-rolled few-particle effect on
// `PlayerController` (Graphics, not `@yagejs/particles`): a fixed count of
// points on a ring around the caster's body center, each ticking its own
// radius down to 0 and alpha with it, then respawning at the ring edge with
// a fresh random angle. `@yagejs/particles`' `EmitterConfig` (see its
// `types.ts`) draws `spawnOffset` (position) and `angle`/`speed` (velocity)
// from independent random ranges per particle — there is no way to correlate
// a particle's spawn position with its travel direction, so "start on a ring,
// travel inward toward the ring's own center" cannot be expressed by the
// package's config at all, built-in or preset. Hand-rolling a handful of
// Graphics-drawn points sidesteps the gap entirely; see the evidence note in
// `09-feedback.md` for the fuller writeup.
// ---------------------------------------------------------------------------

interface ChargeSpark {
  angle: number;
  radius: number;
}

const CHARGE_SPARK_COUNT = 10;
const CHARGE_SPARK_RING_RADIUS = 42;
const CHARGE_SPARK_INWARD_SPEED = 110; // px/s
const CHARGE_SPARK_ALPHA = 0.35; // dimmer than the old rising-ember stream
const CHARGE_SPARK_COLOR = 0xffe066;

function spawnChargeSpark(): ChargeSpark {
  return { angle: Math.random() * Math.PI * 2, radius: CHARGE_SPARK_RING_RADIUS };
}

class PlayerController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly processes = this.service(ProcessSystemKey);
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly facing = this.sibling(Facing);
  private readonly abilities = this.sibling(Abilities);
  private readonly anim = this.sibling(AnimationController);
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly health = this.sibling(Health);
  private readonly pc = this.sibling(ProcessComponent);
  private readonly stagger = this.sibling(Stagger);
  dead = false;

  // Hand-rolled combo/charge state — read by the hotbar, otherwise private
  // to `updateCombat` below.
  comboStage = 0; // 0 = no chain memory; 1-3 = last landed stage
  charging = false;
  private comboWindow = 0; // seconds left to chain before resetting to stage 1
  private attackBuffered = false; // a press landed while the current swing was still in flight
  private dashBuffered = false; // dash pressed mid-attack; fires the instant the active window closes
  private wasComboSwinging = false; // last frame's "a combo stage specifically is running", to edge-detect a swing ending
  private chargeSparks: ChargeSpark[] = [];
  // Attack tap-vs-hold tracking — see `updateCombat`'s attack-input section.
  private attackPending = false; // attack is held, not yet resolved into a tap or a charge
  private attackPendingStartedBusy = false; // whether the main lane was busy at the moment this press began — a mid-swing press can never become a charge

  // Hand-rolled guard/parry press/hold/release state — see `updateGuard`.
  private guardHeld = false;
  private guardHoldElapsed = 0; // seconds since the guard key went down, while held

  onAdd(): void {
    this.listen(this.entity, HealthDied, () => {
      this.dead = true;
      if (this.charging) {
        this.charging = false;
        this.stopChargeSparks();
      }
      this.attackPending = false;
      this.guardHeld = false;
      this.rb.setVelocity(Vec2.ZERO);
      this.rb.setEnabledTranslations(false, false); // corpse: physics can't push it
      playBoxerAnim(this.entity, "death", { oneShot: true });
      cameraOf(this.entity).shake(9, 0.22, { decay: 0.75 });
      playDeathSfx(this.entity);
    });
    this.listen(this.entity, HitReceived, (hit) => {
      if (this.dead) return;
      // The hold-block's `"modified"` guard verdict ends in `"hit"` (see
      // `GUARD_HOLD`), so `HitReceived` fires for a blocked hit too — read
      // whether the hold is still the active def to route it to the lighter
      // reaction instead of a full stagger-flinch.
      if (this.abilities.activeId("main") === GUARD_HOLD_ID) {
        reactToBlockedHit(this.entity, this.pc, PLAYER_TINT, hit);
      } else {
        reactToHit(this.entity, this.pc, PLAYER_TINT, hit);
      }
    });
    this.listen(this.entity, HitDealt, ({ result, target }) => {
      if (result !== "hit") return;
      const weight = weightFor(this.abilities);
      this.triggerHitstop(target, HITSTOP_BY_WEIGHT[weight]);
      if (weight !== "light") {
        flashAttacker(this.entity, this.pc, PLAYER_TINT);
        const shake = SHAKE_BY_WEIGHT[weight];
        cameraOf(this.entity).shake(shake.intensity, shake.duration, { decay: 0.85 });
      }
    });
    this.listen(this.entity, HitGuarded, ({ hit, outcome }) => {
      if (outcome !== "parried") return;
      fxOf(this.entity).parrySpark(this.entity.get(Transform).worldPosition);
      cameraOf(this.entity).shake(5, 0.12, { decay: 0.85 });
      // No bespoke "parry ring" asset exists in the pack — the hit thock
      // pitched up reads as a bright, distinct chime instead (see the SFX
      // section's doc comment).
      playHitSfx(this.entity, { speed: 1.8, volume: 0.55 });
      this.counterattack(hit.source);
    });
  }

  update(dt: number): void {
    if (this.input.isJustPressed("reset")) {
      this.resetDemo();
      return;
    }
    if (this.dead) {
      this.redraw();
      return;
    }

    this.updateCombat(dt);
    this.updateGuard(dt);

    if (!this.abilities.isActive("main")) {
      const dx = this.input.getAxis("left", "right");
      const dy = this.input.getAxis("up", "down");
      const moving = dx !== 0 || dy !== 0;
      if (moving) {
        this.facing.set(dx, dy);
        this.rb.setVelocity(new Vec2(dx, dy).normalize().scale(PLAYER_SPEED));
      } else {
        this.rb.setVelocity(Vec2.ZERO);
      }
      if (!this.anim.locked) {
        playBoxerAnim(this.entity, moving ? "run" : "idle", { oneShot: false });
      }

      if (this.input.isJustPressed("dash")) this.abilities.play("dash");
    } else if (!velocityOwnedByStep.has(this.entity) && !this.stagger.active) {
      // Movement is gated by an ability (attack/guard/charge/counter) with
      // no movement step of its own — a hard stop instead of coasting on
      // whatever WASD velocity was live when the ability started. Skipped
      // while `dashMove`/`lungeMove` or `Stagger`'s knockback ramp owns the
      // body's velocity themselves.
      this.rb.setVelocity(Vec2.ZERO);
    }
    // The potion is on its own lane — usable even mid-action or mid-stagger.
    if (this.input.isJustPressed("potion")) this.abilities.play("potion");

    this.redraw();
  }

  /** Tears down and rebuilds the whole scene from scratch — a fresh
   *  `AbilitiesDemoScene` instance re-spawns the arena, camera, VfxHub,
   *  combatants, and HUD from `onEnter`, so nothing needs manual cleanup
   *  beyond what `SceneManager.replace` already guarantees (old scene
   *  `onExit` + every entity destroyed before the new scene enters). */
  private resetDemo(): void {
    engine.scenes.replace(new AbilitiesDemoScene()).catch(() => {});
  }

  /** Hotbar read for the shared attack/charge slot: it has no single
   *  `cooldownRemaining` id to poll (four ids share it — the three combo
   *  stages plus the charge release, and the parry counter besides), so
   *  it's driven off the currently-active def's own elapsed time against
   *  its `duration` instead. Idle (or holding a def not in
   *  `PLAYER_MAIN_DEFS`, e.g. `dash`/`guardHold`/`parry` occupying the same
   *  lane) reads as ready. */
  attackSlotState(): { ratio: number; label: string } {
    if (this.charging) return { ratio: 0, label: "HOLD" };
    const id = this.abilities.activeId("main");
    const def = id ? PLAYER_MAIN_DEFS[id] : undefined;
    if (!def) return { ratio: 1, label: "0.0" };
    const elapsed = this.abilities.elapsed("main") ?? 0;
    const duration = def.duration ?? 0;
    if (duration <= 0) return { ratio: 1, label: "0.0" };
    const ratio = Math.min(1, elapsed / duration);
    return { ratio, label: Math.max(0, duration - elapsed).toFixed(1) };
  }

  // -------------------------------------------------------------------------
  // 1-2-3 combo + charge attack — hand-rolled game logic layered on top of
  // `Abilities.play`/`force`/`cancel`. The addon has no chain, tap-vs-hold,
  // or input-buffering concept by design (a pending queue item, see the
  // friction log) — everything below is plain game-state-machine code, not
  // an addon feature. The buffered dash-cancel below is the same shape as
  // the attack buffer, one section down.
  //
  // Attack is release-triggered, the same tap-vs-hold shape `updateGuard`
  // uses for guard/parry: a press never fires anything by itself, only
  // `attackPending`. Releasing before the charge threshold resolves the tap
  // (fire now if the lane is free, buffer it otherwise); crossing the
  // threshold while still held enters the charge — no punch is ever thrown
  // before a charge. `attackPendingStartedBusy` (latched at press time) is
  // the "no leading punch" rule's other half: a press that began mid-swing
  // can never resolve into a charge, no matter how long it's held or
  // whether the swing frees up before release — charging only initiates
  // from a neutral (not-yet-busy) press. This keeps the rule simple: the
  // alternative (letting a mid-swing hold convert once the lane frees up)
  // would make a charge's start time depend on when an unrelated swing
  // happens to end, which reads as unpredictable rather than a clean tap.
  // -------------------------------------------------------------------------

  private updateCombat(dt: number): void {
    if (this.charging) {
      this.updateChargeSparks(dt);
      if (!this.input.isPressed("attack")) {
        this.charging = false;
        this.stopChargeSparks();
        this.abilities.cancel("main"); // closes the indefinite chargeHold window
        this.resampleFacing();
        this.abilities.force(CHARGE_RELEASE);
        this.resetCombo();
      }
      return;
    }

    // `mainBusy` gates new input generically (can't start an attack/charge
    // over anything else on the lane); `comboSwinging` is narrower — true
    // only while one of MY OWN combo stages is the active def. The window/
    // reset bookkeeping below must key off the latter: `abilities.isActive`
    // alone doesn't distinguish a combo stage from a dash, a guard, or a
    // forced stagger reaction sharing the same lane, so using it for the
    // "did a swing just end" edge would let dashing or getting hit
    // reopen (or silently advance) the combo chain.
    const activeId = this.abilities.activeId("main");
    const mainBusy = activeId !== null;
    const comboSwinging = activeId !== null && COMBO_STAGE_IDS.has(activeId);

    if (this.input.isJustPressed("attack")) {
      this.attackPending = true;
      this.attackPendingStartedBusy = mainBusy;
    } else if (this.attackPending) {
      if (this.input.isJustReleased("attack")) {
        // Resolved as a tap: fire now if the lane is free (idle, or within
        // the post-swing combo window), buffer it otherwise — same
        // buffer-vs-fire split the old press-triggered code used, just
        // evaluated at release instead of press.
        this.attackPending = false;
        if (mainBusy) this.attackBuffered = true;
        else this.playComboStage();
      } else if (
        !this.attackPendingStartedBusy &&
        !mainBusy &&
        this.input.isHeldFor("attack", CHARGE_HOLD_MS)
      ) {
        this.attackPending = false;
        this.charging = true;
        this.startChargeSparks();
        this.abilities.force(CHARGE_HOLD);
        return;
      }
    }

    // Buffered dash-cancel: a dash press mid-attack (windup/active/recovery)
    // queues instead of dropping, and fires the instant the attack's own
    // hitbox window closes — see `activeCloseTime`/`DASH_CANCELLABLE_IDS`
    // above — never mid-hit, cancelling whatever recovery is left. Dropped
    // (not fired) if something else takes the lane first (e.g. a forced
    // stagger — super armor already keeps that from happening to a landed
    // hit, but the buffer must not misfire against an unrelated activation
    // either way). Wins over a buffered next combo stage, cleared below.
    // `resampleFacing` right before the dash plays means it rolls in
    // whatever direction is held at that instant — holding back through a
    // combo with a dash buffered fires the roll backward, not forward.
    if (
      this.input.isJustPressed("dash") &&
      activeId !== null &&
      DASH_CANCELLABLE_IDS.has(activeId)
    ) {
      this.dashBuffered = true;
    }
    if (this.dashBuffered) {
      if (activeId === null || !DASH_CANCELLABLE_IDS.has(activeId)) {
        this.dashBuffered = false;
      } else if (
        (this.abilities.elapsed("main") ?? 0) >= activeCloseTime(PLAYER_MAIN_DEFS[activeId]!)
      ) {
        this.dashBuffered = false;
        this.attackBuffered = false; // dash buffer wins over a buffered next combo stage
        this.resetCombo();
        this.abilities.cancel("main");
        this.resampleFacing();
        this.abilities.play("dash");
        this.wasComboSwinging = false;
        return;
      }
    }

    if (!comboSwinging && this.wasComboSwinging && this.comboStage >= COMBO_STAGES.length) {
      this.resetCombo(); // the finisher always resets, buffered press included
    } else if (!mainBusy && this.attackBuffered) {
      this.attackBuffered = false;
      this.playComboStage();
    } else if (!comboSwinging && this.wasComboSwinging && this.comboStage > 0) {
      this.comboWindow = COMBO_WINDOW; // a non-finisher combo stage just ended: open the chain window
    } else if (!mainBusy && this.comboWindow > 0) {
      this.comboWindow = Math.max(0, this.comboWindow - dt);
      if (this.comboWindow === 0) this.resetCombo();
    }
    this.wasComboSwinging = comboSwinging;
  }

  // -------------------------------------------------------------------------
  // Charge convergence sparks — see the `ChargeSpark`/`CHARGE_SPARK_*`
  // section above for why this is hand-rolled Graphics rather than a
  // `@yagejs/particles` emitter. Ticked from `updateCombat` while charging,
  // drawn from `redraw` alongside the HP bar (one entity, one
  // `GraphicsComponent` — see the codebase's one-component-per-class rule).
  // -------------------------------------------------------------------------

  private startChargeSparks(): void {
    this.chargeSparks = Array.from({ length: CHARGE_SPARK_COUNT }, spawnChargeSpark);
  }

  private stopChargeSparks(): void {
    this.chargeSparks = [];
  }

  private updateChargeSparks(dt: number): void {
    for (let i = 0; i < this.chargeSparks.length; i++) {
      const spark = this.chargeSparks[i]!;
      spark.radius -= CHARGE_SPARK_INWARD_SPEED * dt;
      if (spark.radius <= 2) this.chargeSparks[i] = spawnChargeSpark();
    }
  }

  private drawChargeSparks(): void {
    // Drawn in the entity's local space, which is already centered on the
    // body (the Transform origin is the torso — see `SPRITE_ANCHOR`).
    for (const spark of this.chargeSparks) {
      const x = Math.cos(spark.angle) * spark.radius;
      const y = Math.sin(spark.angle) * spark.radius;
      const alpha = CHARGE_SPARK_ALPHA * (spark.radius / CHARGE_SPARK_RING_RADIUS);
      this.gfx.graphics.circle(x, y, 3).fill({ color: CHARGE_SPARK_COLOR, alpha });
    }
  }

  // -------------------------------------------------------------------------
  // Guard/parry — hand-rolled press/hold/release state machine, the same
  // hold-until-release shape `updateCombat`'s charge branch uses. Pressing
  // guard starts `GUARD_HOLD` immediately, open for as long as the key stays
  // down; releasing at or before `PARRY_TAP_WINDOW` cancels the hold into
  // `PARRY` instead of letting it run — a tap parries, a hold blocks, a long
  // hold never parries. See `06-guard-resolution.md`'s evidence note for why
  // the split (rather than the old single `guard` def) is what actually
  // fixes multi-hit blocking.
  // -------------------------------------------------------------------------

  private updateGuard(dt: number): void {
    if (this.guardHeld) {
      if (this.abilities.activeId("main") !== GUARD_HOLD_ID) {
        // Something else already ended the hold (e.g. death) — nothing left
        // to release.
        this.guardHeld = false;
        return;
      }
      this.guardHoldElapsed += dt;
      if (this.input.isJustReleased("guard")) {
        this.guardHeld = false;
        this.abilities.cancel("main"); // closes the indefinite guardHold window
        if (this.guardHoldElapsed <= PARRY_TAP_WINDOW) {
          this.resampleFacing();
          this.abilities.play(PARRY_ID);
        }
      }
      return;
    }
    if (!this.abilities.isActive("main") && this.input.isJustPressed("guard")) {
      if (this.abilities.play(GUARD_HOLD_ID).ok) {
        this.guardHeld = true;
        this.guardHoldElapsed = 0;
      }
    }
  }

  private playComboStage(): void {
    this.resampleFacing();
    const next = this.comboStage >= COMBO_STAGES.length ? 1 : this.comboStage + 1;
    if (this.abilities.play(COMBO_STAGES[next - 1]!).ok) {
      this.comboStage = next;
      this.comboWindow = 0;
    }
  }

  /** Re-aims Facing to the currently-held movement axis, if any — called at
   *  every action boundary (a combo stage firing, a buffered dash executing,
   *  a charge releasing, a parry starting) so a queued or buffered action
   *  picks up whatever direction is held the instant it actually starts,
   *  rather than whatever was held when the chain began or the buffer was
   *  set. Reads the raw input axis instead of `Facing.unit` because these
   *  boundaries can fire from `updateCombat`/`updateGuard`, which both run
   *  before `update`'s own WASD-driven Facing refresh this frame. `Facing.set`
   *  no-ops on a zero vector, so nothing held leaves Facing wherever it
   *  already points — mid-action framing (frozen while movement stays
   *  gated) is otherwise unaffected. */
  private resampleFacing(): void {
    this.facing.set(this.input.getAxis("left", "right"), this.input.getAxis("up", "down"));
  }

  private resetCombo(): void {
    this.comboStage = 0;
    this.comboWindow = 0;
    this.attackBuffered = false;
  }

  // -------------------------------------------------------------------------
  // Parry counter — hand-rolled: a successful parry either punches an
  // in-reach attacker or reflects a distant one's own projectile back at it.
  // -------------------------------------------------------------------------

  private counterattack(source: Entity): void {
    if (source.isDestroyed || (source.tryGet(Health)?.isDead ?? false)) return;
    const sourcePos = source.tryGet(Transform)?.worldPosition;
    if (!sourcePos) return;
    const myPos = this.entity.get(Transform).worldPosition;
    const toSource = sourcePos.sub(myPos);
    const dist = toSource.length();
    if (dist <= 0) return;
    if (dist <= MELEE_COUNTER_RANGE) {
      this.facing.set(toSource.x, toSource.y);
      this.abilities.force(COUNTER);
    } else {
      this.reflectProjectile(toSource.normalize());
    }
  }

  private reflectProjectile(direction: Vec2): void {
    const from = this.entity.get(Transform).worldPosition;
    const team = this.entity.get(HitReceiver).team;
    const delivery = createReportingDelivery({
      source: this.entity,
      data: { damage: REFLECT_DAMAGE, knockback: REFLECT_KNOCKBACK, stun: REFLECT_STUN },
      ...(team !== undefined ? { team } : {}),
    });
    this.scene.spawn(FireballProjectile, {
      caster: this.entity,
      aim: direction,
      position: from,
      delivery,
      params: {
        speed: REFLECT_SPEED,
        shape: { type: "circle", radius: 7 },
        lifetime: 2.5,
      },
      ...(team !== undefined ? { team } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // Hitstop — hand-rolled: `scene.timeScale = 0` freezes physics and every
  // component's scaled `update(dt)` engine-wide, but does NOT freeze sprite
  // playback (PixiJS `AnimatedSprite` ticks off `Ticker.shared`, independent
  // of scene timeScale), and does NOT provide an unfreeze timer of its own —
  // a timer driven by a scene-scoped `ProcessComponent` would freeze right
  // alongside everything else and never fire. The engine-global
  // `ProcessSystem` pool (`ProcessSystemKey`) is the documented escape
  // hatch: it ticks on raw, unscaled engine time regardless of any scene's
  // timeScale (the same mechanism `SceneTransition`/`LoadingScene` use for
  // their own real-time timers), so it's what restores `timeScale` here.
  // Duration scales with the landed ability's weight — see `weightFor`.
  // -------------------------------------------------------------------------

  private triggerHitstop(victim: Entity, duration: number): void {
    if (this.scene.timeScale === 0) return; // already mid-hitstop
    const victimSprite = victim.tryGet(AnimatedSpriteComponent)?.animatedSprite;
    const attackerSprite = this.entity.tryGet(AnimatedSpriteComponent)?.animatedSprite;
    victimSprite?.stop();
    attackerSprite?.stop();
    const scene = this.scene;
    scene.timeScale = 0;
    this.processes.add(
      Process.delay(duration, () => {
        scene.timeScale = 1;
        victimSprite?.play();
        attackerSprite?.play();
      }),
    );
  }

  /** HP bar plus the charge-hold convergence sparks while charging — the
   *  sprite animation itself conveys guard/dash/stun/dead. */
  private redraw(): void {
    drawHealthBar(this.gfx, this.health.hp / this.health.max, 0x4ade80);
    if (this.charging) this.drawChargeSparks();
  }
}

@trait(Hittable)
class PlayerEntity extends Entity {
  receiveHit(hit: Hit): HitResult {
    return this.get(HitReceiver).receive(hit);
  }

  setup(): void {
    this.tags.add("player");
    const transform = this.add(
      new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }),
    );
    transform.setScale(SPRITE_SCALE, SPRITE_SCALE);
    this.add(
      new AnimatedSpriteComponent({
        textures: framesFor("idle", DEFAULT_DIR),
        anchor: SPRITE_ANCHOR,
      }),
    );
    installFootAnchorTracking(this);
    this.add(new AnimationController(buildBoxerAnimDefs(PLAYER_ANIMS)));
    this.add(new GraphicsComponent());
    this.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: BODY_COLLIDER_RADIUS },
      }),
    );
    this.add(new ProcessComponent());
    this.add(new Facing());
    this.add(new Health({ max: 100 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "player", iframes: 0.25 }));
    this.add(
      new Abilities([ATTACK_1, ATTACK_2, ATTACK_3, DASH, GUARD_HOLD, PARRY, POTION]),
    );
    this.add(new PlayerController());
  }
}

// ---------------------------------------------------------------------------
// Enemy
// ---------------------------------------------------------------------------

class EnemyAI extends Component {
  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly transform = this.sibling(Transform);
  private readonly facing = this.sibling(Facing);
  private readonly abilities = this.sibling(Abilities);
  private readonly anim = this.sibling(AnimationController);
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly health = this.sibling(Health);
  private readonly pc = this.sibling(ProcessComponent);
  private readonly stagger = this.sibling(Stagger);

  // Orbit phase for non-token repositioning — randomized per enemy so
  // circlers spread around the player instead of stacking on one spot.
  private readonly orbitDir = Math.random() < 0.5 ? 1 : -1;

  // Edge-detects "my own melee/shoot just ended" to release the engagement
  // token the instant it recovers — the same isActive("main") transition
  // shape `PlayerController.updateCombat` uses for its combo window.
  private wasEngaging = false;

  onAdd(): void {
    this.listen(this.entity, HealthDied, () => this.die());
    this.listen(this.entity, HitReceived, (hit) => reactToHit(this.entity, this.pc, ENEMY_TINT, hit));
  }

  update(): void {
    const token = tokenOf(this.entity);
    const holdsToken = token.hasToken(this.entity);
    const mainBusy = this.abilities.isActive("main");

    if (this.wasEngaging && !mainBusy) token.release(this.entity);
    this.wasEngaging = holdsToken && mainBusy;

    const player = this.scene.findEntity("PlayerEntity");
    const playerDead = player?.tryGet(Health)?.isDead ?? true;
    if (!player || playerDead || mainBusy) {
      // No target, or mid-cast/melee/stagger: plant and let the current
      // animation (idle, or the locked one-shot) play out — this is what
      // keeps an attack pose held through its whole windup/recovery instead
      // of the movement logic below snapping it back to run/idle mid-attack.
      // Mid-cast/melee/stagger also needs to actively zero any velocity the
      // movement logic left behind (otherwise the enemy keeps sliding in its
      // last direction through the whole windup) — except while `Stagger`'s
      // own knockback ramp owns velocity.
      if (mainBusy) {
        if (!this.stagger.active) this.rb.setVelocity(Vec2.ZERO);
      } else {
        this.rb.setVelocity(Vec2.ZERO);
        if (!this.anim.locked) playBoxerAnim(this.entity, "idle", { oneShot: false });
      }
      this.redraw();
      return;
    }

    const toPlayer = player.get(Transform).worldPosition.sub(this.transform.worldPosition);
    const dist = toPlayer.length();
    this.facing.set(toPlayer.x, toPlayer.y);

    let moving: boolean;
    if (holdsToken) {
      moving = this.engage(toPlayer, dist);
    } else {
      moving = this.reposition(token, toPlayer, dist);
    }

    if (!this.anim.locked) {
      playBoxerAnim(this.entity, moving ? "run" : "idle", { oneShot: false });
    }

    this.redraw();
  }

  /** The token holder's behavior — unchanged from before the engagement
   *  token existed: close to melee range, hold at mid-range to close in, or
   *  hang back and cast. Returns whether it moved (for the run/idle pick). */
  private engage(toPlayer: Vec2, dist: number): boolean {
    if (dist <= ENEMY_MELEE_RANGE) {
      this.rb.setVelocity(Vec2.ZERO);
      this.abilities.play("melee"); // no-ops (stands its ground) while on cooldown
      return false;
    }
    if (dist <= ENEMY_FAR_RANGE) {
      this.rb.setVelocity(toPlayer.normalize().scale(ENEMY_SPEED));
      return true;
    }
    this.rb.setVelocity(Vec2.ZERO);
    this.abilities.play("shoot");
    return false;
  }

  /** Non-token behavior: orbit/strafe the player within `ORBIT_MIN_RANGE`..
   *  `ORBIT_MAX_RANGE`, separating from other enemies so circlers don't
   *  stack, and stepping back a bit further during the token's handoff
   *  pause (the beat right after the current attacker recovers). Returns
   *  whether it moved. */
  private reposition(token: EngagementToken, toPlayer: Vec2, dist: number): boolean {
    const inward = toPlayer.normalize(); // unit vector toward the player
    const tangent = new Vec2(-inward.y, inward.x).scale(this.orbitDir);

    const backoff = token.isHandoffPause ? ORBIT_BACKOFF_RANGE : 0;
    let radial = Vec2.ZERO;
    if (dist < ORBIT_MIN_RANGE + backoff) radial = inward.scale(-1);
    else if (dist > ORBIT_MAX_RANGE + backoff) radial = inward;

    let separation = Vec2.ZERO;
    for (const other of this.scene.getEntities()) {
      if (other === this.entity || !other.tags.has("enemy")) continue;
      const otherPos = other.tryGet(Transform)?.worldPosition;
      if (!otherPos) continue;
      const away = this.transform.worldPosition.sub(otherPos);
      const away2 = away.length();
      if (away2 > 0 && away2 < ORBIT_SEPARATION_RANGE) {
        separation = separation.add(away.scale((ORBIT_SEPARATION_RANGE - away2) / away2));
      }
    }

    const dir = tangent.scale(0.7).add(radial.scale(0.7)).add(separation.scale(0.05));
    if (dir.lengthSq() <= 0) {
      this.rb.setVelocity(Vec2.ZERO);
      return false;
    }
    this.rb.setVelocity(dir.normalize().scale(ENEMY_SPEED * ORBIT_SPEED_MULT));
    return true;
  }

  /** Corpse choreography: play death, stop dealing/taking pushback, and
   *  detach the AI component entirely rather than gating it on a flag —
   *  `entity.remove` is safe to call on the component's own currently-
   *  running listener (`Entity.emit` iterates a snapshot). No API exists to
   *  change a `RigidBodyComponent`'s body type at runtime, so "static" is
   *  approximated by zeroing velocity and locking translation — physics can
   *  no longer push the corpse around. */
  private die(): void {
    tokenOf(this.entity).clear(this.entity);
    playBoxerAnim(this.entity, "death", { oneShot: true });
    this.rb.setVelocity(Vec2.ZERO);
    this.rb.setEnabledTranslations(false, false);
    this.gfx.graphics.clear(); // no HP bar on a corpse
    this.entity.remove(EnemyAI);
    cameraOf(this.entity).shake(8, 0.2, { decay: 0.8 });
    playDeathSfx(this.entity);
  }

  private redraw(): void {
    drawHealthBar(this.gfx, this.health.hp / this.health.max, ENEMY_TINT);
  }
}

@trait(Hittable)
class EnemyEntity extends Entity {
  receiveHit(hit: Hit): HitResult {
    return this.get(HitReceiver).receive(hit);
  }

  setup(params: { position: Vec2Like }): void {
    this.tags.add("enemy");
    const transform = this.add(
      new Transform({ position: new Vec2(params.position.x, params.position.y) }),
    );
    transform.setScale(SPRITE_SCALE, SPRITE_SCALE);
    this.add(
      new AnimatedSpriteComponent({
        textures: framesFor("idle", DEFAULT_DIR),
        anchor: SPRITE_ANCHOR,
        // Tinted so the same sheets read as a distinct combatant.
        tint: ENEMY_TINT,
      }),
    );
    installFootAnchorTracking(this);
    this.add(new AnimationController(buildBoxerAnimDefs(ENEMY_ANIMS)));
    this.add(new GraphicsComponent());
    this.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: BODY_COLLIDER_RADIUS },
      }),
    );
    this.add(new ProcessComponent());
    this.add(new Facing());
    this.add(new Health({ max: 50 }));
    this.add(new Stagger());
    this.add(new HitReceiver({ team: "enemy", iframes: 0.15 }));
    this.add(new Abilities([SHOOT, MELEE]));
    this.add(new EnemyAI());
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

class Hud extends Component {
  private readonly log: CombatLog;
  private readonly text: TextComponent;

  constructor(text: TextComponent, log: CombatLog) {
    super();
    this.text = text;
    this.log = log;
  }

  update(): void {
    const player = this.scene.findEntity("PlayerEntity");
    const health = player?.tryGet(Health);
    this.text.setText(
      [
        `HP ${health ? Math.ceil(health.hp) : 0} / ${health?.max ?? 0}`,
        "WASD/arrows move · Space attack (hold to charge) · Shift dash (buffers mid-attack) ·",
        "F hold to block, tap to parry · Q potion · H hitbox debug · R reset",
        "",
        this.log.text,
      ].join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// Hotbar — a bottom-center row of 4 slots (attack/combo+charge, dash,
// guard, potion), each a rounded square with a key label, an ability name,
// and a clock-wipe: a semi-opaque pie overlay that shrinks via an arc sweep
// as the ability comes off cooldown, plus the remaining seconds as `X.X`
// text ("0.0" at ready).
// ---------------------------------------------------------------------------

type HotbarKind = "attack" | "dash" | "guard" | "potion";

interface HotbarSlotDef {
  kind: HotbarKind;
  key: string;
  name: string;
}

const HOTBAR_SLOTS: readonly HotbarSlotDef[] = [
  { kind: "attack", key: "SPACE", name: "ATTACK" },
  { kind: "dash", key: "SHIFT", name: "DASH" },
  { kind: "guard", key: "F", name: "BLOCK" },
  { kind: "potion", key: "Q", name: "POTION" },
];

const HOTBAR_SLOT_SIZE = 58;
const HOTBAR_GAP = 10;
const HOTBAR_RADIUS = HOTBAR_SLOT_SIZE / 2 - 4;

/** Ability id the hotbar polls cooldown for, keyed by slot kind (the
 *  "attack" slot is special-cased through `attackSlotState` instead — see
 *  `HotbarSlot.update`). The "guard" slot shows the hold-block's own
 *  cooldown — `GUARD_HOLD_ID`, not the literal kind string — since that's
 *  the actual gate on whether pressing the key does anything; the parry it
 *  can cancel into shares the same press and isn't shown separately. */
const HOTBAR_COOLDOWN_ID: Record<Exclude<HotbarKind, "attack">, string> = {
  dash: "dash",
  guard: GUARD_HOLD_ID,
  potion: "potion",
};

class HotbarSlot extends Component {
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly kind: HotbarKind;
  private readonly countdown: TextComponent;

  constructor(kind: HotbarKind, countdown: TextComponent) {
    super();
    this.kind = kind;
    this.countdown = countdown;
  }

  update(): void {
    const player = this.scene.findEntity("PlayerEntity");
    const abilities = player?.tryGet(Abilities);
    const controller = player?.tryGet(PlayerController);
    if (!abilities || !controller) return;

    const { ratio, label } =
      this.kind === "attack"
        ? controller.attackSlotState()
        : {
            ratio: abilities.cooldownRatio(HOTBAR_COOLDOWN_ID[this.kind]),
            label: abilities.cooldownRemaining(HOTBAR_COOLDOWN_ID[this.kind]).toFixed(1),
          };

    this.redraw(ratio);
    this.countdown.setText(label);
  }

  private redraw(ratio: number): void {
    const r = HOTBAR_RADIUS;
    this.gfx.graphics
      .clear()
      .roundRect(-r - 4, -r - 4, (r + 4) * 2, (r + 4) * 2, 10)
      .fill({ color: 0x0f172a, alpha: 0.88 })
      .stroke({ color: 0x334155, width: 1.5 });
    if (ratio < 1) {
      const angle = (1 - ratio) * Math.PI * 2;
      this.gfx.graphics
        .moveTo(0, 0)
        .arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + angle)
        .lineTo(0, 0)
        .fill({ color: 0x000000, alpha: 0.62 });
    }
  }
}

function spawnHotbar(scene: Scene): void {
  const totalWidth =
    HOTBAR_SLOTS.length * HOTBAR_SLOT_SIZE + (HOTBAR_SLOTS.length - 1) * HOTBAR_GAP;
  const startX = WIDTH / 2 - totalWidth / 2 + HOTBAR_SLOT_SIZE / 2;
  const y = HEIGHT - 44;

  HOTBAR_SLOTS.forEach((def, i) => {
    const x = startX + i * (HOTBAR_SLOT_SIZE + HOTBAR_GAP);

    const countdownEntity = scene.spawn(`hotbar-${def.kind}-time`);
    countdownEntity.add(new Transform({ position: new Vec2(x, y + 7) }));
    const countdown = countdownEntity.add(
      new TextComponent({
        text: "0.0",
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          fontWeight: "bold",
          fill: 0xf8fafc,
          align: "center",
        },
        anchor: { x: 0.5, y: 0.5 },
        layer: HUD_LAYER,
      }),
    );

    const labelEntity = scene.spawn(`hotbar-${def.kind}-label`);
    labelEntity.add(new Transform({ position: new Vec2(x, y - 15) }));
    labelEntity.add(
      new TextComponent({
        text: `${def.key}\n${def.name}`,
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 8,
          fill: 0x94a3b8,
          align: "center",
          lineHeight: 9,
        },
        anchor: { x: 0.5, y: 0.5 },
        layer: HUD_LAYER,
      }),
    );

    const slotEntity = scene.spawn(`hotbar-${def.kind}`);
    slotEntity.add(new Transform({ position: new Vec2(x, y) }));
    slotEntity.add(new GraphicsComponent({ layer: HUD_LAYER }));
    slotEntity.add(new HotbarSlot(def.kind, countdown));
  });
}

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

class Wall extends Entity {
  setup(params: { x: number; y: number; w: number; h: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-params.w / 2, -params.h / 2, params.w, params.h).fill({
          color: 0x1e293b,
        });
      }),
    );
    this.add(new RigidBodyComponent({ type: "static" }));
    this.add(
      new ColliderComponent({ shape: { type: "box", width: params.w, height: params.h } }),
    );
  }
}

class AbilitiesDemoScene extends Scene {
  readonly name = "abilities-addon-demo";
  readonly preload = [...BOXER_PRELOAD, HitSfx, BlockSfx, DeathSfx];
  readonly layers: readonly LayerDef[] = [{ name: HUD_LAYER, order: 1200, space: "screen" }];

  camera!: CameraEntity;
  fx!: VfxHub;
  token!: EngagementToken;

  onEnter(): void {
    // R (see `PlayerController.resetDemo`) rebuilds this scene from scratch —
    // hide any banner left over from a previous run before anything below
    // re-shows it.
    deadBanner.style.display = "none";

    // Positioned at the arena's center so the layer transform this camera
    // drives is the identity at rest — `PlayerController` hands it a follow
    // target below once the player exists. Clamped to the arena so the
    // zoomed-in view never scrolls past the walls into the background.
    this.camera = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
      zoom: CAMERA_ZOOM,
      bounds: { minX: 0, minY: 0, maxX: WIDTH, maxY: HEIGHT },
    });
    this.fx = createVfxHub(this);
    const tokenEntity = this.spawn("engagement-token");
    tokenEntity.add(new Transform());
    this.token = tokenEntity.add(new EngagementToken());

    this.buildArena();

    const player = this.spawn(PlayerEntity);
    // Shake (see `cameraOf(...).shake(...)` throughout) composes with follow
    // automatically: `CameraShake` only ever offsets `effectivePosition`,
    // never `CameraComponent.position` itself (the field `CameraFollow` and
    // `CameraBoundsComponent` read/write) — so the two never fight or drift.
    this.camera.follow(player.get(Transform), { smoothing: CAMERA_FOLLOW_SMOOTHING });
    this.spawn(EnemyEntity, { position: new Vec2(WIDTH / 2 - 200, HEIGHT / 2 - 110) });
    this.spawn(EnemyEntity, { position: new Vec2(WIDTH / 2 + 200, HEIGHT / 2 - 110) });
    this.spawn(EnemyEntity, { position: new Vec2(WIDTH / 2, HEIGHT / 2 + 170) });

    const hudEntity = this.spawn("hud");
    hudEntity.add(new Transform({ position: new Vec2(16, 16) }));
    const log = hudEntity.add(new CombatLog());
    const text = hudEntity.add(
      new TextComponent({
        text: "",
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          fill: 0xe2e8f0,
          lineHeight: 18,
        },
        layer: HUD_LAYER,
      }),
    );
    hudEntity.add(new Hud(text, log));

    spawnHotbar(this);

    this.on(HealthDied, (_data, entity) => {
      if (entity?.tags.has("player")) {
        deadBanner.style.display = "block";
      }
    });
  }

  private buildArena(): void {
    const t = ARENA_MARGIN;
    this.spawn(Wall, { x: WIDTH / 2, y: t / 2, w: WIDTH, h: t });
    this.spawn(Wall, { x: WIDTH / 2, y: HEIGHT - t / 2, w: WIDTH, h: t });
    this.spawn(Wall, { x: t / 2, y: HEIGHT / 2, w: t, h: HEIGHT });
    this.spawn(Wall, { x: WIDTH - t / 2, y: HEIGHT / 2, w: t, h: HEIGHT });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const deadBanner = document.createElement("div");
deadBanner.id = "dead-banner";
deadBanner.innerHTML = `You Died<div style="font-size:0.9rem;color:#94a3b8;margin-top:0.4rem">Reload to try again</div>`;

// Module-scope so `PlayerController.resetDemo` (a class declared above this
// point, closing over `engine` only at call time — after `main` has already
// assigned it) can reach `engine.scenes.replace(...)`.
let engine: Engine;

async function main(): Promise<void> {
  engine = new Engine({ debug: true });

  const container = setupGameContainer(WIDTH, HEIGHT);
  container.appendChild(deadBanner);

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0f172a,
      container,
    }),
  );
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 0 } }));
  engine.use(
    new InputPlugin({
      actions: {
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
        up: ["KeyW", "ArrowUp"],
        down: ["KeyS", "ArrowDown"],
        attack: ["Space", "KeyJ"],
        dash: ["ShiftLeft", "KeyK"],
        guard: ["KeyF", "KeyL"],
        potion: ["KeyQ", "Digit1"],
        reset: ["KeyR"],
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );
  engine.use(new ParticlesPlugin());
  engine.use(new AudioPlugin());
  // toggleKey: "KeyH" — the built-in physics debug overlay already draws
  // every collider's wireframe (yellow for sensors: `hitbox`/`projectile`),
  // so no example-side hitbox overlay is needed, only a key binding.
  engine.use(new DebugPlugin({ toggleKey: "KeyH" }));

  await engine.start();
  await engine.scenes.push(new AbilitiesDemoScene());
}

main().catch(console.error);
