# Localization

Reactive translated text. YAGE owns the binding that re-renders on locale
change; the game brings the i18n backend (i18next / FormatJS / Fluent / `Intl`
/ a plain table) behind a thin `LocalizationAdapter`. YAGE writes no resolver —
key lookup, plurals, ICU/interpolation, and locale fallback live in the
adapter.

## Pieces

- `msg(id, default?, values?)` → `LocalizedBinding` — a plain, serializable
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
surface.text(msg("hud.title", "Play"));
surface.button(msg("hud.start", "Start"), { onClick });
// interpolation — rebuild the binding to change the value
scoreText.setText(msg("hud.score", "Score: {n}", { n: 3 }));

// @pixi/ui wrappers — labels re-resolve in place, open/scroll state kept
new PixiFancyButton({ text: msg("hud.ok", "OK"), /* views */ });
new PixiSelect({ items: [msg("lang.en", "English"), msg("lang.fr", "French")], /* views */ });
new PixiCheckbox({ text: msg("opt.sfx", "Sound effects") });
new PixiInput({ placeholder: msg("form.name", "Your name") }); // `value` stays literal — it is user input
new PixiRadioGroup({ items: [{ text: msg("diff.easy", "Easy") }], /* … */ });

// Dialogue (@yagejs-addons/dialogue) — i18n: true bridges to the plugin
host.add(new DialogueController({ ...createBoxDialogue(), i18n: true }));
// compact: `#line:<id>` tags a say line / choice; authored text is the fallback
// `Guard: Halt!  #line:d.halt`
```

`UISurface` binds its whole tree to the plugin in `onAdd` and releases it on
teardown — no per-element wiring. `UIRoot` does the same for the elements a
React tree mounts, and the built-in `<Text>` / `<Button>` / `<Checkbox>`
components also resolve through `useMessage`.

## Inventory (@yagejs-addons/inventory)

Item names, descriptions, and action labels are looked up by a key derived from
the id, with the authored string as the fallback. There is no flag to turn on:
register a `LocalizationPlugin` and add the keys to your catalog.

```ts
defineItems({ potion: { name: "Potion", description: "Restores health." } });
// looked up as:
//   inventory.item.potion.name
//   inventory.item.potion.description
//   inventory.action.<actionId>.label
host.add(new InventoryController({ ...createInventoryPanel(), inventory,
  title: msg("bag.title", undefined, "Bag") }));   // title takes a binding
```

- `defaultInventoryKeys` is the scheme above; pass `keys` on the controller to
  match a catalog organised differently.
- `SlotView.name` / `SlotView.description` are the resolved strings — render
  those in a custom cell preset, not `def.name` (the authored literal).
  `PresentedAction.label` is likewise resolved.
- A locale switch re-presents the whole panel (`session.relocalize()`, wired
  automatically), preserving the cursor and an open action menu — item names
  drive cell and menu-row widths, so the views rebuild rather than swap text.

## Switching locale

```ts
// Hold the plugin you registered, or resolve the service from a context:
const loc = scene.context.use(LocalizationKey);
await loc.setLocale("fr"); // awaits the adapter's catalog load, then bumps once
loc.locale;        // "fr"
loc.revision();    // monotonic; bumps whenever resolved output may have changed
loc.subscribe(() => { /* re-resolve */ }); // text sinks subscribe internally
```

`setLocale` is atomic: it awaits `adapter.setLocale(next)` (which resolves only
once `next` is loaded and active), then bumps the revision exactly once.
Concurrent calls: last caller wins; a superseded call commits nothing. On
adapter rejection the requested locale is not adopted and the rejection
propagates — but a catalog the adapter already swapped in before failing is
published, so `locale` never disagrees with the rendered strings. An adapter
with no `setLocale` cannot switch: `locale` keeps reporting the adapter's own,
and dev builds warn.

Dialogue in `i18n: true` mode retranslates the on-screen line and choices
automatically on a locale switch. With a custom `I18nAdapter`, call
`controller.retranslate()` yourself after the switch. A line still typing
restarts its typewriter (and replays that line's inline `[marker/]` beats); one
already read appears complete.

## Notes

- `values` must be JSON-safe so bindings round-trip through save/load.
- `PixiSelect.items` and `PixiRadioGroup.items` are construction-only: a later
  `update({ items })` is ignored; localization refreshes the existing labels in
  place. Recreate the component to change which options exist.
- Interpolation is whatever the adapter implements. The identity adapter
  substitutes `{token}`; a library-backed adapter gets full ICU and plurals.
- React `<SplitText autoSplit={false}>`: the React components resolve a binding
  to a string before the element sees it, so a locale switch updates the text
  without re-splitting. Call `resplit()` after the switch, or keep `autoSplit`
  on. The imperative `UISplitText` / `SplitTextComponent` re-split themselves.
