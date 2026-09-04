import { describe, expect, it } from "vitest";
import type {
  InputManager,
  PointerPressInfo,
  PointerPressOptions,
} from "@yagejs/input";
import type { InventorySessionDriver, NavDirection } from "../core/session.js";
import {
  CompositeInputBinding,
  INVENTORY_ACTIONS,
  inventoryControls,
  KeyboardInputBinding,
  PointerInputBinding,
} from "./InputBinding.js";

/** Structural InputManager fake: actions pressed this frame + a pointer. */
class FakeInput {
  pressed = new Set<string>();
  pointer = { x: 0, y: 0 };
  consumed = new Set<number>();
  presses: Array<{ button: number; id: number }> = [];

  isJustPressed(action: string): boolean {
    return this.pressed.has(action);
  }
  getPointerPresses(
    options: PointerPressOptions = {},
  ): readonly PointerPressInfo[] {
    return this.presses
      .filter(({ button, id }) => {
        if (options.button !== undefined && button !== options.button) {
          return false;
        }
        const consumed = this.consumed.has(id);
        return options.consumed === "include"
          ? true
          : options.consumed === "only"
            ? consumed
            : !consumed;
      })
      .map(
        ({ button, id }) =>
          ({
            id,
            generation: 1,
            screenPos: this.pointer,
            worldPos: { x: this.pointer.x + 1000, y: this.pointer.y + 1000 },
            type: "mouse",
            isPrimary: true,
            buttons: new Set([button]),
            isDown: true,
            button,
            consumed: this.consumed.has(id),
          }) as unknown as PointerPressInfo,
      );
  }
  getPointerScreenPosition(): { x: number; y: number } {
    return this.pointer;
  }
  getPointerPosition(): { x: number; y: number } {
    return { x: this.pointer.x + 1000, y: this.pointer.y + 1000 }; // distinct
  }

  asManager(): InputManager {
    return this as unknown as InputManager;
  }
  click(id = 1): void {
    this.presses.push({ button: 0, id });
  }
  clearFrame(): void {
    this.presses.length = 0;
  }
}

/** Recording session fake. */
class FakeSession implements InventorySessionDriver {
  open = true;
  menuOpen = false;
  calls: string[] = [];

  isOpen(): boolean {
    return this.open;
  }
  isMenuOpen(): boolean {
    return this.menuOpen;
  }
  toggle(): void {
    this.calls.push("toggle");
  }
  move(dir: NavDirection): void {
    this.calls.push(`move:${dir}`);
  }
  confirm(): void {
    this.calls.push("confirm");
  }
  cancel(): void {
    this.calls.push("cancel");
  }
  sort(): void {
    this.calls.push("sort");
  }
  select(slot: number): void {
    this.calls.push(`select:${slot}`);
  }
  confirmSlot(slot: number): void {
    this.calls.push(`confirmSlot:${slot}`);
  }
  highlightMenu(position: number): void {
    this.calls.push(`highlightMenu:${position}`);
  }
  confirmAction(position: number): void {
    this.calls.push(`confirmAction:${position}`);
  }

  asSession(): InventorySessionDriver {
    return this;
  }
}

describe("KeyboardInputBinding", () => {
  it("maps default actions onto the session", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const binding = new KeyboardInputBinding();
    binding.bind(input.asManager(), session.asSession());

    input.pressed = new Set(["move-down"]);
    binding.poll();
    input.pressed = new Set(["move-right"]);
    binding.poll();
    input.pressed = new Set(["interact"]);
    binding.poll();
    input.pressed = new Set(["cancel"]);
    binding.poll();
    input.pressed = new Set(["sort"]);
    binding.poll();
    expect(session.calls).toEqual([
      "move:down",
      "move:right",
      "confirm",
      "cancel",
      "sort",
    ]);
  });

  it("polls only the toggle while the session is closed", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    session.open = false;
    const binding = new KeyboardInputBinding();
    binding.bind(input.asManager(), session.asSession());

    input.pressed = new Set(["interact", "move-up"]);
    binding.poll();
    expect(session.calls).toEqual([]);

    input.pressed = new Set(["inventory"]);
    binding.poll();
    expect(session.calls).toEqual(["toggle"]);
  });

  it("exposes its polled action names for host validation", () => {
    const binding = new KeyboardInputBinding(INVENTORY_ACTIONS);
    expect(binding.actionNames()).toEqual(
      expect.arrayContaining([
        "move-up",
        "interact",
        "cancel",
        "sort",
        "inventory",
      ]),
    );
  });
});

describe("PointerInputBinding", () => {
  const targets = {
    slots: {
      slotAtPoint: (x: number) =>
        x >= 100 && x < 200 ? Math.floor((x - 100) / 50) : undefined,
    },
    actionMenu: {
      actionAtPoint: (_x: number, y: number) =>
        y >= 300 && y < 340 ? Math.floor((y - 300) / 20) : undefined,
    },
  };

  it("hovers cells and confirms them on click", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const binding = new PointerInputBinding(targets);
    binding.bind(input.asManager(), session.asSession());

    input.pointer = { x: 160, y: 10 };
    binding.poll();
    expect(session.calls).toEqual(["select:1"]);

    binding.poll(); // unmoved pointer — no repeated hit-test spam
    expect(session.calls).toEqual(["select:1"]);

    input.click();
    binding.poll();
    expect(session.calls).toEqual(["select:1", "confirmSlot:1"]);
  });

  it("routes hover/click to menu rows while the menu is open; off-menu click cancels", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    session.menuOpen = true;
    const binding = new PointerInputBinding(targets);
    binding.bind(input.asManager(), session.asSession());

    input.pointer = { x: 0, y: 321 };
    binding.poll();
    expect(session.calls).toEqual(["highlightMenu:1"]);

    input.click();
    binding.poll();
    expect(session.calls).toEqual(["highlightMenu:1", "confirmAction:1"]);

    input.pointer = { x: 0, y: 0 }; // off the menu
    input.click();
    binding.poll();
    expect(session.calls.at(-1)).toBe("cancel");
  });

  it("re-runs the hit-test when the menu opens under a stationary pointer", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const binding = new PointerInputBinding(targets);
    binding.bind(input.asManager(), session.asSession());

    input.pointer = { x: 0, y: 310 };
    binding.poll(); // browse: no slot at this point
    session.menuOpen = true;
    binding.poll(); // menu just opened — same point now hits row 0
    expect(session.calls).toEqual(["highlightMenu:0"]);
  });

  it("ignores a click whose pointer was consumed elsewhere", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const binding = new PointerInputBinding(targets);
    binding.bind(input.asManager(), session.asSession());
    input.pointer = { x: 160, y: 10 };
    binding.poll();
    expect(session.calls).toEqual(["select:1"]);

    input.consumed.add(7); // e.g. a touch overlay claimed this pointer
    input.click(7);
    binding.poll();
    expect(session.calls).toEqual(["select:1"]); // no confirmSlot

    input.click(8); // an unclaimed pointer still clicks
    binding.poll();
    expect(session.calls).toEqual(["select:1", "confirmSlot:1"]);
  });

  it("a consumed tap does not shadow an unclaimed tap in the same frame", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const binding = new PointerInputBinding(targets);
    binding.bind(input.asManager(), session.asSession());
    input.pointer = { x: 160, y: 10 };
    binding.poll();

    input.consumed.add(7);
    input.click(8); // unclaimed panel tap...
    input.click(7); // ...then a consumed overlay tap before the next poll
    binding.poll();
    expect(session.calls).toEqual(["select:1", "confirmSlot:1"]);
  });

  it("does nothing while closed and drops stale clicks", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    session.open = false;
    const binding = new PointerInputBinding(targets);
    binding.bind(input.asManager(), session.asSession());
    input.pointer = { x: 160, y: 10 };
    input.click();
    binding.poll();
    expect(session.calls).toEqual([]);
    input.clearFrame();
    session.open = true;
    binding.poll(); // the closed-time click must not fire now
    expect(session.calls).toEqual(["select:1"]);
  });

  it("uses world coordinates when the slots target says so", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const worldTargets = {
      slots: {
        pointerSpace: "world" as const,
        slotAtPoint: (x: number) => (x >= 1000 ? 7 : undefined),
      },
    };
    const binding = new PointerInputBinding(worldTargets);
    binding.bind(input.asManager(), session.asSession());
    input.pointer = { x: 0, y: 0 }; // world position = +1000
    binding.poll();
    expect(session.calls).toEqual(["select:7"]);
  });

  it("re-binding and dispose clear the binding's device references", () => {
    const input = new FakeInput();
    const replacement = new FakeInput();
    const session = new FakeSession();
    const binding = new PointerInputBinding(targets);
    binding.bind(input.asManager(), session.asSession());
    binding.bind(replacement.asManager(), session.asSession());
    input.click();
    binding.poll();
    expect(session.calls).toEqual([]);

    binding.dispose();
    replacement.click();
    binding.poll();
    expect(session.calls).toEqual([]);
  });
});

describe("inventoryControls / CompositeInputBinding", () => {
  it("fans keyboard and pointer onto one session and unions action names", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const binding = inventoryControls({
      slots: { slotAtPoint: () => 3 },
    });
    binding.bind(input.asManager(), session.asSession());

    input.pressed = new Set(["interact"]);
    input.pointer = { x: 5, y: 5 };
    binding.poll();
    expect(session.calls).toEqual(["confirm", "select:3"]);
    expect(binding.actionNames?.()).toEqual(
      expect.arrayContaining(["interact", "inventory"]),
    );
  });

  it("composite dispose detaches every child", () => {
    const input = new FakeInput();
    const session = new FakeSession();
    const a = new PointerInputBinding();
    const b = new PointerInputBinding();
    const composite = new CompositeInputBinding([a, b]);
    composite.bind(input.asManager(), session.asSession());
    composite.dispose();
    input.click();
    composite.poll();
    expect(session.calls).toEqual([]);
  });
});
