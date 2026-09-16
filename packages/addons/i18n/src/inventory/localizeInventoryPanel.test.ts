import { createMockScene, ErrorBoundaryKey } from "@yagejs/core";
import type {
  ActionMenuPresenter,
  ChromePresenter,
  DetailPresenter,
  InventoryChromeInfo,
  PresentedAction,
  SlotsPresenter,
  SlotView,
} from "@yagejs-addons/inventory";
import { describe, expect, it } from "vitest";
import { createLocalization } from "../core/i18next.js";
import { LocalizationKey } from "../core/Localization.js";
import { localizeInventoryPanel } from "./localizeInventoryPanel.js";

/** Recording presenters: the wrappers' collaborators under test. */
class FakeSlots implements SlotsPresenter {
  presented: (readonly SlotView[])[] = [];
  selected: number[] = [];
  onSlotChosen?: (slot: number) => void;
  mount(): void {}
  dispose(): void {}
  present(slots: readonly SlotView[]): void {
    this.presented.push(slots);
  }
  setSelected(slot: number): void {
    this.selected.push(slot);
  }
  navigate(from: number): number {
    return from;
  }
  setVisible(): void {}
  clear(): void {}
  slotAtPoint(): number {
    return 7;
  }
}
class FakeDetail implements DetailPresenter {
  presented: (SlotView | null)[] = [];
  mount(): void {}
  dispose(): void {}
  present(view: SlotView | null): void {
    this.presented.push(view);
  }
  setVisible(): void {}
  clear(): void {}
}
class FakeMenu implements ActionMenuPresenter {
  presented: { actions: readonly PresentedAction[]; slot: number }[] = [];
  highlights: number[] = [];
  visibles: boolean[] = [];
  onActionChosen?: (position: number) => void;
  mount(): void {}
  dispose(): void {}
  present(actions: readonly PresentedAction[], slot: number): void {
    this.presented.push({ actions, slot });
  }
  highlight(position: number): void {
    this.highlights.push(position);
  }
  setVisible(visible: boolean): void {
    this.visibles.push(visible);
  }
  clear(): void {}
}
class FakeChrome implements ChromePresenter {
  presented: InventoryChromeInfo[] = [];
  mount(): void {}
  dispose(): void {}
  present(info: InventoryChromeInfo): void {
    this.presented.push(info);
  }
  setVisible(): void {}
}

const KEYS = {
  item: (id: string) => `item.${id}.name`,
  description: (id: string) => `item.${id}.description`,
  action: (id: string) => `action.${id}`,
  title: "bag.title",
};
const potion: SlotView = {
  slot: 0,
  stack: { itemId: "potion", quantity: 2 } as SlotView["stack"],
  def: { id: "potion", name: "Potion", description: "Heals." },
};

async function setup() {
  const { scene, context } = createMockScene();
  const localization = await createLocalization({
    locale: "en",
    fallbackLocale: "en",
    catalogs: {
      en: {},
      it: {
        "item.potion.name": "Pozione",
        "item.potion.description": "Cura.",
        "action.use": "Usa",
        "bag.title": "Zaino",
      },
    },
  });
  context.register(LocalizationKey, localization);
  const inner = {
    slots: new FakeSlots(),
    detail: new FakeDetail(),
    actionMenu: new FakeMenu(),
    chrome: new FakeChrome(),
  };
  const bundle = localizeInventoryPanel(inner, KEYS);
  for (const p of [
    bundle.slots,
    bundle.detail!,
    bundle.actionMenu!,
    bundle.chrome!,
  ]) {
    p.mount(scene);
  }
  return { bundle, inner, localization, context };
}

describe("localizeInventoryPanel", () => {
  it("substitutes item text, action labels, and the title, and re-presents on a locale change", async () => {
    const { bundle, inner, localization } = await setup();
    bundle.slots.present([potion]);
    bundle.slots.setSelected(0);
    bundle.detail!.present(potion);
    bundle.actionMenu!.present(
      [
        { id: "use", label: "Use" },
        { id: "drop", label: "Drop" },
      ],
      0,
    );
    bundle.actionMenu!.setVisible(true);
    bundle.actionMenu!.highlight(1);
    bundle.chrome!.present({ title: "Backpack", used: 1, capacity: 4 });

    expect(inner.slots.presented[0]![0]!.def).toMatchObject({
      name: "Potion",
      description: "Heals.",
    });
    expect(inner.chrome.presented[0]!.title).toBe("Backpack");

    localization.setLocale("it");
    expect(inner.slots.presented).toHaveLength(2);
    expect(inner.slots.presented[1]![0]!.def).toMatchObject({
      id: "potion",
      name: "Pozione",
      description: "Cura.",
    });
    expect(inner.slots.selected).toEqual([0, 0]);
    expect(inner.detail.presented[1]!.def?.name).toBe("Pozione");
    expect(inner.actionMenu.presented[1]).toEqual({
      actions: [
        { id: "use", label: "Usa" },
        { id: "drop", label: "Drop" },
      ],
      slot: 0,
    });
    expect(inner.actionMenu.visibles.at(-1)).toBe(true);
    expect(inner.actionMenu.highlights.at(-1)).toBe(1);
    expect(inner.chrome.presented[1]!.title).toBe("Zaino");
  });

  it("names the channel and the scene when a presenter throws during a locale redraw", async () => {
    const { bundle, inner, localization, context } = await setup();
    bundle.detail!.present(potion);
    inner.detail.present = (): never => {
      throw new Error("boom");
    };

    expect(() => localization.setLocale("it")).toThrow("boom");
    const errors = context.resolve(ErrorBoundaryKey).getCallbackErrors();
    expect(errors.at(-1)?.kind).toBe("Localized inventory detail");
    expect(typeof errors.at(-1)?.scene).toBe("string");
  });

  it("forwards the session's commit handlers and optional pointer members to the inner presenters", async () => {
    const { bundle, inner } = await setup();
    const chosen = (): void => undefined;
    bundle.slots.onSlotChosen = chosen;
    bundle.actionMenu!.onActionChosen = chosen;
    expect(inner.slots.onSlotChosen).toBe(chosen);
    expect(inner.actionMenu.onActionChosen).toBe(chosen);
    expect(bundle.slots.slotAtPoint?.(0, 0)).toBe(7);
    expect(bundle.actionMenu!.actionAtPoint).toBeUndefined();
  });

  it("stops re-presenting after dispose and leaves an empty slot view alone", async () => {
    const { bundle, inner, localization } = await setup();
    bundle.slots.present([{ slot: 1, stack: null, def: null }]);
    expect(inner.slots.presented[0]![0]!.def).toBeNull();
    bundle.slots.dispose();
    localization.setLocale("it");
    expect(inner.slots.presented).toHaveLength(1);
  });
});
