import { ServiceKey } from "../EngineContext.js";
import type { EngineContext } from "../EngineContext.js";
import type { Plugin } from "../types.js";
import { createCounter, createValue } from "../state/index.js";
import type { ReactiveCounter, ReactiveValue } from "../state/index.js";
import { identityLocalizationAdapter } from "./IdentityLocalizationAdapter.js";
import type {
  Localization,
  LocalizationAdapter,
  LocalizedBinding,
} from "./types.js";

/** Service key for the registered {@link Localization}. Engine-scoped. */
export const LocalizationKey = new ServiceKey<Localization>("localization");

/** Options for {@link LocalizationPlugin}. */
export interface LocalizationPluginOptions {
  /** The i18n backend. Defaults to the identity adapter. */
  adapter?: LocalizationAdapter;
}

/**
 * Holds ONE {@link LocalizationAdapter} and owns the reactive locale +
 * revision. The adapter resolves strings; the plugin makes resolution
 * reactive — its `revision` bumps whenever resolved output may have changed
 * (a driven locale switch, or the adapter firing `onChange` for a lazy catalog
 * load), and text sinks re-resolve on the bump.
 */
export class LocalizationPlugin implements Plugin, Localization {
  readonly name = "localization";
  readonly version = "0.0.0";

  private readonly _adapter: LocalizationAdapter;
  private readonly _locale: ReactiveValue<string>;
  private readonly _revision: ReactiveCounter;

  /** Unsubscribe from the adapter's `onChange`, set on install. */
  private _unsubscribe: (() => void) | undefined;

  /**
   * True while a driven `setLocale` awaits the adapter. Adapter `onChange`
   * events during this window are coalesced into the switch's single bump
   * instead of each bumping the revision.
   */
  private _switching = false;

  /**
   * Monotonic token guarding concurrent `setLocale` calls. Only the call whose
   * token still matches at completion commits — last caller wins.
   */
  private _generation = 0;

  constructor(options?: LocalizationPluginOptions) {
    this._adapter = options?.adapter ?? identityLocalizationAdapter;
    this._locale = createValue<string>({ default: this._adapter.locale });
    this._revision = createCounter();
  }

  install(context: EngineContext): void {
    context.register(LocalizationKey, this);
    this._unsubscribe = this._adapter.subscribe(() => {
      // Coalesce onChange fired during a driven switch — the switch bumps once.
      if (this._switching) return;
      // The catalog changed outside a driven switch (e.g. the game drove the
      // i18n library directly). Track the adapter's locale so `locale` stays
      // honest, then re-resolve.
      this._locale.set(this._adapter.locale);
      this._revision.increment();
    });
  }

  onDestroy(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  get locale(): string {
    return this._locale.get();
  }

  revision(): number {
    return this._revision.value();
  }

  subscribe(onChange: () => void): () => void {
    return this._revision.subscribe(onChange);
  }

  /**
   * Resolve a binding to a string. Wraps `adapter.t` so a throw renders the
   * binding's `default` (or its `id`) instead of breaking the render loop —
   * interpolating `{tokens}` on that fallback path too, matching the
   * plugin-absent identity path.
   */
  resolve(binding: LocalizedBinding): string {
    try {
      return this._adapter.t(binding.id, binding.default, binding.values);
    } catch {
      return identityLocalizationAdapter.t(
        binding.id,
        binding.default,
        binding.values,
      );
    }
  }

  /**
   * Atomic locale switch. Awaits `adapter.setLocale(next)` if the adapter
   * supports it (which resolves only once `next` is loaded and active), then
   * bumps the revision exactly ONCE.
   *
   * Concurrency: each call takes a generation token; a superseded call commits
   * nothing (last caller wins). Failure: if the adapter rejects, the old
   * locale is kept, nothing is published, and the rejection propagates.
   */
  async setLocale(next: string): Promise<void> {
    const generation = ++this._generation;
    this._switching = true;
    try {
      await this._adapter.setLocale?.(next);
    } catch (error) {
      if (generation === this._generation) this._switching = false;
      throw error;
    }
    // Superseded by a newer setLocale — commit nothing.
    if (generation !== this._generation) return;
    this._switching = false;
    // Publish the adapter's active locale, not the requested one — a
    // library-backed adapter may canonicalize or fall back (e.g. `en-US` → `en`
    // when only `en` is loaded), and `resolve()` reads against that. A static
    // adapter (no `setLocale`) can't switch, so keep reporting the request.
    this._locale.set(this._adapter.setLocale ? this._adapter.locale : next);
    this._revision.increment();
  }
}

/**
 * Resolve a binding against the registered localization plugin, or — when none
 * is registered — via the identity adapter (renders the `default`, else the
 * `id`). Never throws.
 */
export function resolveLocalized(
  context: EngineContext,
  binding: LocalizedBinding,
): string {
  const localization = context.tryResolve(LocalizationKey);
  if (localization) return localization.resolve(binding);
  return identityLocalizationAdapter.t(
    binding.id,
    binding.default,
    binding.values,
  );
}
