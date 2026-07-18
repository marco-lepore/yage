import type { SceneTimeScaleOptions, TimeEffectHandle } from "@yagejs/core";
import { defineStep } from "../../core/defineStep.js";
import type { StepContext } from "../../core/types.js";

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
export const slowmo = defineStep<SlowmoParams>("slowmo", {
  enter(params, ctx) {
    const options: SceneTimeScaleOptions = {
      ...(params.key !== undefined ? { key: params.key } : {}),
      ...(params.label !== undefined ? { label: params.label } : {}),
      ...(params.includeOwner ? {} : { excludeUpdates: [ctx.entity] }),
    };
    const handle = ctx.time.scaleBy(params.scale, options);
    let byParams = open.get(ctx);
    if (!byParams) open.set(ctx, (byParams = new Map()));
    byParams.set(params, handle);
  },
  exit(params, ctx) {
    const byParams = open.get(ctx);
    const handle = byParams?.get(params);
    if (handle) {
      handle.release();
      byParams!.delete(params);
    }
  },
});
