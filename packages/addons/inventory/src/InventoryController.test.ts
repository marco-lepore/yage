import { describe, expect, it, vi } from "vitest";
import { createMockScene } from "@yagejs/core";
import { InputManagerKey, type InputManager } from "@yagejs/input";
import { defineItems } from "./core/catalog.js";
import { filteredView } from "./core/filteredView.js";
import { Inventory } from "./core/Inventory.js";
import type { InventorySource } from "./core/InventorySource.js";
import { InventoryController } from "./InventoryController.js";
import type { InputBinding } from "./input/index.js";
import type {
  ActionMenuPresenter,
  DetailPresenter,
  ChromePresenter,
  SlotsPresenter,
} from "./adapter.js";
import type { NavDirection, SlotView } from "./core/session.js";
import {
  InventoryActionEvent,
  InventoryChangedEvent,
  InventoryClosedEvent,
  InventoryItemAddedEvent,
  InventoryOpenedEvent,
  InventoryRejectedEvent,
  InventorySelectionChangedEvent,
} from "./events.js";

const catalog = defineItems({
  potion: { name: "Potion", maxStack: 5 },
  sword: { name: "Sword" },
});
type Id = "potion" | "sword";

class StubSlots implements SlotsPresenter<Id> {
  mounted = 0;
  disposed = 0;
  presented: SlotView<Id>[][] = [];
  onSlotChosen?: (slot: number) => void;
  slotAtPoint?: (x: number, y: number) => number | undefined;
  /** Was the diagnostics sink wired before mount() ran? (mount-time warnings
   *  need it in place — see the setDiagnostics-before-mount ordering). */
  diagnosticsBeforeMount = false;
  private warn?: (message: string) => void;
  mount(): void {
    this.mounted++;
    this.diagnosticsBeforeMount = this.warn !== undefined;
  }
  setDiagnostics(warn: (message: string) => void): void {
    this.warn = warn;
  }
  dispose(): void {
    this.disposed++;
  }
  present(slots: readonly SlotView<Id>[]): void {
    this.presented.push([...slots]);
  }
  setSelected(): void {}
  navigate(from: number, dir: NavDirection): number {
    return dir === "down" || dir === "right" ? from + 1 : from - 1;
  }
  setVisible(): void {}
  clear(): void {}
}

class StubChrome implements ChromePresenter {
  mount(): void {}
  dispose(): void {}
  present(): void {}
  setVisible(): void {}
}

class StubDetail implements DetailPresenter<Id> {
  mount(): void {}
  dispose(): void {}
  present(): void {}
  setVisible(): void {}
  clear(): void {}
}

class StubMenu implements ActionMenuPresenter {
  onActionChosen?: (position: number) => void;
  mount(): void {}
  dispose(): void {}
  present(): void {}
  highlight(): void {}
  setVisible(): void {}
  clear(): void {}
}

class RecordingBinding implements InputBinding {
  polls = 0;
  bind(): void {}
  poll(): void {
    this.polls++;
  }
}

function makeInventory(): Inventory<Id> {
  return new Inventory<Id>({
    catalog,
    capacity: 4,
    actions: [{ id: "drop", label: "Drop" }],
  });
}

function makeController(
  inventory = makeInventory(),
  extra: Partial<ConstructorParameters<typeof InventoryController<Id>>[0]> = {},
) {
  const slots = new StubSlots();
  const controller = new InventoryController<Id>({
    slots,
    chrome: new StubChrome(),
    detail: new StubDetail(),
    actionMenu: new StubMenu(),
    inventory,
    input: null,
    ...extra,
  });
  return { controller, slots, inventory };
}

describe("lifecycle guards", () => {
  it("open() before the component is added throws a clear error", () => {
    const { controller } = makeController();
    expect(() => controller.open()).toThrow(/before the component was added/);
  });

  it("open() after removal warns and refuses instead of running into disposed presenters", () => {
    const { scene } = createMockScene();
    const { controller, slots } = makeController();
    const host = scene.spawn("inventory-host");
    host.add(controller);
    expect(slots.mounted).toBe(1);

    host.remove(InventoryController);
    expect(slots.disposed).toBe(1);

    controller.open(); // stale reference
    expect(controller.isOpen()).toBe(false);
  });

  it("wires the diagnostics sink before mounting so mount-time warnings can fire", () => {
    const { scene } = createMockScene();
    const { controller, slots } = makeController();
    scene.spawn("inv").add(controller);
    expect(slots.diagnosticsBeforeMount).toBe(true);
  });

  it("post-destroy public methods no-op instead of driving the disposed session", () => {
    const { scene } = createMockScene();
    const inventory = makeInventory();
    const { controller } = makeController(inventory);
    const host = scene.spawn("inv");
    host.add(controller);
    inventory.add("sword"); // slot 0
    inventory.add("potion"); // slot 1

    host.remove(InventoryController);

    // Every convenience method drives `session?.x()`; with the session cleared
    // they must no-op, not run into torn-down presenters.
    expect(() => {
      controller.close();
      controller.move("down");
      controller.select(1);
      controller.confirm();
      controller.cancel();
      controller.setInputEnabled(false);
      controller.sort();
    }).not.toThrow();
    expect(controller.selection()).toBe(0);
    // sort() must NOT reorder the model after teardown (catalog order would put
    // potion in slot 0).
    expect(inventory.slots[0]?.itemId).toBe("sword");
  });
});

describe("engine events", () => {
  it("mirrors session lifecycle + selection onto the entity", () => {
    const { scene } = createMockScene();
    const { controller } = makeController();
    const host = scene.spawn("inv");
    host.add(controller);

    const opened = vi.fn();
    const closed = vi.fn();
    const selections: { slot: number; itemId: string | null }[] = [];
    host.on(InventoryOpenedEvent, opened);
    host.on(InventoryClosedEvent, closed);
    host.on(InventorySelectionChangedEvent, (e) => selections.push(e));

    controller.open();
    controller.move("down");
    controller.close();

    expect(opened).toHaveBeenCalledTimes(1);
    expect(selections).toEqual([{ slot: 1, itemId: null }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("mirrors model events onto the entity even while the panel is closed", () => {
    const { scene } = createMockScene();
    const inventory = makeInventory();
    const { controller } = makeController(inventory);
    const host = scene.spawn("inv");
    host.add(controller);

    const added: { itemId: string; quantity: number; slots: readonly number[] }[] = [];
    const changed = vi.fn();
    const rejections: { itemId: string; quantity: number; reason: string }[] = [];
    host.on(InventoryItemAddedEvent, (e) => added.push(e));
    host.on(InventoryChangedEvent, changed);
    host.on(InventoryRejectedEvent, (e) => rejections.push(e));

    inventory.add("potion", 3); // UI never opened
    expect(added).toEqual([{ itemId: "potion", quantity: 3, slots: [0] }]);
    expect(changed).toHaveBeenCalledTimes(1);

    inventory.add("sword", 9); // 4 slots, 1 used, unstackable sword -> 3 land, 6 rejected
    expect(rejections).toEqual([{ itemId: "sword", quantity: 6, reason: "capacity" }]);
  });

  it("emits the action event when the menu flow invokes an action", () => {
    const { scene } = createMockScene();
    const inventory = makeInventory();
    const { controller } = makeController(inventory);
    const host = scene.spawn("inv");
    host.add(controller);

    // `consumes` typed here on purpose: the mirror forwards it at runtime, so
    // it must be on InventoryActionEvent's payload type too — this push fails
    // to compile if the field is dropped from the event.
    const actions: {
      actionId: string;
      slot: number;
      itemId: string;
      quantity: number;
      consumes: boolean;
    }[] = [];
    host.on(InventoryActionEvent, (e) => actions.push(e));

    inventory.add("potion", 2);
    controller.open();
    controller.confirm(); // opens the drop menu
    expect(controller.isMenuOpen()).toBe(true);
    controller.confirm(); // invokes "drop"
    expect(actions).toEqual([
      { actionId: "drop", slot: 0, itemId: "potion", quantity: 2, consumes: false },
    ]);
  });

  it("setSource re-mirrors events onto the new model only", () => {
    const { scene } = createMockScene();
    const first = makeInventory();
    const second = makeInventory();
    const { controller } = makeController(first);
    const host = scene.spawn("inv");
    host.add(controller);

    const changed = vi.fn();
    host.on(InventoryChangedEvent, changed);

    controller.setSource(second);
    expect(controller.inventory).toBe(second);
    first.add("potion");
    expect(changed).not.toHaveBeenCalled();
    second.add("potion");
    expect(changed).toHaveBeenCalledTimes(1);

    host.remove(InventoryController);
    second.add("potion"); // after destroy: mirror released
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("input focus", () => {
  it("setInputEnabled gates the binding poll", () => {
    const { scene } = createMockScene();
    const binding = new RecordingBinding();
    const { controller } = makeController(makeInventory(), { input: binding });
    scene.spawn("inv").add(controller);

    controller.update(0.016);
    expect(binding.polls).toBe(1);
    controller.setInputEnabled(false);
    controller.update(0.016);
    expect(binding.polls).toBe(1);
    controller.setInputEnabled(true);
    controller.update(0.016);
    expect(binding.polls).toBe(2);
  });

  it("input: null attaches no binding and update still runs", () => {
    const { scene } = createMockScene();
    const { controller } = makeController();
    scene.spawn("inv").add(controller);
    expect(() => controller.update(0.016)).not.toThrow();
  });

  it("setInputEnabled(false) closes an open action menu (nothing could dismiss it)", () => {
    const { scene } = createMockScene();
    const inventory = makeInventory();
    const { controller } = makeController(inventory);
    scene.spawn("inv").add(controller);
    inventory.add("potion");
    controller.open();
    controller.confirm();
    expect(controller.isMenuOpen()).toBe(true);

    controller.setInputEnabled(false);
    expect(controller.isMenuOpen()).toBe(false);
    expect(controller.isOpen()).toBe(true); // only the menu closes, not the panel
  });
});

describe("zero-config input", () => {
  /** Structural InputManager fake, registered on the mock scene's context so
   *  the controller's default binding has a device to bind to. */
  function fakeInput() {
    const pressed = new Set<string>();
    let pointer = { x: -1, y: -1 };
    const downHandlers: ((info: { button: number }) => void)[] = [];
    const fake = {
      isJustPressed: (a: string) => pressed.has(a),
      isPressed: () => false,
      onPointerDown: (fn: (info: { button: number }) => void) => {
        downHandlers.push(fn);
        return () => {};
      },
      getPointerScreenPosition: () => pointer,
      getPointerPosition: () => pointer,
      getActionNames: () => ["interact", "inventory", "cancel"],
    };
    return {
      manager: fake as unknown as InputManager,
      press: (a: string) => pressed.add(a),
      release: () => pressed.clear(),
      click: (x: number, y: number) => {
        pointer = { x, y };
        for (const fn of downHandlers) fn({ button: 0 });
      },
    };
  }

  it("omitting `input` wires keyboard AND pointer to the controller's own presenters", () => {
    const { scene } = createMockScene();
    const input = fakeInput();
    scene.context.register(InputManagerKey, input.manager);

    const inventory = makeInventory();
    const slots = new StubSlots();
    slots.slotAtPoint = (x, y) => (x === 42 && y === 42 ? 0 : undefined);
    const controller = new InventoryController({
      slots,
      actionMenu: new StubMenu(),
      inventory,
      // no `input` — the default must include working pointer hit-testing
    });
    scene.spawn("inv").add(controller);
    inventory.add("potion");

    // Keyboard path: the toggle action opens the panel.
    input.press("inventory");
    controller.update(0.016);
    input.release();
    expect(controller.isOpen()).toBe(true);

    // Pointer path: a click that hit-tests to slot 0 opens its action menu —
    // proof the default binding was wired to THIS bundle's slots presenter.
    input.click(42, 42);
    controller.update(0.016);
    expect(controller.isMenuOpen()).toBe(true);
  });

  it("infers the item-id type from `inventory` with no explicit type argument", () => {
    const { scene } = createMockScene();
    const inventory = makeInventory();
    const controller = new InventoryController({
      slots: new StubSlots(),
      inventory,
      input: null,
    });
    scene.spawn("inv").add(controller);
    // Compile-time assertion: TId flowed from the inventory, not the bundle —
    // `controller.inventory` is `InventorySource<Id>`; the local `inventory`
    // passed in stays the concrete `Inventory<Id>`.
    const source: InventorySource<Id> = controller.inventory;
    expect(source.used).toBe(0);
    expect(inventory.count("potion")).toBe(0);
  });
});

describe("filtered source (a filteredView passed as `inventory`)", () => {
  it("presents only the matching, compacted stacks and invokes actions on the real model slot", () => {
    const { scene } = createMockScene();
    const inventory = makeInventory(); // actions: [{ id: "drop", label: "Drop" }]
    inventory.add("sword"); // slot 0 — excluded from the view
    inventory.add("potion", 2); // slot 1 — the only match
    const usableOnly = filteredView(inventory, (_stack, def) => def.name === "Potion");

    const slots = new StubSlots();
    const controller = new InventoryController({
      slots,
      actionMenu: new StubMenu(),
      inventory: usableOnly,
      input: null,
    });
    const host = scene.spawn("inv");
    host.add(controller);
    // Compile-time assertion: TId flows from the filtered view with no
    // explicit type argument, same as from a plain Inventory.
    const source: InventorySource<Id> = controller.inventory;
    expect(source.used).toBe(1);

    const actions: { actionId: string; slot: number; itemId: string }[] = [];
    host.on(InventoryActionEvent, (e) => actions.push(e));

    controller.open();
    expect(slots.presented.at(-1)).toHaveLength(1); // compacted: sword excluded
    expect(slots.presented.at(-1)?.[0]?.stack?.itemId).toBe("potion");

    controller.confirm(); // opens the menu on presented slot 0 -> model slot 1
    controller.confirm(); // invokes "drop"
    // The mirrored engine event carries the REAL model slot, not the presented one.
    expect(actions).toEqual([expect.objectContaining({ actionId: "drop", slot: 1, itemId: "potion" })]);
  });
});

describe("host-driven seam (embedded mode)", () => {
  it("drives the whole flow without any binding", () => {
    const { scene } = createMockScene();
    const inventory = makeInventory();
    const onCancel = vi.fn();
    const { controller, slots } = makeController(inventory, {
      closeOnCancel: false,
      onCancel,
    });
    scene.spawn("inv").add(controller);

    inventory.add("potion");
    controller.open();
    expect(slots.presented.length).toBeGreaterThan(0);
    controller.move("down");
    expect(controller.selection()).toBe(1);
    controller.select(0);
    controller.confirm();
    expect(controller.isMenuOpen()).toBe(true);
    controller.cancel(); // closes the menu
    controller.cancel(); // browse-level: host policy, stays open
    expect(controller.isOpen()).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    controller.close();
    expect(controller.isOpen()).toBe(false);
  });

  it("openOnAdd opens during mount", () => {
    const { scene } = createMockScene();
    const { controller } = makeController(makeInventory(), { openOnAdd: true });
    scene.spawn("inv").add(controller);
    expect(controller.isOpen()).toBe(true);
  });

  it("sort() drives the model through the session", () => {
    const { scene } = createMockScene();
    const inventory = makeInventory();
    const { controller } = makeController(inventory);
    scene.spawn("inv").add(controller);
    inventory.add("sword");
    inventory.add("potion");
    controller.open();
    controller.sort();
    expect(inventory.slots[0]?.itemId).toBe("potion"); // catalog order
  });
});
