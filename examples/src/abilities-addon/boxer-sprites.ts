import { Transform, Vec2 } from "@yagejs/core";
import type { Entity, Vec2Like } from "@yagejs/core";
import {
  AnimatedSpriteComponent,
  AnimationController,
  texture,
} from "@yagejs/renderer";
import type {
  AnimationDef,
  SheetFrameSource,
  TextureHandle,
} from "@yagejs/renderer";
import { Facing } from "@yagejs-addons/abilities";

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
// The pack's published direction order is dir1=SW, dir2=W, dir3=NW, dir4=N,
// dir5=NE, dir6=E, dir7=SE, dir8=S. The numbers do not sweep around the
// character, so `Facing.sector(8)` needs the lookup below.

export const DIR_COUNT = 8;
export const FRAME_W = 126;
export const FRAME_H = 132;
/** Default direction (east) — matches `Facing`'s default unit vector `(1, 0)`. */
export const DEFAULT_DIR = 6;

/** Octant index (0=E, 1=SE, 2=S, ... 7=NE, going clockwise) -> sheet `dirN`. */
export const OCTANT_TO_DIR = [6, 7, 8, 1, 2, 3, 4, 5] as const;

/** Map a facing to the sprite sheet's `dirN` (1-8): `Facing.sector(8)` gives the
 *  octant (0=E, clockwise), this pack's own table names the matching sheet. */
export function facingToDir(facing: Facing): number {
  return OCTANT_TO_DIR[facing.sector(DIR_COUNT)]!;
}

export type BoxerAnim =
  | "idle"
  | "run"
  | "sprint"
  | "attack1"
  | "attack2"
  | "powerPunch"
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

export interface BoxerAnimSpec {
  /** Sheet basename under `/assets/boxer/`. */
  sheet: string;
  /** Real (non-empty) frame count for this sheet. */
  frames: number;
  /** `AnimatedSprite.animationSpeed`. */
  speed: number;
  loop: boolean;
}

export const BOXER_ANIM_SPECS: Record<BoxerAnim, BoxerAnimSpec> = {
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
  // Same cycle at the same ratio as PLAYER_RUN_SPEED / PLAYER_SPEED, so the
  // faster held-dash movement keeps the planted foot moving proportionally.
  sprint: { sheet: "RunForward", frames: 14, speed: 0.46, loop: true },
  // Attack/telegraph speeds (attack1/2/3, chargeRelease, melee, cast) are
  // ~12% slower than a plain sprite-accurate playback rate — every hitbox/
  // telegraph/projectile window below is timed against these speeds, not
  // the sheet's native pace, so contact still lands on the visible extension
  // frame; re-derive both together if either changes.
  attack1: { sheet: "LeftJab", frames: 15, speed: 0.696, loop: false },
  attack2: { sheet: "RightJab", frames: 11, speed: 0.714, loop: false },
  // Fourteen real frames. The arm reaches full extension around frames 7-9;
  // the fist finisher's lunge and hitbox below are timed to that contact.
  powerPunch: { sheet: "RightHook", frames: 14, speed: 0.55, loop: false },
  // The KICKS combo finisher: a leaping flying kick (48 real frames — the
  // whole sheet bar one empty trailing cell), paired with `lungeMove` so the
  // drawn leap and the body's actual travel read as one motion.
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
export const CAST_DURATION =
  BOXER_ANIM_SPECS.cast.frames / (60 * BOXER_ANIM_SPECS.cast.speed);
export const CAST_RELEASE_FRAME = 29;
export const CAST_RELEASE_AT = CAST_RELEASE_FRAME / (60 * BOXER_ANIM_SPECS.cast.speed);

/** Composite `AnimationController` key for one (animation, direction) pair. */
export function boxerKey(anim: BoxerAnim, dir: number): string {
  return `${anim}_dir${dir}`;
}

export const boxerSheetHandles = new Map<string, TextureHandle[]>();

/** The 8 per-direction texture handles for a sheet, built once and cached. */
export function handlesFor(sheet: string): TextureHandle[] {
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
export const BOXER_PRELOAD = [
  ...new Set(
    (Object.keys(BOXER_ANIM_SPECS) as BoxerAnim[]).flatMap((anim) =>
      handlesFor(BOXER_ANIM_SPECS[anim].sheet),
    ),
  ),
];

/** The serializable frame source for one (animation, direction) pair — a
 *  single-row grid slice of that direction's sheet. Assets must already be
 *  loaded (via `preload`) before the frames resolve. */
export function sourceFor(anim: BoxerAnim, dir: number): SheetFrameSource {
  const spec = BOXER_ANIM_SPECS[anim];
  return {
    sheet: handlesFor(spec.sheet)[dir - 1]!.path,
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    count: spec.frames,
  };
}

/** Builds the `AnimationController` defs for the given animation subset,
 *  one entry per (animation, direction) — a player needs 8 animations x 8
 *  directions, an enemy fewer. `AnimationController` has no direction axis
 *  of its own, so directions are folded into the key name. */
export function buildBoxerAnimDefs(
  anims: readonly BoxerAnim[],
): Record<string, AnimationDef> {
  const defs: Record<string, AnimationDef> = {};
  for (const anim of anims) {
    const spec = BOXER_ANIM_SPECS[anim];
    for (let dir = 1; dir <= DIR_COUNT; dir++) {
      defs[boxerKey(anim, dir)] = {
        source: sourceFor(anim, dir),
        speed: spec.speed,
        loop: spec.loop,
      };
    }
  }
  return defs;
}

export const PLAYER_ANIMS: readonly BoxerAnim[] = [
  "idle",
  "run",
  "sprint",
  "attack1",
  "attack2",
  "powerPunch",
  "attack3",
  "chargeHold",
  "chargeRelease",
  "melee",
  "cast",
  "dash",
  "guard",
  "potion",
  "stagger",
  "death",
];
export const ENEMY_ANIMS: readonly BoxerAnim[] = [
  "idle",
  "run",
  "cast",
  "melee",
  "stagger",
  "death",
];

export const SPRITE_SCALE = 0.6;

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
export const SPRITE_ANCHOR = { x: 0.5, y: 0.5 };

/** Joined-glove position on frame 29 of each Fireball direction, measured in
 *  the source frame's 126×132 pixel coordinates. These are attachment points,
 *  not sprite anchors: the projectile starts here while the character keeps
 *  its torso-centered anchor. */
export const CAST_HAND_PX: readonly Vec2Like[] = [
  { x: 29, y: 72 }, // dir1: SW
  { x: 31, y: 58 }, // dir2: W
  { x: 49, y: 47 }, // dir3: NW
  { x: 81, y: 53 }, // dir4: N
  { x: 96, y: 59 }, // dir5: NE
  { x: 96, y: 73 }, // dir6: E
  { x: 75, y: 82 }, // dir7: SE
  { x: 49, y: 82 }, // dir8: S
];

export function castHandPosition(entity: Entity): Vec2 {
  const state = boxerAnimState.get(entity);
  const dir =
    state?.anim === "cast" ? state.dir : facingToDir(entity.get(Facing));
  const hand = CAST_HAND_PX[dir - 1]!;
  const anchorX = FRAME_W * SPRITE_ANCHOR.x;
  const anchorY = FRAME_H * SPRITE_ANCHOR.y;
  return entity
    .get(Transform)
    .worldPosition.add(
      new Vec2(hand.x - anchorX, hand.y - anchorY).scale(SPRITE_SCALE),
    );
}

/** Matches both combatants' `ColliderComponent` circle radius — shared so
 *  the contact-point approximation in `contactPoint` (see `reactToHit`)
 *  stays in sync with the actual collider size. The collider is centered on
 *  the Transform (no offset): the Transform origin already sits at
 *  `SPRITE_ANCHOR`'s torso row. */
export const BODY_COLLIDER_RADIUS = 21;

export const HP_BAR_WIDTH = 32;
export const HP_BAR_HEIGHT = 5;
export const HP_BAR_TOP = -34;

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
// prettier-ignore
export const FOOT_ANCHOR_PX: Partial<
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
export const boxerAnimState = new WeakMap<Entity, { anim: BoxerAnim; dir: number }>();

/** Frame rows from the torso anchor (`SPRITE_ANCHOR`'s row 66) down to a
 *  typical ground-contact line — subtracted from each frame's own measured
 *  `groundRow` in `applyFootAnchor` below, so the torso (not the foot) stays
 *  this many rows above wherever the foot actually lands that frame. Keeps
 *  the same per-frame wobble compensation `FOOT_ANCHOR_PX` was measured for,
 *  just referenced from the torso row instead of the ground row itself. */
export const GROUND_OFFSET_ROWS = 45;

/** Per-frame ground-plant compensation for idle/run/stagger, falling back to
 *  the static `SPRITE_ANCHOR` for every other animation (see its doc for the
 *  split). Sets the sprite's anchor to the currently-showing frame's own
 *  measured foot position offset by `GROUND_OFFSET_ROWS`, so the ground line
 *  renders a fixed distance below the torso anchor no matter which frame or
 *  direction is showing — a fixed offset, not the wobble across frames the
 *  table itself compensates for. */
export function applyFootAnchor(entity: Entity, frame: number): void {
  const state = boxerAnimState.get(entity);
  const anchorAnim = state?.anim === "sprint" ? "run" : state?.anim;
  const px =
    state && anchorAnim
      ? FOOT_ANCHOR_PX[anchorAnim]?.[state.dir - 1]?.[frame]
      : undefined;
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
export function installFootAnchorTracking(entity: Entity): void {
  entity.get(AnimatedSpriteComponent).animatedSprite.onFrameChange = (frame) =>
    applyFootAnchor(entity, frame);
}

/** Play a boxer animation on the entity's `AnimationController`, direction
 *  from its `Facing` (falling back to `DEFAULT_DIR` without one). Records
 *  the (anim, dir) pair in `boxerAnimState` for `applyFootAnchor` to read.
 *  `startFrame` jumps a one-shot past its own opening frames instead of
 *  always starting at 0 — `KICK_CHARGE` uses this to open onto the kick's
 *  windup already partway coiled, landing contact sooner without re-timing
 *  the whole clip. `lockDuration` overrides `AnimationController`'s own
 *  frames/speed-derived lock length to match, so `AnimationController.locked`
 *  clears in step with the shortened clip rather than the un-skipped one. */
export function playBoxerAnim(
  entity: Entity,
  anim: BoxerAnim,
  options: { oneShot: boolean; startFrame?: number; lockDuration?: number },
): void {
  const facing = entity.tryGet(Facing);
  const dir = facing ? facingToDir(facing) : DEFAULT_DIR;
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
      options.lockDuration !== undefined
        ? { duration: options.lockDuration }
        : undefined,
    );
    if (options.startFrame !== undefined) {
      entity
        .get(AnimatedSpriteComponent)
        .animatedSprite.gotoAndPlay(options.startFrame);
    }
  } else {
    controller.play(key);
  }
}

/** Readable-frame-rate bounds for the stagger reaction — see `playStaggerAnim`. */
export const STAGGER_SPEED_MIN = 0.32;
export const STAGGER_SPEED_MAX = 0.7;

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
export function playStaggerAnim(entity: Entity, stun: number): void {
  playBoxerAnim(entity, "stagger", { oneShot: true });
  const frames = BOXER_ANIM_SPECS.stagger.frames;
  const rawSpeed = frames / (60 * Math.max(stun, 0.05));
  const speed = Math.min(
    STAGGER_SPEED_MAX,
    Math.max(STAGGER_SPEED_MIN, rawSpeed),
  );
  entity.get(AnimatedSpriteComponent).animatedSprite.animationSpeed = speed;
}
