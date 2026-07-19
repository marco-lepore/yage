# Localization

Reactive translated text. YAGE owns the binding that re-renders on locale
change; the game brings the i18n backend (i18next / FormatJS / Fluent / `Intl`
/ a plain table) behind a thin `LocalizationAdapter`. YAGE writes no resolver —
key lookup, plurals, ICU/interpolation, and locale fallback live in the
adapter.

## Pieces

- `msg(id, values?, default?)` → `LocalizedBinding` — a plain, serializable
  `{ id, values?, default? }`. Does NOT resolve; resolution happens at render
  time against the active adapter. Treat bindings as immutable: to change
  `values`, build a new binding.
- `LocalizationAdapter` — you implement it (or wrap a library). `locale`,
  `t(id, fallback, values?)`, `subscribe(onChange)`, optional `setLocale(next)`.
- `LocalizationPlugin` / `LocalizationKey` — holds one adapter, owns the
  reactive locale + revision. Engine-scoped service.
- `LocalizableText = string | LocalizedBinding` — accepted by every text sink.

```ts
import { Engine, LocalizationPlugin, msg } from "@yagejs/core";
import type { LocalizationAdapter, JsonValue } from "@yagejs/core";

class TableAdapter implements LocalizationAdapter {
  private _locale = "en";
  private readonly listeners = new Set<() => void>();
  get locale() { return this._locale; }
  t(id: string, fallback: string | undefined, values?: Record<string, JsonValue>) {
    const s = CATALOGS[this._locale]?.[id] ?? fallback ?? id;
    return values ? s.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m)) : s;
  }
  subscribe(onChange: () => void) { this.listeners.add(onChange); return () => this.listeners.delete(onChange); }
  setLocale(next: string) { this._locale = next; this.listeners.forEach((l) => l()); }
}

engine.use(new LocalizationPlugin({ adapter: new TableAdapter() }));
```

With no plugin registered, bindings resolve through the identity adapter: they
render their `default` (interpolating `{tokens}`), else the `id`. So a
binding-authored game runs untranslated without any i18n wiring.

## Where bindings work

Author any user-facing string as `msg(...)` and it re-resolves on locale
change. The default is the fallback when the key is missing.

```ts
// UI (@yagejs/ui) — builder API on a UISurface / UIPanel
surface.text(msg("hud.title", undefined, "Play"));
surface.button(msg("hud.start", undefined, "Start"), { onClick });
// interpolation — rebuild the binding to change the value
scoreText.setText(msg("hud.score", { n: 3 }, "Score: {n}"));

// @pixi/ui wrappers — labels re-resolve in place, open/scroll state kept
new PixiFancyButton({ text: msg("hud.ok", undefined, "OK"), /* views */ });
new PixiSelect({ items: [msg("lang.en", undefined, "English"), msg("lang.fr", undefined, "French")], /* views */ });

// Dialogue (@yagejs-addons/dialogue) — i18n: true bridges to the plugin
host.add(new DialogueController({ ...createBoxDialogue(), i18n: true }));
// compact: `#line:<id>` tags a say line / choice; authored text is the fallback
// `Guard: Halt!  #line:d.halt`
```

`UISurface` binds its whole tree to the plugin in `onAdd` and releases it in
`onDestroy` — no per-element wiring. React trees bind via `useMessage` /
`<Text>` accepting a binding.

## Switching locale

```ts
const loc = engine.plugins.get("localization"); // or context.use(LocalizationKey)
await loc.setLocale("fr"); // awaits the adapter's catalog load, then bumps once
loc.locale;        // "fr"
loc.revision();    // monotonic; bumps whenever resolved output may have changed
loc.subscribe(() => { /* re-resolve */ }); // text sinks subscribe internally
```

`setLocale` is atomic: it awaits `adapter.setLocale(next)` (which resolves only
once `next` is loaded and active), then bumps the revision exactly once.
Concurrent calls: last caller wins; a superseded call commits nothing. On
adapter rejection the old locale is kept and the rejection propagates.

Dialogue in `i18n: true` mode retranslates the on-screen line/choices
automatically on a locale switch (the reveal restarts). With a custom
`I18nAdapter`, call `controller.retranslate()` yourself after the switch.

## Notes

- `values` must be JSON-safe so bindings round-trip through save/load.
- `PixiSelect` items are construction-only: a later `update({ items })` is
  ignored; localization refreshes the existing labels in place. Recreate the
  component to change which options exist.
- RTL, font switching per locale, and key-extraction tooling are not in this
  version.
