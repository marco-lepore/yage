import { identityLocalizationAdapter } from "./IdentityLocalizationAdapter.js";
import type { Localization, LocalizedBinding } from "./types.js";

/** A value accepted by a localizable text sink: a literal or a binding. */
export type LocalizableText = string | LocalizedBinding;

/**
 * Drives one text sink from a `string | LocalizedBinding`. Retains a binding,
 * resolves it against a {@link Localization} when attached (else statically via
 * the identity adapter), and re-resolves + re-applies on every revision bump
 * until detached. A plain string clears the binding.
 *
 * Framework-agnostic: the owner supplies `apply(text)` and drives `set` /
 * `attach` / `detach` from its own lifecycle — a Component's `onAdd` +
 * `addCleanup`, or a UIElement's attach/detach propagated by its panel.
 *
 * A binding resolved before a plugin is attached renders its `default` (else
 * its `id`); attaching a live plugin re-resolves against the real catalog.
 */
export class LocalizedTextController {
  private _binding: LocalizedBinding | undefined;
  private _localization: Localization | undefined;
  private _unsubscribe: (() => void) | undefined;

  /**
   * @param apply write a resolved string into the sink — used by `set`.
   * @param onRefresh write applied on a locale-driven re-resolve (locale switch
   *   or catalog load) when it must differ from `apply` — e.g. a split text
   *   forcing a resplit. Defaults to `apply`.
   */
  constructor(
    private readonly apply: (text: string) => void,
    private readonly onRefresh: (text: string) => void = apply,
  ) {}

  /** The retained binding, or `undefined` when the sink holds a plain string. */
  get binding(): LocalizedBinding | undefined {
    return this._binding;
  }

  /**
   * Retain the initial value without applying — the sink was already built with
   * its statically-resolved text. Call once at construction, before `attach`.
   */
  seed(value: LocalizableText): void {
    this._binding = this.retain(value);
  }

  /** Resolve `value` against the current context and apply it now. A binding is
   *  retained; a plain string clears any retained binding. */
  set(value: LocalizableText): void {
    this._binding = this.retain(value);
    this.apply(this.resolve(value));
  }

  /**
   * Attach to a live {@link Localization} (or `undefined` when no plugin is
   * registered): re-resolve the retained binding against the real catalog and
   * subscribe to revision bumps. With no plugin this is a no-op — the identity
   * adapter is locale-static, so the value seeded at construction stands.
   *
   * Idempotent: any previous subscription is released first, so re-attaching a
   * still-attached sink (e.g. a React reorder that moves a mounted child) can't
   * leak the prior subscription.
   */
  attach(localization: Localization | undefined): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this._localization = localization;
    if (!localization) return;
    if (this._binding) this.onRefresh(localization.resolve(this._binding));
    // Capture the service locally — a bump must resolve against the localization
    // this subscription belongs to, never a `this._localization` since cleared.
    this._unsubscribe = localization.subscribe(() => {
      if (this._binding) this.onRefresh(localization.resolve(this._binding));
    });
  }

  /** Detach: unsubscribe from revision bumps. Safe to call more than once. */
  detach(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this._localization = undefined;
  }

  /**
   * A plain string clears the binding; a binding is deep-cloned so the retained
   * descriptor is insulated from later mutation of the caller's object. `values`
   * are JSON-safe by contract, so `structuredClone` round-trips them exactly —
   * this is what keeps a mutated-after-assign object from leaking into a later
   * resolve or a save snapshot (bindings are immutable).
   */
  private retain(value: LocalizableText): LocalizedBinding | undefined {
    return typeof value === "string" ? undefined : structuredClone(value);
  }

  private resolve(value: LocalizableText): string {
    if (typeof value === "string") return value;
    if (this._localization) return this._localization.resolve(value);
    return identityLocalizationAdapter.t(value.id, value.default, value.values);
  }
}

/**
 * Resolve a {@link LocalizableText} with no engine context — used at
 * construction time to seed a sink's initial text. Renders a binding's
 * `default` (else its `id`), interpolating `{tokens}`; passes a string through.
 */
export function resolveStatic(value: LocalizableText): string {
  if (typeof value === "string") return value;
  return identityLocalizationAdapter.t(value.id, value.default, value.values);
}
