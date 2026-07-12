import { Component, Transform, Vec2, defineEvent } from "@yagejs/core";
import type { Hit, HitResult, StandardHitData } from "../core/hit/types.js";
import { createHitDelivery } from "../core/hit/delivery.js";
import type { HitStage } from "../core/hit/resolve.js";
import { resolveHit } from "../core/hit/resolve.js";
import { defaultHitSteps } from "./standardHit.js";

/**
 * Emitted by `HitReceiver` after a landed hit's receipt steps have run.
 * A singleton token, so its payload is typed against the default
 * `StandardHitData` vocabulary; multi-system handlers narrow with their own
 * type guard.
 */
export const HitReceived = defineEvent<Hit>("hit:received");

/**
 * Emitted after the resolution fold completes, once per open `guard` that
 * engaged on this hit (partially or fully), in engage order — regardless of
 * the final result. Emitted from `receive()`, never from inside the guard
 * stage itself: a handler typically cancels the ability that owns the
 * still-executing window, and doing that mid-fold would be reentrant.
 */
export const HitGuarded = defineEvent<{ hit: Hit; outcome: HitResult }>(
  "hit:guarded",
);

/**
 * Accept/reject policy run before anything else in resolution; return true
 * to accept. The default rejects hits from the receiver's own team.
 */
export type HitFilter<TData = StandardHitData> = (
  hit: Hit<TData>,
  receiver: HitReceiver<TData>,
) => boolean;

/**
 * Verdict from an open guard's `policy` for one hit: `"pass"` means the
 * guard didn't engage (e.g. facing the wrong way) — resolution continues as
 * if it weren't there; `"modified"` means the policy mutated `hit.data` and
 * resolution continues (a partial block — the final result is still
 * `"hit"`); `"negate"` ends the fold with the guard step's `outcome` label.
 */
export type GuardPolicy<TData = StandardHitData> = (
  hit: Hit<TData>,
  receiver: HitReceiver<TData>,
) => "pass" | "modified" | "negate";

/** Params carried by the `guard` window step (see `src/components/steps/guard.ts`). */
export interface GuardParams<TData = StandardHitData> {
  /** The `HitResult` label this guard reports when it engages ("blocked", "parried", ...). */
  outcome: Exclude<HitResult, "hit" | "ignored">;
  policy: GuardPolicy<TData>;
  /**
   * Hit data delivered back to the attacker when this guard engages
   * (`"modified"` or `"negate"`). Static only — there is no `StepContext`
   * available at engage time, unlike a delivery `HitSpec`'s fire-time
   * builder. A non-`Hittable` attacker is a no-op.
   */
  punish?: TData;
}

export interface HitReceiverOptions<TData = StandardHitData> {
  /** This entity's team; the default filter rejects same-team hits. */
  team?: string;
  /**
   * Seconds of invulnerability armed after each landed hit. Gates all
   * receipt — knockback included, not just damage. Default 0 (none).
   */
  iframes?: number;
  /** Replaces the default same-team filter (e.g. to allow friendly fire). */
  filter?: HitFilter<TData>;
  /**
   * Ordered consequence stages run after guards, once a hit reaches them.
   * Defaults to `defaultHitSteps` (damage via `Health`, then knockback/stun
   * via `Stagger`).
   */
  steps?: readonly HitStage<TData, HitReceiver<TData>>[];
}

/**
 * Default receipt machinery behind the `Hittable` trait: a resolution fold
 * (`resolveHit`) over team filter → i-frames → guards → apply stages. The
 * entity delegates its trait method to it:
 *
 * ```ts
 * @trait(Hittable)
 * class Enemy extends Entity {
 *   receiveHit(hit: Hit): HitResult {
 *     return this.get(HitReceiver).receive(hit);
 *   }
 *   setup() {
 *     this.add(new Health({ max: 30 }));
 *     this.add(new HitReceiver({ team: "enemy", iframes: 0.2 }));
 *   }
 * }
 * ```
 *
 * Resolution order is team → i-frames → guards → apply, fixed: same-team
 * hits are rejected before a guard ever sees them (you don't parry an
 * ally's swing), and i-frames arm only when a hit lands (`"hit"`) — a
 * successful block or parry grants no invulnerability. `HitReceived` emits
 * only on `"hit"`; `HitGuarded` emits once per engaged guard, regardless
 * of the final result (see its doc).
 *
 * `TData` types the hit data every stage sees; the default is
 * `StandardHitData`. A per-system receiver (`new HitReceiver<SpiritHitData>({...})`)
 * gets fully typed custom `steps` — the entity's `receiveHit` narrows the
 * incoming `Hit` with the system's type guard before calling `receive`. The
 * `guard`/`invulnerable` default steps are concrete to `StandardHitData`
 * (see `src/components/steps/`); a per-system receiver supplies its own
 * guard stage if it needs one.
 */
export class HitReceiver<TData = StandardHitData> extends Component {
  /** This entity's team, checked by the default filter. Writable for runtime team changes. */
  team: string | undefined;

  private readonly iframes: number;
  private readonly filter: HitFilter<TData>;
  private readonly applyStages: readonly HitStage<TData, HitReceiver<TData>>[];
  private readonly openGuards = new Set<GuardParams<TData>>();
  private readonly openInvulnerabilities = new Set<object>();
  private _iframesRemaining = 0;
  private _engagedGuards: GuardParams<TData>[] = [];

  constructor(options: HitReceiverOptions<TData> = {}) {
    super();
    this.team = options.team;
    this.iframes = options.iframes ?? 0;
    this.filter = options.filter ?? sameTeamFilter;
    // The default steps read only optional `StandardHitData` fields and do
    // nothing when a field is absent, so any data shape is safe.
    this.applyStages =
      options.steps ??
      (defaultHitSteps as unknown as readonly HitStage<
        TData,
        HitReceiver<TData>
      >[]);
  }

  /** Seconds of invulnerability left. 0 when receipt is open. */
  get iframesRemaining(): number {
    return this._iframesRemaining;
  }

  /** Open a guard window (the `guard` step's `enter` hook). */
  openGuard(params: GuardParams<TData>): void {
    this.openGuards.add(params);
  }

  /** Close a guard window (the `guard` step's `exit` hook). */
  closeGuard(params: GuardParams<TData>): void {
    this.openGuards.delete(params);
  }

  /**
   * Open a keyed invulnerability window (the `invulnerable` step's enter
   * hook). Keys have identity, like guard params: overlapping windows stay
   * protected until every key closes. Distinct from the post-hit i-frames
   * timer.
   */
  openInvulnerability(key: object): void {
    this.openInvulnerabilities.add(key);
  }

  /** Close a keyed invulnerability window (the `invulnerable` step's exit hook). */
  closeInvulnerability(key: object): void {
    this.openInvulnerabilities.delete(key);
  }

  /** Run the resolution fold for one hit: team → i-frames → guards → apply. */
  receive(hit: Hit<TData>): HitResult {
    this._engagedGuards = [];
    const chain: readonly HitStage<TData, HitReceiver<TData>>[] = [
      this.teamStage,
      this.iframesStage,
      this.guardStage,
      ...this.applyStages,
    ];
    const result = resolveHit(hit, chain, this);

    if (result === "hit") {
      if (this.iframes > 0) this._iframesRemaining = this.iframes;
      // `HitReceived` is a singleton token typed against the default
      // vocabulary; handlers of per-system hits narrow via their type guard.
      this.entity.emit(HitReceived, hit as Hit);
    }

    // Capture before emitting: a punish can re-enter receive() on this
    // receiver (mutual punish guards), which reassigns the field.
    const engaged = this._engagedGuards;
    for (const guard of engaged) {
      this.entity.emit(HitGuarded, {
        hit: hit as Hit,
        outcome: guard.outcome,
      });
      if (guard.punish !== undefined) this.deliverPunish(hit, guard.punish);
    }

    return result;
  }

  update(dt: number): void {
    if (this._iframesRemaining > 0) {
      this._iframesRemaining = Math.max(0, this._iframesRemaining - dt);
    }
  }

  private readonly teamStage: HitStage<TData, HitReceiver<TData>> = (hit) => {
    if (!this.filter(hit, this)) return "ignored";
  };

  private readonly iframesStage: HitStage<TData, HitReceiver<TData>> = () => {
    if (this.openInvulnerabilities.size > 0 || this._iframesRemaining > 0) {
      return "ignored";
    }
  };

  private readonly guardStage: HitStage<TData, HitReceiver<TData>> = (
    hit,
  ) => {
    for (const guard of this.openGuards) {
      const verdict = guard.policy(hit, this);
      if (verdict === "pass") continue;
      this._engagedGuards.push(guard);
      if (verdict === "negate") return guard.outcome;
      // "modified": the policy mutated `hit.data` in place; resolution
      // continues through the remaining guards and the apply stages.
    }
  };

  /** Route a guard's `punish` back to the attacker: direction defender→attacker, team stamped from the defender. */
  private deliverPunish(hit: Hit<TData>, punish: TData): void {
    const from = this.entity.tryGet(Transform)?.worldPosition ?? Vec2.ZERO;
    createHitDelivery<TData>({
      source: this.entity,
      data: punish,
      ...(this.team !== undefined ? { team: this.team } : {}),
    }).deliver(hit.source, from);
  }
}

// Generic because it reads no hit data — the truthful type for any TData.
function sameTeamFilter<TData>(
  hit: Hit<TData>,
  receiver: HitReceiver<TData>,
): boolean {
  return (
    hit.team === undefined ||
    receiver.team === undefined ||
    hit.team !== receiver.team
  );
}
