/**
 * Localization — one language switch, every string retranslates live.
 *
 * YAGE owns the reactive binding, not the translation logic: you bring an i18n
 * backend (i18next / FormatJS / Fluent / `Intl` / a plain table) behind a thin
 * `LocalizationAdapter`, register a `LocalizationPlugin`, and author strings as
 * `msg(id, default?, values?)` bindings. On a locale switch every text sink —
 * UI text, buttons, @pixi/ui widgets — re-resolves on its own.
 *
 * This example wires a tiny in-memory table adapter (no external dep) so the
 * whole contract is visible in one file:
 *   • `UIText` title/subtitle + an interpolated live counter (`{n}`)
 *   • a `UIButton` whose label is a binding
 *   • a `PixiSelect` language picker whose dropdown labels are themselves
 *     localized (English → Anglais when you switch to French)
 *   • an inventory panel whose item names, descriptions, and action labels
 *     come from the same catalog, keyed by item and action id
 *
 * Dialogue localization works the same way — set `i18n: true` on a
 * `DialogueController` and each `#line:` key resolves through this same plugin.
 * See the Localization guide for that wiring.
 */
import { Engine, Scene, LocalizationPlugin, msg } from "@yagejs/core";
import type { LocalizationAdapter, JsonValue } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { UIPlugin, UISurface, PixiSelect, Anchor } from "@yagejs/ui";
import { InputPlugin } from "@yagejs/input";
import { defineItems, Inventory, InventoryController } from "@yagejs-addons/inventory";
import { createInventoryPanel } from "@yagejs-addons/inventory/presenters";
import { Graphics } from "pixi.js";
import { installDebugFromUrl, setupGameContainer } from "../shared/bootstrap.js";

// ---------------------------------------------------------------------------
// Catalogs — what a game would load from JSON per locale. `{n}` is an
// interpolation token filled from a binding's `values`.
// ---------------------------------------------------------------------------
const CATALOGS: Record<string, Record<string, string>> = {
  en: {
    "app.title": "Localization",
    "app.subtitle": "Pick a language — every string updates live.",
    "app.clicks": "Clicks: {n}",
    "app.clickBtn": "Click me",
    "lang.en": "English",
    "lang.fr": "French",
  },
  fr: {
    "app.title": "Localisation",
    "app.subtitle": "Choisissez une langue — tout se met à jour en direct.",
    "app.clicks": "Clics : {n}",
    "app.clickBtn": "Cliquez-moi",
    "lang.en": "Anglais",
    "lang.fr": "Français",
    // Inventory keys are derived from the item and action ids — the addon looks
    // these up on its own, no per-string wiring.
    "bag.title": "Sac",
    "inventory.item.potion.name": "Potion de vie",
    "inventory.item.potion.description": "Restaure 20 points de vie.",
    "inventory.item.key.name": "Clé rouillée",
    "inventory.item.key.description": "Ouvre quelque chose, quelque part.",
    "inventory.action.use.label": "Utiliser",
    "inventory.action.drop.label": "Jeter",
  },
};

const LOCALES = ["en", "fr"] as const;

// Items carry the English text inline. It doubles as the fallback, so this
// catalog renders untranslated with no localization plugin at all.
const ITEMS = defineItems({
  potion: {
    name: "Health Potion",
    description: "Restores 20 health.",
    maxStack: 5,
    color: 0xef4444,
  },
  key: {
    name: "Rusty Key",
    description: "Opens something, somewhere.",
    color: 0xfbbf24,
  },
});
type ItemId = "potion" | "key";

// ---------------------------------------------------------------------------
// The adapter YAGE calls. A real game delegates `t()` to its i18n library and
// `setLocale()` to the library's async catalog load. Here it's a plain table.
// ---------------------------------------------------------------------------
class TableAdapter implements LocalizationAdapter {
  private _locale = "en";
  private readonly listeners = new Set<() => void>();

  get locale(): string {
    return this._locale;
  }

  t(
    id: string,
    fallback: string | undefined,
    values?: Record<string, JsonValue>,
  ): string {
    const template = CATALOGS[this._locale]?.[id] ?? fallback ?? id;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
      Object.hasOwn(values, key) ? String(values[key]) : whole,
    );
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  setLocale(next: string): void {
    this._locale = next;
    // Notify the plugin the catalog changed. During a driven `setLocale` the
    // plugin coalesces this into its single revision bump.
    this.listeners.forEach((l) => l());
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class LocalizationScene extends Scene {
  readonly name = "localization";

  constructor(private readonly localization: LocalizationPlugin) {
    super();
  }

  onEnter(): void {
    let clicks = 0;
    const surface = this.spawn("panel").add(
      new UISurface({
        // Left band, fixed width: a longer translation wraps instead of
        // widening the panel into the inventory beside it.
        anchor: Anchor.CenterLeft,
        offset: { x: 24, y: 0 },
        width: 320,
        direction: "column",
        gap: 14,
        padding: 24,
        alignItems: "center",
        background: { color: 0x1e293b, alpha: 0.92, radius: 10 },
      }),
    );

    surface.text(msg("app.title", "Localization"), {
      fontSize: 30,
      fill: "#ffffff",
    });
    surface.text(msg("app.subtitle", ""), {
      fontSize: 15,
      fill: "#9ca3af",
    });

    // Interpolated, reactive: the counter re-resolves on locale change AND
    // whenever we rebuild the binding with a new `n`.
    const clicksText = surface.text(
      msg("app.clicks", "Clicks: {n}", { n: clicks }),
      { fontSize: 20, fill: "#f1f5f9" },
    );

    surface.button(msg("app.clickBtn", "Click me"), {
      width: 220,
      height: 42,
      textStyle: { fontSize: 16, fill: "#0b1120" },
      background: { color: 0x38bdf8, radius: 8 },
      onClick: () => {
        clicks += 1;
        clicksText.setText(msg("app.clicks", "Clicks: {n}", { n: clicks }));
      },
    });

    // Language picker (@pixi/ui Select). The dropdown labels are localized, so
    // "English / French" become "Anglais / Français" once you switch to French.
    surface.addElement(this.languagePicker());

    // Inventory: item names, descriptions, and action labels come from the same
    // catalog, keyed by item/action id. The panel re-presents on a locale
    // switch, keeping the cursor and any open action menu.
    const inventory = new Inventory<ItemId>({
      catalog: ITEMS,
      capacity: 8,
      actions: [
        { id: "use", label: "Use", consumes: true },
        { id: "drop", label: "Drop" },
      ],
    });
    inventory.add("potion", 3);
    inventory.add("key");

    this.spawn("bag").add(
      new InventoryController<ItemId>({
        ...createInventoryPanel(),
        inventory,
        title: msg("bag.title", "Bag"),
        openOnAdd: true,
      }),
    );
  }

  private languagePicker(): PixiSelect {
    const bg = (color: number): Graphics =>
      new Graphics().roundRect(0, 0, 220, 40, 8).fill(color);
    return new PixiSelect({
      width: 220,
      height: 40,
      closedBG: bg(0x334155),
      openBG: bg(0x1e293b),
      textStyle: { fontSize: 16, fill: "#ffffff" },
      itemTextStyle: { fontSize: 16, fill: "#ffffff" },
      itemWidth: 220,
      itemHeight: 36,
      itemBG: 0x334155,
      itemHoverBG: 0x475569,
      items: [
        msg("lang.en", "English"),
        msg("lang.fr", "French"),
      ],
      onSelect: (index) => {
        void this.localization.setLocale(LOCALES[index] ?? "en");
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: 1000,
      height: 600,
      virtualWidth: 1000,
      virtualHeight: 600,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(1000, 600),
    }),
  );
  engine.use(
    new UIPlugin({
      defaultTextStyle: { fontFamily: "system-ui, sans-serif", fill: "#e5e7eb" },
    }),
  );
  // The inventory panel drives its cursor and action menu from these actions.
  engine.use(
    new InputPlugin({
      actions: {
        interact: ["KeyE", "Enter"],
        "move-up": ["ArrowUp", "KeyW"],
        "move-down": ["ArrowDown", "KeyS"],
        "move-left": ["ArrowLeft", "KeyA"],
        "move-right": ["ArrowRight", "KeyD"],
        cancel: ["Escape"],
      },
    }),
  );

  const localization = new LocalizationPlugin({ adapter: new TableAdapter() });
  engine.use(localization);

  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new LocalizationScene(localization));
}

main().catch(console.error);
