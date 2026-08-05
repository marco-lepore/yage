import { msg, type Localization, type LocalizedBinding } from "@yagejs/core";
import { describe, expect, it, vi } from "vitest";
import { defineItems } from "./catalog.js";
import { Inventory } from "./Inventory.js";
import { defaultInventoryKeys } from "./keys.js";
import {
  InventorySession,
  type ActionMenuChannel,
  type DetailChannel,
  type InventoryChromeChannel,
  type InventoryChromeInfo,
  type NavDirection,
  type PresentedAction,
  type SlotView,
  type SlotsChannel,
} from "./session.js";

const catalog = defineItems({
  potion: { name: "Potion", description: "Restores health.", maxStack: 5 },
  sword: { name: "Sword" },
});

type Id = "potion" | "sword";

/**
 * A catalog-backed {@link Localization} double. `table` maps key → text for the
 * active locale; `setLocale` swaps tables and bumps the revision, which is what
 * a real plugin does on a locale switch.
 */
class MockLocalization implements Localization {
  locale: string;
  private rev = 0;
  private readonly listeners = new Set<() => void>();
  /** Every key `resolve` was asked for, in order. */
  readonly lookups: string[] = [];

  constructor(
    private readonly tables: Record<string, Record<string, string>>,
    initial: string,
  ) {
    this.locale = initial;
  }

  revision(): number {
    return this.rev;
  }
  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
  resolve(binding: LocalizedBinding): string {
    this.lookups.push(binding.id);
    return this.tables[this.locale]?.[binding.id] ?? binding.default ?? binding.id;
  }
  async setLocale(next: string): Promise<void> {
    this.locale = next;
    this.rev++;
    for (const l of [...this.listeners]) l();
  }
}

class MockSlots implements SlotsChannel<Id> {
  presented: SlotView<Id>[][] = [];
  present(slots: readonly SlotView<Id>[]): void {
    this.presented.push([...slots]);
  }
  setSelected(): void {}
  navigate(from: number, dir: NavDirection): number {
    return dir === "down" || dir === "right" ? from + 1 : from - 1;
  }
  setVisible(): void {}
  clear(): void {}
  get last(): SlotView<Id>[] {
    return this.presented[this.presented.length - 1] ?? [];
  }
}

class MockMenu implements ActionMenuChannel {
  presented: PresentedAction[][] = [];
  highlights: number[] = [];
  onActionChosen?: (position: number) => void;
  present(actions: readonly PresentedAction[]): void {
    this.presented.push([...actions]);
  }
  highlight(position: number): void {
    this.highlights.push(position);
  }
  setVisible(): void {}
  clear(): void {}
  get last(): PresentedAction[] {
    return this.presented[this.presented.length - 1] ?? [];
  }
}

class MockDetail implements DetailChannel<Id> {
  views: (SlotView<Id> | null)[] = [];
  present(view: SlotView<Id> | null): void {
    this.views.push(view);
  }
  setVisible(): void {}
  clear(): void {}
  get last(): SlotView<Id> | null {
    return this.views[this.views.length - 1] ?? null;
  }
}

class MockChrome implements InventoryChromeChannel {
  infos: InventoryChromeInfo[] = [];
  present(info: InventoryChromeInfo): void {
    this.infos.push(info);
  }
  setVisible(): void {}
  get last(): InventoryChromeInfo | undefined {
    return this.infos[this.infos.length - 1];
  }
}

const TABLES = {
  en: {},
  fr: {
    "inventory.item.potion.name": "Potion de vie",
    "inventory.item.potion.description": "Restaure des points de vie.",
    "inventory.action.use.label": "Utiliser",
    "bag.title": "Sac",
  },
};

function setup(
  opts: { session?: ConstructorParameters<typeof InventorySession<Id>>[2] } = {},
) {
  const inventory = new Inventory<Id>({
    catalog,
    capacity: 4,
    actions: [
      { id: "use", label: "Use" },
      { id: "drop", label: "Drop" },
    ],
  });
  const slots = new MockSlots();
  const menu = new MockMenu();
  const detail = new MockDetail();
  const chrome = new MockChrome();
  const session = new InventorySession<Id>(
    inventory,
    { slots, actionMenu: menu, detail, chrome },
    opts.session ?? {},
  );
  return { inventory, slots, menu, detail, chrome, session };
}

describe("without a localization service", () => {
  it("renders every string as authored", () => {
    const { inventory, slots, detail, chrome, session } = setup({
      session: { title: "Bag" },
    });
    inventory.add("potion", 2);
    session.open();

    expect(slots.last[0]?.name).toBe("Potion");
    expect(detail.last?.name).toBe("Potion");
    expect(detail.last?.description).toBe("Restores health.");
    expect(chrome.last?.title).toBe("Bag");
  });

  it("renders a binding title as its default", () => {
    const { chrome, session } = setup({
      session: { title: msg("bag.title", undefined, "Bag") },
    });
    session.open();
    expect(chrome.last?.title).toBe("Bag");
  });

  it("leaves description empty when the item declares none", () => {
    const { inventory, detail, session } = setup();
    inventory.add("sword");
    session.open();
    expect(detail.last?.description).toBe("");
  });
});

describe("with a localization service", () => {
  it("resolves item name and description under the default keys", () => {
    const localization = new MockLocalization(TABLES, "fr");
    const { inventory, slots, detail, session } = setup({ session: { localization } });
    inventory.add("potion");
    session.open();

    expect(slots.last[0]?.name).toBe("Potion de vie");
    expect(detail.last?.description).toBe("Restaure des points de vie.");
    expect(localization.lookups).toContain(defaultInventoryKeys.itemName("potion"));
  });

  it("falls back to the authored literal for a missing key", () => {
    const localization = new MockLocalization(TABLES, "fr");
    const { inventory, slots, session } = setup({ session: { localization } });
    inventory.add("sword");
    session.open();
    // No `inventory.item.sword.name` in the French table.
    expect(slots.last[0]?.name).toBe("Sword");
  });

  it("keeps `def` the authored definition, not the translation", () => {
    const localization = new MockLocalization(TABLES, "fr");
    const { inventory, slots, session } = setup({ session: { localization } });
    inventory.add("potion");
    session.open();
    expect(slots.last[0]?.def?.name).toBe("Potion");
    expect(slots.last[0]?.name).toBe("Potion de vie");
  });

  it("resolves action labels under the default keys", () => {
    const localization = new MockLocalization(TABLES, "fr");
    const { inventory, menu, session } = setup({ session: { localization } });
    inventory.add("potion");
    session.open();
    session.confirm();

    expect(menu.last.map((a) => a.label)).toEqual(["Utiliser", "Drop"]);
    expect(menu.last.map((a) => a.id)).toEqual(["use", "drop"]);
  });

  it("resolves a binding title, and treats a string title as a literal", () => {
    const localization = new MockLocalization(TABLES, "fr");
    const bound = setup({ session: { localization, title: msg("bag.title", undefined, "Bag") } });
    bound.session.open();
    expect(bound.chrome.last?.title).toBe("Sac");

    // A plain string is text the game already localized (or doesn't want
    // localized) — it must not be looked up as a key.
    const literal = setup({ session: { localization, title: "bag.title" } });
    literal.session.open();
    expect(literal.chrome.last?.title).toBe("bag.title");
  });

  it("honors a custom key scheme", () => {
    const localization = new MockLocalization(
      { fr: { "items/potion": "Potion de vie" } },
      "fr",
    );
    const { inventory, slots, session } = setup({
      session: {
        localization,
        keys: {
          itemName: (id) => `items/${id}`,
          itemDescription: (id) => `items/${id}/desc`,
          actionLabel: (id) => `actions/${id}`,
        },
      },
    });
    inventory.add("potion");
    session.open();
    expect(slots.last[0]?.name).toBe("Potion de vie");
  });
});

describe("relocalize", () => {
  it("re-presents every channel in the new locale", async () => {
    const localization = new MockLocalization(TABLES, "en");
    const { inventory, slots, detail, chrome, session } = setup({
      session: { localization, title: msg("bag.title", undefined, "Bag") },
    });
    inventory.add("potion");
    session.open();
    expect(slots.last[0]?.name).toBe("Potion");
    expect(chrome.last?.title).toBe("Bag");

    await localization.setLocale("fr");
    session.relocalize();

    expect(slots.last[0]?.name).toBe("Potion de vie");
    expect(detail.last?.description).toBe("Restaure des points de vie.");
    expect(chrome.last?.title).toBe("Sac");
  });

  it("preserves the cursor", () => {
    const localization = new MockLocalization(TABLES, "en");
    const { inventory, session } = setup({ session: { localization } });
    inventory.add("potion");
    inventory.add("sword");
    session.open();
    session.select(1);

    session.relocalize();
    expect(session.selection()).toBe(1);
  });

  it("re-presents an open action menu keeping the highlighted row", async () => {
    const localization = new MockLocalization(TABLES, "en");
    const { inventory, menu, session } = setup({ session: { localization } });
    inventory.add("potion");
    session.open();
    session.confirm();
    session.highlightMenu(1);
    expect(menu.last.map((a) => a.label)).toEqual(["Use", "Drop"]);

    await localization.setLocale("fr");
    session.relocalize();

    expect(session.isMenuOpen()).toBe(true);
    expect(menu.last.map((a) => a.label)).toEqual(["Utiliser", "Drop"]);
    expect(menu.highlights[menu.highlights.length - 1]).toBe(1);
  });

  it("does not re-present a closed action menu", () => {
    const localization = new MockLocalization(TABLES, "en");
    const { inventory, menu, session } = setup({ session: { localization } });
    inventory.add("potion");
    session.open();
    const before = menu.presented.length;

    session.relocalize();
    expect(menu.presented).toHaveLength(before);
  });

  it("fires no selection or confirm callbacks", () => {
    const localization = new MockLocalization(TABLES, "en");
    const onSelectionChanged = vi.fn();
    const onConfirm = vi.fn();
    const { inventory, session } = setup({
      session: { localization, onSelectionChanged, onConfirm },
    });
    inventory.add("potion");
    session.open();
    onSelectionChanged.mockClear();

    session.relocalize();
    expect(onSelectionChanged).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("is a no-op while closed or paused", () => {
    const localization = new MockLocalization(TABLES, "en");
    const { inventory, slots, session } = setup({ session: { localization } });
    inventory.add("potion");

    session.relocalize();
    expect(slots.presented).toHaveLength(0);

    session.open();
    const whileOpen = slots.presented.length;
    session.setPaused(true);
    session.relocalize();
    expect(slots.presented).toHaveLength(whileOpen);
  });
});
