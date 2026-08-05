import { LoggerKey, ServiceKey } from "../EngineContext.js";
import type { EngineContext } from "../EngineContext.js";
import type { Logger } from "../Logger.js";
import type { Plugin } from "../types.js";
import { devWarn } from "../internal/dev.js";
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
  readonly version = "0.1.0";

  private readonly _adapter: LocalizationAdapter;
  private readonly _locale: ReactiveValue<string>;
  private readonly _revision: ReactiveCounter;

  /** Unsubscribe from the adapter's `onChange`, set on install. */
  private _unsubscribe: (() => void) | undefined;

  /** Resolved on install; absent in a bare test context. */
  private _logger: Logger | undefined;

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

  /** An adapter `onChange` arrived while `_switching` suppressed it. The switch
   *  publishes it — including when the switch fails, so a catalog the adapter
   *  already swapped in isn't left unpublished. */
  private _pendingChange = false;

  /** A failing `adapter.t` is reported once; per-resolve logging would flood
   *  the frame loop. */
  private _reportedResolveFailure = false;

  constructor(options?: LocalizationPluginOptions) {
    this._adapter = options?.adapter ?? identityLocalizationAdapter;
    this._locale = createValue<string>({ default: this._adapter.locale });
    this._revision = createCounter();
  }

  install(context: EngineContext): void {
    context.register(LocalizationKey, this);
    this._logger = context.tryResolve(LoggerKey);
    this._unsubscribe = this._adapter.subscribe(() => {
      // Coalesce onChange fired during a driven switch — the switch bumps once.
      if (this._switching) {
        this._pendingChange = true;
        return;
      }
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
   * plugin-absent identity path. The first failure is logged so an adapter that
   * throws for every key doesn't read as merely-untranslated text; later ones
   * are silent because this runs per resolved string per frame.
   */
  resolve(binding: LocalizedBinding): string {
    try {
      return this._adapter.t(binding.id, binding.default, binding.values);
    } catch (error) {
      if (!this._reportedResolveFailure) {
        this._reportedResolveFailure = true;
        this._logger?.error(
          "localization",
          `adapter.t threw for "${binding.id}" — rendering the fallback. Further resolve failures are not logged.`,
          { error },
        );
      }
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
   * nothing (last caller wins). Failure: the requested locale is not adopted
   * and the rejection propagates — but if the adapter already swapped its
   * catalog and fired `onChange` before failing, that change is published, so
   * `locale` and the rendered strings can't disagree.
   *
   * An adapter with no `setLocale` (the identity adapter) cannot switch: the
   * call resolves, the reported locale stays the adapter's own, and dev builds
   * warn.
   */
  async setLocale(next: string): Promise<void> {
    const generation = ++this._generation;
    this._switching = true;
    if (!this._adapter.setLocale) {
      devWarn(
        `LocalizationPlugin.setLocale("${next}"): the adapter has no setLocale, so the locale is unchanged. Wire an adapter over your i18n library to switch languages.`,
      );
    }
    try {
      await this._adapter.setLocale?.(next);
    } catch (error) {
      if (generation === this._generation) {
        this._switching = false;
        // Publish only what the adapter actually changed before failing. A
        // clean failure changed nothing, so bumping would make every sink
        // re-resolve for no reason.
        if (this._pendingChange) this.publishAdapterState();
      }
      throw error;
    }
    // Superseded by a newer setLocale — commit nothing; the winning call
    // publishes, and it holds `_switching` until it does.
    if (generation !== this._generation) return;
    this._switching = false;
    this.publishAdapterState();
  }

  /**
   * Re-read the adapter's own locale and bump once. Always the adapter's value,
   * never the requested one — a library-backed adapter may canonicalize or fall
   * back (`en-US` → `en` when only `en` is loaded), and `resolve()` reads
   * against whatever the adapter actually holds.
   */
  private publishAdapterState(): void {
    this._pendingChange = false;
    this._locale.set(this._adapter.locale);
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
