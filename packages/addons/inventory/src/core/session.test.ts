import { describe, expect, it, vi } from "vitest";
import { defineItems } from "./catalog.js";
import { filteredView } from "./filteredView.js";
import { Inventory } from "./Inventory.js";
import {
  InventorySession,
  type ActionMenuChannel,
  type DetailChannel,
  type InventoryChromeChannel,
  type NavDirection,
  type PresentedAction,
  type SlotView,
  type SlotsChannel,
} from "./session.js";

const catalog = defineItems({
  potion: { name: "Potion", maxStack: 5, category: "consumable" },
  sword: { name: "Sword", category: "gear" },
  gem: { name: "Gem", maxStack: 99 },
});

type Id = "potion" | "sword" | "gem";

/** Linear-geometry slots double: down/right +1, up/left -1, clamped. */
class MockSlots implements SlotsChannel<Id> {
  presented: SlotView<Id>[][] = [];
  selectedCalls: number[] = [];
  visible: boolean | undefined;
  cleared = 0;
  onSlotChosen?: (slot: number) => void;

  present(slots: readonly SlotView<Id>[]): void {
    this.presented.push([...slots]);
  }
  setSelected(slot: number): void {
    this.selectedCalls.push(slot);
  }
  navigate(from: number, dir: NavDirection): number {
    const delta = dir === "down" || dir === "right" ? 1 : -1;
    return from + delta;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  clear(): void {
    this.cleared++;
  }
  get lastPresented(): SlotView<Id>[] {
    return this.presented[this.presented.length - 1] ?? [];
  }
}

class MockMenu implements ActionMenuChannel {
  presented: { actions: PresentedAction[]; slot: number }[] = [];
  highlights: number[] = [];
  visible: boolean | undefined;
  cleared = 0;
  ticks = 0;
  onActionChosen?: (position: number) => void;

  update(): void {
    this.ticks++;
  }

  present(actions: readonly PresentedAction[], slot: number): void {
    this.presented.push({ actions: [...actions], slot });
  }
  highlight(position: number): void {
    this.highlights.push(position);
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  clear(): void {
    this.cleared++;
  }
}

class MockDetail implements DetailChannel<Id> {
  views: (SlotView<Id> | null)[] = [];
  visible: boolean | undefined;
  ticks = 0;
  update(): void {
    this.ticks++;
  }
  present(view: SlotView<Id> | null): void {
    this.views.push(view);
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  clear(): void {}
  get last(): SlotView<Id> | null {
    return this.views[this.views.length - 1] ?? null;
  }
}

class MockChrome implements InventoryChromeChannel {
  infos: { title: string | undefined; used: number; capacity: number | undefined }[] = [];
  visible: boolean | undefined;
  present(info: { title: string | undefined; used: number; capacity: number | undefined }): void {
    this.infos.push(info);
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
}

function setup(opts: {
  capacity?: number;
  actions?: ConstructorParameters<typeof Inventory<Id>>[0]["actions"];
  session?: ConstructorParameters<typeof InventorySession<Id>>[2];
} = {}) {
  const inventory = new Inventory<Id>({
    catalog,
    capacity: opts.capacity ?? 6,
    ...(opts.actions ? { actions: opts.actions } : {}),
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

describe("lifecycle", () => {
  it("starts closed with every channel hidden", () => {
    const { session, slots, menu, detail, chrome } = setup();
    expect(session.isOpen()).toBe(false);
    expect(slots.visible).toBe(false);
    expect(menu.visible).toBe(false);
    expect(detail.visible).toBe(false);
    expect(chrome.visible).toBe(false);
    expect(slots.presented).toHaveLength(0);
  });

  it("open presents state and shows channels; close hides", () => {
    const { session, inventory, slots, chrome, detail } = setup();
    inventory.add("potion", 3);
    const onOpened = vi.fn();
    const onClosed = vi.fn();
    const s2 = new InventorySession<Id>(inventory, { slots }, { onOpened, onClosed });

    s2.open();
    expect(s2.isOpen()).toBe(true);
    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(slots.visible).toBe(true);
    expect(slots.lastPresented).toHaveLength(6); // capacity entries, empties included
    expect(slots.lastPresented[0]?.stack?.quantity).toBe(3);
    expect(slots.lastPresented[0]?.def?.name).toBe("Potion");
    expect(slots.lastPresented[1]?.stack).toBeNull();

    s2.open(); // idempotent
    expect(onOpened).toHaveBeenCalledTimes(1);

    s2.close();
    expect(slots.visible).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);

    session.toggle();
    expect(session.isOpen()).toBe(true);
    expect(chrome.visible).toBe(true);
    expect(detail.visible).toBe(true);
  });

  it("chrome receives title and slot usage", () => {
    const { session, inventory, chrome } = setup({ session: { title: "Items" } });
    inventory.add("potion", 2);
    session.open();
    expect(chrome.infos.at(-1)).toEqual({ title: "Items", used: 1, capacity: 6 });
    session.setTitle("Backpack");
    expect(chrome.infos.at(-1)?.title).toBe("Backpack");
  });
});

describe("selection", () => {
  it("moves via the channel's geometry and reports changes", () => {
    const changes: { slot: number; itemId: Id | null }[] = [];
    const { session, inventory, slots, detail } = setup({
      session: { onSelectionChanged: (e) => changes.push(e) },
    });
    inventory.add("potion");
    session.open();
    session.move("down");
    session.move("down");
    session.move("up");
    expect(slots.selectedCalls.slice(-3)).toEqual([1, 2, 1]);
    expect(changes.map((c) => c.slot)).toEqual([1, 2, 1]);
    expect(changes[0]?.itemId).toBeNull();
    expect(detail.last?.slot).toBe(1);
  });

  it("clamps to the slot range and dedupes no-moves", () => {
    const changes = vi.fn();
    const { session } = setup({ capacity: 2, session: { onSelectionChanged: changes } });
    session.open();
    session.move("up"); // -1 -> clamped to 0, no change event
    expect(changes).not.toHaveBeenCalled();
    session.move("down");
    session.move("down"); // 2 -> clamped to 1, no second event
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("select() ignores hovers while the menu is open", () => {
    const { session, inventory } = setup({ actions: [{ id: "drop", label: "Drop" }] });
    inventory.add("potion");
    session.open();
    session.confirm(); // opens menu on slot 0
    session.select(3);
    expect(session.selection()).toBe(0);
  });
});

describe("action menu", () => {
  const actions = [
    { id: "use", label: "Use", consumes: true },
    { id: "drop", label: "Drop" },
  ];

  it("confirm opens the menu only when the stack offers actions", () => {
    const { session, inventory, menu } = setup({ actions });
    session.open();
    session.confirm(); // empty slot -> no menu
    expect(session.isMenuOpen()).toBe(false);
    expect(menu.presented).toHaveLength(0);

    inventory.add("potion");
    session.confirm();
    expect(session.isMenuOpen()).toBe(true);
    expect(menu.presented.at(-1)).toEqual({
      actions: [
        { id: "use", label: "Use" },
        { id: "drop", label: "Drop" },
      ],
      slot: 0,
    });
    expect(menu.visible).toBe(true);
    expect(menu.highlights.at(-1)).toBe(0);
  });

  it("up/down move the highlight with wrap; left/right are inert", () => {
    const { session, inventory, menu } = setup({ actions });
    inventory.add("potion");
    session.open();
    session.confirm();
    session.move("down");
    expect(menu.highlights.at(-1)).toBe(1);
    session.move("down"); // wraps
    expect(menu.highlights.at(-1)).toBe(0);
    session.move("up"); // wraps back
    expect(menu.highlights.at(-1)).toBe(1);
    session.move("left");
    expect(menu.highlights.at(-1)).toBe(1);
  });

  it("confirm invokes the highlighted action through the model", () => {
    const { session, inventory, menu } = setup({ actions });
    inventory.add("potion", 3);
    const invoked = vi.fn();
    inventory.on("action", invoked);
    session.open();
    session.confirm();
    session.confirm(); // "use", consumes 1
    expect(invoked).toHaveBeenCalledWith({
      actionId: "use",
      slot: 0,
      itemId: "potion",
      quantity: 3,
      consumes: true,
    });
    expect(inventory.count("potion")).toBe(2);
    expect(session.isMenuOpen()).toBe(false);
    expect(menu.cleared).toBeGreaterThan(0);
  });

  it("an action with closes shuts the whole inventory", () => {
    const closing = [{ id: "use", label: "Use", closes: true }];
    const { session, inventory } = setup({ actions: closing });
    inventory.add("potion");
    session.open();
    session.confirm();
    session.confirm();
    expect(session.isOpen()).toBe(false);
  });

  it("re-resolves the menu when the model changes underneath it", () => {
    const onlyWhenTwo = [
      {
        id: "pair",
        label: "Pair",
        available: (ctx: { stack: { quantity: number } }) => ctx.stack.quantity >= 2,
      },
      { id: "drop", label: "Drop" },
    ];
    const { session, inventory, menu } = setup({ actions: onlyWhenTwo });
    inventory.add("potion", 2);
    session.open();
    session.confirm();
    expect(menu.presented.at(-1)?.actions.map((a) => a.id)).toEqual(["pair", "drop"]);
    inventory.removeAt(0, 1); // quantity drops to 1 -> "pair" gone
    expect(session.isMenuOpen()).toBe(true);
    expect(menu.presented.at(-1)?.actions.map((a) => a.id)).toEqual(["drop"]);
    inventory.removeAt(0); // stack gone -> menu closes
    expect(session.isMenuOpen()).toBe(false);
  });

  it("pointer paths: confirmSlot, highlightMenu, confirmAction, onActionChosen", () => {
    const { session, inventory, menu } = setup({ actions });
    inventory.add("potion", 3);
    inventory.setSlot(2, { itemId: "gem", quantity: 4 });
    session.open();
    session.confirmSlot(2);
    expect(session.selection()).toBe(2);
    expect(session.isMenuOpen()).toBe(true);
    session.highlightMenu(1);
    expect(menu.highlights.at(-1)).toBe(1);
    menu.onActionChosen?.(1); // presenter-owned commit path -> "drop"
    const dropped = vi.fn();
    expect(session.isMenuOpen()).toBe(false);
    inventory.on("action", dropped);
    session.confirmSlot(0);
    session.confirmAction(0);
    expect(dropped).toHaveBeenCalledWith(expect.objectContaining({ actionId: "use", slot: 0 }));
  });
});

describe("cancel", () => {
  it("closes menu first, then the inventory (closeOnCancel default)", () => {
    const onCancel = vi.fn();
    const { session, inventory } = setup({
      actions: [{ id: "drop", label: "Drop" }],
      session: { onCancel },
    });
    inventory.add("potion");
    session.open();
    session.confirm();
    session.cancel();
    expect(session.isMenuOpen()).toBe(false);
    expect(session.isOpen()).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    session.cancel();
    expect(session.isOpen()).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("closeOnCancel: false leaves it open for the host", () => {
    const onCancel = vi.fn();
    const { session } = setup({ session: { closeOnCancel: false, onCancel } });
    session.open();
    session.cancel();
    expect(session.isOpen()).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("model sync", () => {
  it("refreshes views on model changes while open, not while closed", () => {
    const { session, inventory, slots } = setup();
    inventory.add("potion");
    const before = slots.presented.length;
    session.open();
    inventory.add("gem", 3);
    expect(slots.presented.length).toBeGreaterThan(before);
    const openCount = slots.presented.length;
    session.close();
    inventory.add("gem", 3);
    expect(slots.presented.length).toBe(openCount);
  });

  it("keeps the cursor clamped when an unbounded inventory shrinks", () => {
    const inventory = new Inventory<Id>({ catalog, autoCompact: true });
    const slots = new MockSlots();
    const session = new InventorySession<Id>(inventory, { slots });
    inventory.add("potion", 5); // maxStack 5 -> 1 slot
    inventory.setSlot(1, { itemId: "sword", quantity: 1 });
    session.open();
    session.move("down");
    expect(session.selection()).toBe(1);
    inventory.removeAt(1); // shrinks to 1 slot
    expect(session.selection()).toBe(0);
  });

  it("onConfirm fires for picker flows, with the empty-slot case null", () => {
    const confirmed: { slot: number; itemId: Id | null }[] = [];
    const { session, inventory } = setup({ session: { onConfirm: (e) => confirmed.push(e) } });
    inventory.add("potion");
    session.open();
    session.confirm();
    session.move("down");
    session.confirm();
    expect(confirmed).toEqual([
      { slot: 0, itemId: "potion" },
      { slot: 1, itemId: null },
    ]);
  });

  it("setSource swaps the model, retitles, resets the cursor, rewires events", () => {
    const { session, inventory, slots, chrome } = setup({ session: { title: "Items" } });
    const pouch = new Inventory<Id>({ catalog, capacity: 3 });
    pouch.add("gem", 9);
    inventory.add("potion");
    session.open();
    session.move("down");
    expect(session.selection()).toBe(1);

    session.setSource(pouch, { title: "Pouch" });
    expect(session.selection()).toBe(0);
    expect(chrome.infos.at(-1)).toMatchObject({ title: "Pouch", capacity: 3 });
    expect(slots.lastPresented).toHaveLength(3);
    expect(slots.lastPresented[0]?.stack?.itemId).toBe("gem");

    const count = slots.presented.length;
    inventory.add("potion"); // old model — no longer watched
    expect(slots.presented.length).toBe(count);
    pouch.add("gem"); // new model — watched
    expect(slots.presented.length).toBeGreaterThan(count);
  });

  it("sort() uses the configured comparator through the model", () => {
    const { session, inventory } = setup();
    inventory.add("sword");
    inventory.add("potion", 2);
    session.open();
    session.sort();
    expect(inventory.slots[0]?.itemId).toBe("potion"); // catalog order
  });

  it("sort() works while closed — the model is always live", () => {
    const { session, inventory } = setup();
    inventory.add("sword");
    inventory.add("potion", 2);
    session.sort();
    expect(inventory.slots[0]?.itemId).toBe("potion");
  });

  it("update(dt) reaches every channel that animates", () => {
    const { session, detail, menu } = setup();
    session.update(0.016);
    expect(detail.ticks).toBe(1);
    expect(menu.ticks).toBe(1);
  });

  it("dispose releases the model subscription", () => {
    const { session, inventory, slots } = setup();
    session.open();
    const count = slots.presented.length;
    session.dispose();
    inventory.add("potion");
    expect(slots.presented.length).toBe(count);
  });
});

describe("driven by a filteredView (InventorySource projection)", () => {
  /** Only "potion" declares `category: "consumable"` in the shared catalog. */
  const consumableOnly = (
    _stack: unknown,
    def: { category?: string | undefined },
  ): boolean => def.category === "consumable";

  it("presents a compacted, hole-free subset; confirm/invokeAction map back to the model slot", () => {
    const inventory = new Inventory<Id>({
      catalog,
      capacity: 6,
      actions: [{ id: "use", label: "Use", consumes: true }],
    });
    inventory.add("sword"); // slot 0 — filtered out
    inventory.add("potion", 3); // slot 1 — the only match
    inventory.add("gem", 5); // slot 2 — filtered out

    const view = filteredView(inventory, consumableOnly);
    const slots = new MockSlots();
    const menu = new MockMenu();
    const session = new InventorySession<Id>(view, { slots, actionMenu: menu });
    session.open();

    expect(slots.lastPresented).toHaveLength(1); // compacted: only the match
    expect(slots.lastPresented[0]?.stack?.itemId).toBe("potion");
    expect(view.modelSlot(0)).toBe(1); // the real backpack slot

    session.confirm(); // opens the menu on presented slot 0 -> model slot 1
    expect(menu.presented.at(-1)?.slot).toBe(0); // the menu itself stays in presented space
    session.confirm(); // invokes "use" — consumes 1 unit from the REAL model
    expect(inventory.slots[1]?.quantity).toBe(2);
  });

  it("re-presents a compacted view as the underlying model changes", () => {
    const inventory = new Inventory<Id>({ catalog, capacity: 4 });
    const view = filteredView(inventory, consumableOnly);
    const slots = new MockSlots();
    const session = new InventorySession<Id>(view, { slots });
    session.open();
    expect(slots.lastPresented).toHaveLength(0);

    inventory.add("potion", 2);
    expect(slots.lastPresented).toHaveLength(1);

    inventory.add("sword"); // not a match — the view stays at 1
    expect(slots.lastPresented).toHaveLength(1);
  });

  it("stops watching the model once the last listener detaches (refcounted)", () => {
    const inventory = new Inventory<Id>({ catalog, capacity: 4 });
    const view = filteredView(inventory, consumableOnly);
    const seen: unknown[] = [];
    const unsub = view.on("changed", (e) => seen.push(e));
    inventory.add("potion");
    expect(seen).toHaveLength(1);
    unsub();
    inventory.add("potion");
    expect(seen).toHaveLength(1); // no longer watching
  });
});
