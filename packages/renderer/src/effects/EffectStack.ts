import { Tween } from "@yagejs/core";
import type { Process } from "@yagejs/core";
import type { Container, Filter } from "pixi.js";
import type { Effect, EffectFactory, EffectScope } from "./Effect.js";
import type { EffectHandle, EffectProcessHost } from "./EffectHandle.js";
import {
  EFFECT_META,
  getEffectMeta,
  getRegisteredEffect,
} from "./defineEffect.js";

function effectFilters(effect: Effect): Filter[] {
  return Array.isArray(effect.filter) ? effect.filter : [effect.filter];
}

function readCurrentFilters(displayObject: Container): Filter[] {
  const current = displayObject.filters as
    | Filter
    | readonly Filter[]
    | null
    | undefined;
  if (current == null) return [];
  return Array.isArray(current) ? [...current] : [current as Filter];
}

/** Serialized snapshot of an `EffectStack`. */
export interface EffectStackSnapshot {
  entries: EffectStackEntry[];
}

/** One entry inside an {@link EffectStackSnapshot}. */
export interface EffectStackEntry {
  /** Registered effect definition name (`yage:hitFlash`, etc). */
  name: string;
  /** Snapshot of the options passed to the definition at attach time. */
  options: unknown;
  /** Primary intensity at save time. */
  intensity: number;
  /** Whether the effect's filter(s) were enabled. */
  enabled: boolean;
}

/**
 * Internal: a list of attached effects bound to one pixi `Container`.
 *
 * - Coexists with external `displayObject.filters` assignments. The stack
 *   tracks the filter instances it owns; any other filter present on the
 *   target at sync time is treated as external and preserved (placed before
 *   the stack's owned filters in the chain, so user filters render first
 *   and stack effects composite on top).
 * - `fadeIn` / `fadeOut` are implemented via `Tween.custom`, scheduled on
 *   the supplied `EffectProcessHost`. Per-effect processes are tracked so
 *   `handle.remove()` cancels in-flight fades for that effect rather than
 *   letting them keep firing `setIntensity` after detach.
 *
 * @internal
 */
export class EffectStack {
  private readonly entries = new Set<Effect>();
  private readonly handles = new Map<Effect, EffectHandle>();
  private readonly ownedFilters = new Set<Filter>();
  private readonly effectProcesses = new Map<Effect, Set<Process>>();
  private destroyed = false;
  private warnedUnsavable = false;

  constructor(
    private readonly displayObject: Container,
    private readonly processHost: EffectProcessHost,
    private readonly scope: EffectScope,
  ) {}

  /** Build and attach an effect, returning its handle. */
  add<H extends EffectHandle>(factory: EffectFactory<H>): H {
    if (this.destroyed) {
      throw new Error(
        `EffectStack: cannot add effect to a destroyed ${this.scope}-scope stack.`,
      );
    }
    const effect = factory() as Effect<H>;
    this.entries.add(effect);
    effect.onAttach?.({ displayObject: this.displayObject, scope: this.scope });
    this.syncFilters();

    const trackFade = (p: Process): Process => {
      let set = this.effectProcesses.get(effect);
      if (!set) {
        set = new Set();
        this.effectProcesses.set(effect, set);
      }
      // Lazy-prune completed fades for this effect on each new fade — the
      // host's pruning only spans its own bookkeeping; this set lives until
      // the effect is removed, so without pruning a long-lived screen/layer
      // handle would accumulate Process refs over the app's lifetime.
      for (const old of set) {
        if (old.completed) set.delete(old);
      }
      set.add(p);
      return this.processHost.run(p);
    };

    // Built directly (not via spread) so the `enabled` getter survives —
    // spreading an object literal eagerly invokes getters and copies their
    // values as static properties.
    const handle: EffectHandle = {
      remove: () => this.removeEffect(effect),
      setEnabled: (on: boolean) => {
        for (const f of effectFilters(effect)) f.enabled = on;
      },
      enabled: true,
      fadeIn: (duration: number) =>
        trackFade(
          Tween.custom(
            (v) => effect.setIntensity(v),
            effect.getIntensity(),
            1,
            duration,
          ),
        ),
      fadeOut: (duration: number) =>
        trackFade(
          Tween.custom(
            (v) => effect.setIntensity(v),
            effect.getIntensity(),
            0,
            duration,
          ),
        ),
    };
    Object.defineProperty(handle, "enabled", {
      get: () => effectFilters(effect).every((f) => f.enabled),
      enumerable: true,
      configurable: false,
    });

    if (effect.buildExtras) {
      Object.assign(handle, effect.buildExtras(handle));
    }
    this.handles.set(effect, handle);
    return handle as H;
  }

  /** Number of attached effects. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Capture the steady-state of every effect in the stack. Effects built
   * from `defineEffect`-registered factories are included; entries without
   * registry metadata (e.g. `rawFilter`, hand-built `Effect`s) are skipped
   * with a one-shot warning. In-flight `fadeIn` / `fadeOut` tweens are NOT
   * preserved — only the values `getIntensity()` reads at call time.
   */
  serialize(): EffectStackSnapshot {
    const out: EffectStackEntry[] = [];
    for (const effect of this.entries) {
      const meta = getEffectMeta(effect);
      if (!meta) {
        if (!this.warnedUnsavable) {
          this.warnedUnsavable = true;
          console.warn(
            `EffectStack.serialize: ${this.scope}-scope stack contains an ` +
              `effect not built via defineEffect (rawFilter or custom) — ` +
              `it will be skipped on save.`,
          );
        }
        continue;
      }
      const handle = this.handles.get(effect);
      out.push({
        name: meta.definitionName,
        options: meta.options,
        intensity: effect.getIntensity(),
        enabled: handle?.enabled ?? true,
      });
    }
    return { entries: out };
  }

  /**
   * Replace the stack's contents with effects rebuilt from `snapshot`.
   * Cancels in-flight fades on existing entries and detaches them, then
   * re-adds each entry via its registered definition. Unknown definition
   * names are skipped with a warning.
   */
  restoreFrom(snapshot: EffectStackSnapshot): void {
    if (this.destroyed) {
      throw new Error(
        `EffectStack: cannot restore into a destroyed ${this.scope}-scope stack.`,
      );
    }
    for (const effect of [...this.entries]) {
      this.removeEffect(effect);
    }
    for (const entry of snapshot.entries) {
      const def = getRegisteredEffect(entry.name);
      if (!def) {
        console.warn(
          `EffectStack.restoreFrom: no effect definition registered for ` +
            `"${entry.name}" — entry skipped.`,
        );
        continue;
      }
      // Build the effect inside a closure so we can capture it for setIntensity
      // afterward and re-tag it (subsequent saves must round-trip).
      let built: Effect | undefined;
      const factory: EffectFactory = () => {
        const effect = def.factory(entry.options);
        Object.defineProperty(effect, EFFECT_META, {
          value: { definitionName: entry.name, options: entry.options },
          enumerable: false,
          writable: false,
          configurable: false,
        });
        built = effect;
        return effect;
      };
      const handle = this.add(factory);
      built?.setIntensity(entry.intensity);
      handle.setEnabled(entry.enabled);
    }
  }

  /** Tear down every attached effect and cancel any in-flight tweens. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const effect of this.entries) {
      effect.onDetach?.();
    }
    this.entries.clear();
    this.handles.clear();
    this.effectProcesses.clear();

    // Strip our owned filters from the target while leaving any externally-
    // assigned filters in place. Restore null when nothing external remains.
    const external = readCurrentFilters(this.displayObject).filter(
      (f) => !this.ownedFilters.has(f),
    );
    this.ownedFilters.clear();
    this.displayObject.filters = external.length === 0 ? null : external;

    this.processHost.cancelAll();
  }

  private removeEffect(effect: Effect): void {
    if (!this.entries.has(effect)) return;
    this.entries.delete(effect);
    this.handles.delete(effect);
    effect.onDetach?.();

    // Cancel any in-flight fades scoped to this effect. Without this, the
    // tween keeps ticking and calls setIntensity on a now-detached filter.
    const procs = this.effectProcesses.get(effect);
    if (procs) {
      for (const p of procs) {
        if (!p.completed) p.cancel();
      }
      this.effectProcesses.delete(effect);
    }

    this.syncFilters();
  }

  private syncFilters(): void {
    const desired: Filter[] = [];
    for (const e of this.entries) desired.push(...effectFilters(e));

    // External filters = current filters that are NOT in our previously
    // owned set. Re-read every sync so user assignments between syncs
    // (sprite.filters = [their, custom]) are honored.
    const external = readCurrentFilters(this.displayObject).filter(
      (f) => !this.ownedFilters.has(f),
    );

    this.ownedFilters.clear();
    for (const f of desired) this.ownedFilters.add(f);

    const next = [...external, ...desired];
    this.displayObject.filters = next.length === 0 ? null : next;
  }
}
