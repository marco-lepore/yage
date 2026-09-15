# @yagejs-addons/i18n

Localization for YAGE: `msg(key, fallback, values?)` message descriptors, an
i18next-backed `Localization` service, a plugin that re-resolves every
localized text when the language changes, and one localized class per engine
text surface — renderer text, imperative UI, React UI, dialogue, and the
inventory panel. Switch language mid-line and the text swaps in place; nothing
replays.

```bash
npm install @yagejs-addons/i18n
```

Subpaths keep the root free of pixi and React: `.`, `./renderer`, `./ui`,
`./ui-react`, `./inventory`.

```ts
import {
  createLocalization,
  LocalizationPlugin,
  msg,
} from "@yagejs-addons/i18n";
import { LocalizedTextComponent } from "@yagejs-addons/i18n/renderer";

const localization = await createLocalization({
  locale: "en",
  fallbackLocale: "en",
  catalogs,
});
engine.use(new LocalizationPlugin(localization));
hud.add(
  new LocalizedTextComponent({ message: msg("hud.hp", "HP {hp}", { hp: 55 }) }),
);
localization.setLocale("it");
```

Docs: `docs/llms/i18n.md` in this package, and the Localization page on
yage.dev.
