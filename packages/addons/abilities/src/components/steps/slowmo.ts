import type { SceneTimeScaleOptions, TimeEffectHandle } from "@yagejs/core";
import type { PointStep, StepContext, WindowStep } from "../../core/types.js";

export interface SlowmoParams {
  /**
   * Time scale for the window: `< 1` slows the scene (bullet time), `> 1`
   * speeds it up. Must be > 0 — a full stop is a hitstop concern, delivered
   * imperatively through `SceneTime.freezeFor` rather than as a timeline step.
   */
  scale: number;
  /**
   * Slow the activation owner too. Default false: the owner is excluded, so a
   * `0.25` window plays the rest of the world in slow motion while the owner's
   * own timeline (this ability included) runs at normal speed. The owner is
   * `ctx.entity` — the entity running the activation, which for a spawned
   * nested attack is the spawned entity, not the original caster.
   *
   * Set true to slow everything, the owner included. Then the ability's own
   * remaining timeline slows with the scene: a window authored to end at `to`
   * lasts `(to − from) / scale` in wall-clock seconds, and every later step's
   * authored timestamp stretches to match.
   */
  includeOwner?: boolean;
  /**
   * Channel name passed through to `SceneTime.scaleBy` — overlapping requests
   * on one channel compose by latest-active-wins; separate channels multiply.
   * Omit for an anonymous channel private to this window.
   */
  key?: string;
  /** Display-only label for debugging. Defaults to `key`. */
  label?: string;
}

/** A cancellation-bound slow-motion window. */
export type SlowmoWindowArgs = SlowmoParams & {
  from: number;
  to: number | "end";
};

/** A raw-time slow-motion request that can outlive its ability phase. */
export type TimedSlowmoArgs = SlowmoParams & {
  at: number;
  for: number;
};

interface TimedSlowmoParams extends SlowmoParams {
  for: number;
}

// Per-run handle ledger: `ctx` is unique per (entity, activation), and
// `Abilities`'s construction-time validator rejects the same step object
// appearing twice in one timeline, so (ctx, params) identifies one open
// window — mirrors `hitbox`'s spawn ledger. WeakMap-by-ctx releases when the
// activation ends.
const open = new WeakMap<StepContext, Map<object, TimeEffectHandle>>();

/**
 * A window that dilates scene time through the owning scene's `SceneTime`:
 * `enter` opens a scale request, `exit` (natural or cancelled) releases it, so
 * a cancelled ability can never leave the scene stuck in slow motion. The
 * activation owner is excluded by default — see `includeOwner`.
 *
 * ```ts
 * // A dash that briefly slows everything except the dasher.
 * slowmo({ from: 0, to: 0.3, scale: 0.4 })
 * ```
 */
export function slowmo(args: SlowmoWindowArgs): WindowStep<SlowmoParams>;
export function slowmo(args: TimedSlowmoArgs): PointStep<TimedSlowmoParams>;
export function slowmo(
  args: SlowmoWindowArgs | TimedSlowmoArgs,
): WindowStep<SlowmoParams> | PointStep<TimedSlowmoParams> {
  if ("at" in args) {
    const { at, ...params } = args;
    return {
      kind: "slowmo",
      at,
      params,
      hooks: {
        fire(timed, ctx) {
          ctx.time.scaleBy(timed.scale, scaleOptions(timed, ctx, timed.for));
        },
      },
    };
  }

  const { from, to, ...params } = args;
  return {
    kind: "slowmo",
    from,
    to,
    params,
    hooks: {
      enter: openSlowmo,
      onDisable: closeSlowmo,
      onEnable: openSlowmo,
      exit: closeSlowmo,
    },
  };
}

function openSlowmo(params: SlowmoParams, ctx: StepContext): void {
  const handle = ctx.time.scaleBy(params.scale, scaleOptions(params, ctx));
  let byParams = open.get(ctx);
  if (!byParams) open.set(ctx, (byParams = new Map()));
  byParams.set(params, handle);
}

function closeSlowmo(params: SlowmoParams, ctx: StepContext): void {
  const byParams = open.get(ctx);
  const handle = byParams?.get(params);
  if (!handle) return;
  handle.release();
  byParams?.delete(params);
}

function scaleOptions(
  params: SlowmoParams,
  ctx: StepContext,
  duration?: number,
): SceneTimeScaleOptions {
  return {
    ...(duration !== undefined ? { for: duration } : {}),
    ...(params.key !== undefined ? { key: params.key } : {}),
    ...(params.label !== undefined ? { label: params.label } : {}),
    ...(params.includeOwner ? {} : { excludeUpdates: [ctx.entity] }),
  };
}
