import { describe, expect, it, vi } from "vitest";
import { defineItems } from "./catalog.js";
import { filteredView } from "./filteredView.js";
import { Inventory } from "./Inventory.js";

const catalog = defineItems({
  potion: { name: "Potion", maxStack: 5, category: "consumable" },
  sword: { name: "Sword", category: "gear" },
  gem: { name: "Gem", maxStack: 99 },
});

type Id = "potion" | "sword" | "gem";

const isConsumable = (
  _stack: unknown,
  def: { category?: string | undefined },
): boolean => def.category === "consumable";

function setup(): { inventory: Inventory<Id> } {
  return { inventory: new Inventory<Id>({ catalog, capacity: 6, actions: [{ id: "use", label: "Use" }] }) };
}

describe("filteredView — the projected read surface", () => {
  it("compacts matching stacks in slot order, skipping non-matches and holes", () => {
    const { inventory } = setup();
    // setSlot places stacks verbatim (no merge), so two potion stacks stay
    // distinct — proof the compaction reads real slot order, not item counts.
    inventory.setSlot(0, { itemId: "sword", quantity: 1 }); // excluded
    inventory.setSlot(1, { itemId: "potion", quantity: 2 }); // included
    // slot 2 stays a hole
    inventory.setSlot(3, { itemId: "potion", quantity: 4 }); // included

    const view = filteredView(inventory, isConsumable);
    expect(view.slots).toEqual([
      { itemId: "potion", quantity: 2 },
      { itemId: "potion", quantity: 4 },
    ]);
    expect(view.used).toBe(2);
  });

  it("capacity is always undefined — the view has no size of its own", () => {
    const { inventory } = setup();
    const view = filteredView(inventory, isConsumable);
    expect(view.capacity).toBeUndefined();
    inventory.add("potion");
    expect(view.capacity).toBeUndefined();
  });

  it("modelSlot maps a presented index back to the real slot; out of range is undefined", () => {
    const { inventory } = setup();
    inventory.add("sword"); // slot 0
    inventory.add("potion", 2); // slot 1
    const view = filteredView(inventory, isConsumable);
    expect(view.modelSlot(0)).toBe(1);
    expect(view.modelSlot(1)).toBeUndefined();
  });

  it("catalog forwards to the underlying model's catalog", () => {
    const { inventory } = setup();
    const view = filteredView(inventory, isConsumable);
    expect(view.catalog).toBe(inventory.catalog);
  });
});

describe("filteredView — actions operate on presented indices", () => {
  it("getActions/invokeAction remap the presented slot to the model slot", () => {
    const { inventory } = setup();
    inventory.add("sword"); // slot 0 — excluded
    inventory.add("potion", 3); // slot 1 — presented as slot 0
    const view = filteredView(inventory, isConsumable);

    expect(view.getActions(0).map((a) => a.id)).toEqual(["use"]);
    expect(view.getActions(1)).toEqual([]); // past the compacted end

    const invoked = vi.fn();
    inventory.on("action", invoked);
    const result = view.invokeAction("use", 0);
    expect(result).toEqual({ ok: true });
    expect(invoked).toHaveBeenCalledWith(expect.objectContaining({ slot: 1, itemId: "potion" }));
  });

  it("invokeAction past the compacted end reports empty, without touching the model", () => {
    const { inventory } = setup();
    const view = filteredView(inventory, isConsumable);
    expect(view.invokeAction("use", 0)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("filteredView — sort and events forward to the whole model", () => {
  it("sort forwards to the underlying model (one shared array)", () => {
    const { inventory } = setup();
    inventory.add("sword");
    inventory.add("potion", 2);
    const view = filteredView(inventory, isConsumable);
    view.sort();
    expect(inventory.slots[0]?.itemId).toBe("potion"); // catalog order
  });

  it("non-changed events forward verbatim from the model (real ids/quantities/slots)", () => {
    const { inventory } = setup();
    const view = filteredView(inventory, isConsumable);
    const added: unknown[] = [];
    view.on("itemAdded", (e) => added.push(e));
    inventory.add("sword"); // not a match — the raw model event still fires
    expect(added).toEqual([{ itemId: "sword", quantity: 1, slots: [0] }]);
  });

  it("changed re-presents the compacted projection to the view's own listeners", () => {
    const { inventory } = setup();
    const view = filteredView(inventory, isConsumable);
    const seen: unknown[] = [];
    view.on("changed", (e) => seen.push(e));
    inventory.add("potion");
    expect(seen).toHaveLength(1);
    expect(view.slots).toEqual([{ itemId: "potion", quantity: 1 }]);
  });

  it("only subscribes to the model while at least one listener is attached (refcounted)", () => {
    const { inventory } = setup();
    const view = filteredView(inventory, isConsumable);
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = view.on("changed", a);
    const unsubB = view.on("changed", b);

    inventory.add("potion");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    inventory.add("potion");
    expect(a).toHaveBeenCalledTimes(1); // detached
    expect(b).toHaveBeenCalledTimes(2); // still attached

    unsubB();
    inventory.add("potion");
    expect(b).toHaveBeenCalledTimes(2); // both detached — no longer watching
  });

  it("a double unsubscribe is a no-op — the refcount stays correct", () => {
    const { inventory } = setup();
    const view = filteredView(inventory, isConsumable);
    const a = vi.fn();
    const unsubA = view.on("changed", a);
    unsubA();
    unsubA(); // must not decrement again

    const b = vi.fn();
    view.on("changed", b);
    inventory.add("potion");
    expect(b).toHaveBeenCalledTimes(1); // model forwarding still works
    expect(a).not.toHaveBeenCalled();
  });
});

describe("filteredView — the escape hatch to the underlying model", () => {
  it("exposes .source as the model it projects", () => {
    const { inventory } = setup();
    const view = filteredView(inventory, isConsumable);
    expect(view.source).toBe(inventory);
  });
});
