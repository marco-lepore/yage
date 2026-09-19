import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPointerConsumeContainer } from "@yagejs/core";
import { MockContainer } from "../test-helpers.js";
import type { FocusDirection, UIFocusScopeOptions } from "../types.js";
import {
  requestHoverFocus,
  requestPressFocus,
  takePointerRequest,
} from "./pointer-request.js";
import { UIFocusScope } from "./UIFocusScope.js";
import {
  StubInput,
  TestHolder,
  TestNode,
  TestScrollView,
  column,
  scopeOver,
} from "./test-nodes.js";

/** A scope over `count` rows that already reads `input`. */
function drivenColumn(
  count: number,
  options: UIFocusScopeOptions = {},
): { rows: TestNode[]; root: TestNode; input: StubInput; scope: UIFocusScope } {
  const { root, rows } = column(count);
  const input = new StubInput();
  const scope = scopeOver(root, options);
  scope._takeInput(input);
  return { root, rows, input, scope };
}

beforeEach(() => {
  // The pointer request cell is module-level.
  takePointerRequest();
  vi.restoreAllMocks();
});

describe("UIFocusScope candidates", () => {
  it("collects the focusable, enabled, visible, laid-out elements", () => {
    const root = new TestNode();
    const taken = root.add(new TestNode({ y: 0 })).focusable();
    root.add(new TestNode({ y: 30 })); // no focus state at all
    root.add(new TestNode({ y: 60 })).focusable({ focusable: false });
    const off = root.add(new TestNode({ y: 90 })).focusable();
    off.disabled = true;
    const hidden = root.add(new TestNode({ y: 120 })).focusable();
    hidden.visible = false;
    const unlaid = root.add(new TestNode({ y: 150 })).focusable();
    unlaid.width = Number.NaN;
    const nested = root.add(new TestNode({ y: 180 })).focusable();

    expect(scopeOver(root).candidates).toEqual([taken, nested]);
  });

  it("skips a hidden panel and everything under it", () => {
    const root = new TestNode();
    const group = root.add(new TestNode());
    group.add(new TestNode()).focusable();
    group.visible = false;
    const after = root.add(new TestNode({ y: 60 })).focusable();

    expect(scopeOver(root).candidates).toEqual([after]);
  });

  it("stops at an element that owns its own scope", () => {
    const root = new TestNode();
    const outer = root.add(new TestNode({ y: 0 })).focusable();
    const dialog = root.add(new TestNode({ y: 60 }));
    dialog.add(new TestNode()).focusable();
    scopeOver(dialog);

    expect(scopeOver(root).candidates).toEqual([outer]);
  });
});

describe("UIFocusScope.move", () => {
  it("refuses to move with no candidates and still runs onCancel", () => {
    const onCancel = vi.fn();
    const onMoveBlocked = vi.fn();
    const scope = scopeOver(new TestNode(), { onCancel, onMoveBlocked });

    expect(scope.move("down")).toBe(false);
    expect(onMoveBlocked).toHaveBeenCalledWith("down");
    scope.cancel();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("refuses to move once every row it had has gone", () => {
    const onMoveBlocked = vi.fn();
    const { rows, scope } = drivenColumn(2, { onMoveBlocked });
    expect(scope.focused).toBe(rows[0]);

    for (const row of rows) row.visible = false;
    scope._tick(null);
    expect(scope.focused).toBeNull();

    expect(scope.move("down")).toBe(false);
    expect(scope.focused).toBeNull();
    expect(onMoveBlocked).toHaveBeenCalledWith("down");

    scope.activate();
    expect(rows[0]!.activations).toBe(0);
  });

  it.each<[FocusDirection, number, number]>([
    ["up", 100, 0],
    ["down", 100, 80],
    ["left", 0, 40],
    ["right", 200, 40],
  ])("moves %s to the element on that side", (direction, x, y) => {
    const root = new TestNode();
    const middle = root.add(new TestNode({ x: 100, y: 40 })).focusable();
    const target = root.add(new TestNode({ x, y })).focusable();
    const scope = scopeOver(root, { wrap: false });
    scope.focus(middle);

    expect(scope.move(direction)).toBe(true);
    expect(scope.focused).toBe(target);
  });

  it("wraps past the last row by default and refuses once wrap is set off", () => {
    const onMoveBlocked = vi.fn();
    const { root, rows } = column(3);
    const scope = scopeOver(root, { onMoveBlocked });
    scope.focus(rows[2]!);
    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(rows[0]);

    scope.focus(rows[2]!);
    scope.setOptions({ wrap: false });
    expect(scope.focused).toBe(rows[2]);
    expect(scope.move("down")).toBe(false);
    expect(scope.focused).toBe(rows[2]);
    expect(onMoveBlocked).toHaveBeenCalledWith("down");
  });
});

describe("UIFocusScope explicit neighbours", () => {
  it("jumps to the candidate a focusId names", () => {
    const root = new TestNode();
    const from = root
      .add(new TestNode({ y: 0 }))
      .focusable({ focusNeighbors: { down: "last" } });
    root.add(new TestNode({ y: 30 })).focusable();
    const target = root
      .add(new TestNode({ y: 60 }))
      .focusable({ focusId: "last" });
    const scope = scopeOver(root);
    scope.focus(from);

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(target);
  });

  it("stops movement on a null neighbour without wrapping", () => {
    const root = new TestNode();
    const from = root
      .add(new TestNode({ y: 0 }))
      .focusable({ focusNeighbors: { left: null } });
    root.add(new TestNode({ x: -60 })).focusable();
    const onMoveBlocked = vi.fn();
    const scope = scopeOver(root, { onMoveBlocked });
    scope.focus(from);

    expect(scope.move("left")).toBe(false);
    expect(scope.focused).toBe(from);
    expect(onMoveBlocked).toHaveBeenCalledWith("left");
  });

  it("falls back to position when the named id is not on screen", () => {
    const root = new TestNode();
    const from = root
      .add(new TestNode({ y: 0 }))
      .focusable({ focusNeighbors: { down: "filtered-out" } });
    const below = root.add(new TestNode({ y: 30 })).focusable();
    const scope = scopeOver(root);
    scope.focus(from);

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(below);
  });

  it("warns once when two candidates answer to one id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root, rows } = column(3, ["row", "row", "third"]);
    const scope = scopeOver(root);

    scope.focus(rows[2]!);
    scope.move("up");
    scope.move("down");

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('focusId "row"');
  });
});

describe("UIFocusScope adjustment", () => {
  it("gives left and right to onAdjust and keeps focus", () => {
    const onAdjust = vi.fn();
    const root = new TestNode();
    const row = root.add(new TestNode({ y: 0 })).focusable({ onAdjust });
    const below = root.add(new TestNode({ y: 30 })).focusable();
    const scope = scopeOver(root);
    scope.focus(row);

    expect(scope.move("left")).toBe(true);
    expect(scope.move("right")).toBe(true);
    expect(scope.focused).toBe(row);
    expect(onAdjust.mock.calls).toEqual([[-1], [1]]);

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(below);
  });

  it("lets a stepper release the press at its end so focus can leave", () => {
    const root = new TestNode();
    let value = 0;
    const slider = root.add(new TestNode({ y: 0 })).focusable(
      {},
      {
        adjust: (direction) => {
          if (direction !== "right" || value === 1) return false;
          value = 1;
          return true;
        },
      },
    );
    const right = root.add(new TestNode({ x: 200, y: 0 })).focusable();
    const scope = scopeOver(root);
    scope.focus(slider);

    expect(scope.move("right")).toBe(true);
    expect(scope.focused).toBe(slider);
    expect(value).toBe(1);

    expect(scope.move("right")).toBe(true);
    expect(scope.focused).toBe(right);
  });
});

describe("UIFocusScope.focus", () => {
  it("throws for an element outside the scope", () => {
    const { root, rows } = column(1);
    const stranger = new TestNode().focusable();
    const scope = scopeOver(root);

    expect(() => scope.focus(stranger)).toThrowError(
      "UIFocusScope.focus: the element must be inside this scope, got " +
        "TestNode.",
    );
    expect(scope.focused).toBeNull();
    expect(scope.focus(rows[0]!)).toBe(true);
  });

  it("refuses a hidden, a disabled and an unfocusable descendant", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = new TestNode();
    const hidden = root.add(new TestNode({ y: 0 })).focusable();
    hidden.visible = false;
    const off = root.add(new TestNode({ y: 30 })).focusable();
    off.disabled = true;
    const skipped = root
      .add(new TestNode({ y: 60 }))
      .focusable({ focusable: false });
    const scope = scopeOver(root);

    for (const row of [hidden, off, skipped]) {
      expect(scope.focus(row)).toBe(false);
      expect(scope.focused).toBeNull();
    }
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("UIFocusScope.activate", () => {
  it("runs the element's action and then onActivate, painting no press", () => {
    const onActivate = vi.fn();
    const { rows, scope } = drivenColumn(1, { onActivate });

    scope.activate();

    expect(rows[0]!.activations).toBe(1);
    expect(rows[0]!.presses).toEqual([]);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("does nothing on a disabled element", () => {
    const onActivate = vi.fn();
    const { root, rows } = column(1);
    const scope = scopeOver(root, { onActivate });
    scope.focus(rows[0]!);
    rows[0]!.disabled = true;

    scope.activate();

    expect(rows[0]!.activations).toBe(0);
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("UIFocusScope validation", () => {
  it("leaves no callback and no repaint for a destroyed element", () => {
    const onFocusChange = vi.fn();
    const root = new TestNode();
    const row = root.add(new TestNode()).focusable({ onFocusChange });
    const scope = scopeOver(root);
    scope._takeInput(null);
    scope.focus(row);
    onFocusChange.mockClear();
    row.paints.length = 0;

    row.destroy();

    expect(scope.focused).toBeNull();
    expect(onFocusChange).not.toHaveBeenCalled();
    expect(row.paints).toEqual([]);
  });

  it.each([
    ["the row after a hidden one", 6, 4, "hide", 5],
    ["the row before a disabled last one", 4, 3, "disable", 2],
  ] as const)("lands on %s", (_name, count, focused, how, expected) => {
    const { rows, scope } = drivenColumn(count);
    const row = rows[focused]!;
    scope.focus(row);

    if (how === "hide") row.visible = false;
    else row.disabled = true;
    scope._tick(null);

    expect(scope.focused).toBe(rows[expected]);
    expect(row.paints.at(-1)).toBe(false);
  });

  it("lands beside a focused row that was destroyed", () => {
    const onFocusMove = vi.fn();
    const { root, rows, scope } = drivenColumn(3, { onFocusMove });
    scope.focus(rows[1]!);
    onFocusMove.mockClear();

    // A React unmount: the element tears down, then leaves its parent.
    rows[1]!.destroy();
    root.removeElement(rows[1]!);
    scope._tick(null);

    expect(scope.focused).toBe(rows[2]);
    expect(onFocusMove).toHaveBeenCalledWith(rows[2], null);
  });

  it("lights the first row to arrive after the scope took input", () => {
    const root = new TestNode();
    const scope = scopeOver(root);
    scope._takeInput(null);
    expect(scope.focused).toBeNull();

    const row = root.add(new TestNode()).focusable();
    scope._tick(null);

    expect(scope.focused).toBe(row);
    expect(row.paints).toEqual([true]);
  });

  it("keeps a menu unlit after the game cleared focus itself", () => {
    const { rows, scope } = drivenColumn(2);
    expect(scope.focused).toBe(rows[0]);

    expect(scope.focus(null)).toBe(true);
    scope._tick(null);
    expect(scope.focused).toBeNull();

    // A dialog opens over the menu and closes again.
    scope._releaseInput();
    scope._takeInput(null);
    expect(scope.focused).toBeNull();
    expect(rows[0]!.paints).toEqual([true, false]);

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(rows[0]);
  });
});

describe("UIFocusScope autoFocus", () => {
  it("lights nothing on taking input when it is off", () => {
    const { rows, scope } = drivenColumn(2, { autoFocus: false });

    expect(scope.focused).toBeNull();
    expect(rows[0]!.paints).toEqual([]);
    scope._tick(null);
    expect(scope.focused).toBeNull();

    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(rows[0]);
  });

  it("still repaints an element it already remembers", () => {
    const { root, rows } = column(2);
    const scope = scopeOver(root, { autoFocus: false });
    scope.focus(rows[1]!);

    scope._takeInput(null);

    expect(scope.focused).toBe(rows[1]);
    expect(rows[1]!.paints).toEqual([true]);
  });
});

describe("UIFocusScope pointer focus", () => {
  it.each([
    [undefined, "hover", false],
    [undefined, "press", true],
    ["hover", "hover", true],
    ["hover", "press", true],
    ["none", "hover", false],
    ["none", "press", false],
  ] as const)(
    "with pointerFocus %s, a %s takes focus: %s",
    (pointerFocus, trigger, moves) => {
      const { rows, scope } = drivenColumn(
        3,
        pointerFocus === undefined ? {} : { pointerFocus },
      );

      if (trigger === "hover") requestHoverFocus(rows[2]!);
      else requestPressFocus(rows[2]!);
      scope._tick(null);

      expect(scope.focused).toBe(rows[moves ? 2 : 0]);
    },
  );

  it("takes pointerFocus from a setOptions that names it and keeps it otherwise", () => {
    const { rows, scope } = drivenColumn(3);

    scope.setOptions({ pointerFocus: "none" });
    scope.setOptions({ wrap: false });
    requestPressFocus(rows[2]!);
    scope._tick(null);
    expect(scope.focused).toBe(rows[0]);

    scope.setOptions({ pointerFocus: "hover" });
    requestHoverFocus(rows[2]!);
    scope._tick(null);
    expect(scope.focused).toBe(rows[2]);
  });

  it("consumes the request once, so the keyboard keeps the cursor", () => {
    const { rows, scope } = drivenColumn(3);

    requestPressFocus(rows[0]!);
    scope._tick(null);
    scope.move("down");
    scope._tick(null);

    expect(scope.focused).toBe(rows[1]);
  });

  // The dialog holds input, so it is the only scope that ticks; the pointer
  // pressed a row of the menu behind it.
  it.each<[string, UIFocusScopeOptions, UIFocusScopeOptions, boolean]>([
    ["is remembered by the menu it belongs to", {}, { modal: false }, true],
    [
      "is refused by a menu with pointerFocus none",
      { pointerFocus: "none" },
      { modal: false },
      false,
    ],
    ["is dropped while a modal dialog owns the pointer", {}, {}, false],
  ])(
    "a press behind the driven dialog %s",
    (_name, menuOptions, dialogOptions, taken) => {
      const stage = new TestNode();
      const menu = stage.add(new TestNode());
      const behind = menu.add(new TestNode({ y: 0 })).focusable();
      const dialog = stage.add(new TestNode({ y: 200 }));
      dialog.add(new TestNode()).focusable();
      const menuScope = scopeOver(menu, menuOptions);
      const dialogScope = scopeOver(dialog, dialogOptions);
      dialogScope._takeInput(null);

      requestPressFocus(behind);
      dialogScope._tick(null);

      expect(menuScope.focused).toBe(taken ? behind : null);
      // Remembered, not lit: the menu reads no input while the dialog is up.
      expect(behind.paints).toEqual([]);
      expect(dialogScope.focused).not.toBe(behind);
    },
  );
});

describe("UIFocusScope pointer ownership", () => {
  /** The pointer blockers directly under `node`. */
  function blockersUnder(node: TestNode): readonly MockContainer[] {
    return node.container.children.filter((child) =>
      isPointerConsumeContainer(child),
    );
  }

  /** Clip a node's subtree, the way an `overflow: hidden` panel's mask does. */
  function clip(node: TestNode): void {
    node.container.mask = new MockContainer();
  }

  /** A menu with a scope and a row, and inside it a dialog with a row. */
  function dialogInMenu(): {
    menu: TestNode;
    dialog: TestNode;
    dialogRow: TestNode;
  } {
    const stage = new TestNode({ width: 400, height: 400 });
    const menu = stage.add(new TestNode({ width: 200, height: 300 }));
    menu.add(new TestNode({ y: 0 })).focusable();
    const dialog = menu.add(new TestNode({ y: 200 }));
    const dialogRow = dialog.add(new TestNode()).focusable();
    scopeOver(menu);
    return { menu, dialog, dialogRow };
  }

  // Pixi prunes a clipped container wherever its mask refuses the point, so a
  // blocker inside a clipping host would cover only the host's own box.
  it.each([
    ["at the bottom of a host that clips nothing", false],
    ["directly under a host that clips its overflow", true],
  ])("seats the blocker %s, only while it reads input", (_name, clips) => {
    const { menu, dialog, dialogRow } = dialogInMenu();
    if (clips) clip(dialog);
    const seat = clips ? menu : dialog;
    const above = clips ? dialog : dialogRow;
    const scope = scopeOver(dialog, { modal: true });
    expect(blockersUnder(seat)).toEqual([]);

    scope._takeInput(null);
    const blocker = blockersUnder(seat)[0]!;
    const siblings = seat.container.children;
    expect(siblings[siblings.indexOf(blocker) + 1]).toBe(above.container);
    expect(blockersUnder(clips ? dialog : menu)).toEqual([]);

    scope._releaseInput();
    expect(blockersUnder(seat)).toEqual([]);

    scope._takeInput(null);
    scope._destroy();
    expect(blockersUnder(seat)).toEqual([]);
    expect(blocker.destroyed).toBe(true);
  });

  it("takes modal from a setOptions that names it and keeps it otherwise", () => {
    const { root, scope } = drivenColumn(3, { modal: false });
    expect(blockersUnder(root)).toEqual([]);

    scope.setOptions({ wrap: false });
    expect(blockersUnder(root)).toEqual([]);

    scope.setOptions({ modal: true });
    expect(blockersUnder(root)).toHaveLength(1);

    scope.setOptions({ modal: false });
    expect(blockersUnder(root)).toEqual([]);
  });

  it("re-seats a blocker whose host starts clipping while it is up", () => {
    const { menu, dialog } = dialogInMenu();
    const scope = scopeOver(dialog);
    scope._takeInput(null);
    expect(blockersUnder(dialog)).toHaveLength(1);

    clip(dialog);
    scope._tick(null);

    expect(blockersUnder(dialog)).toEqual([]);
    expect(blockersUnder(menu)).toHaveLength(1);
  });

  it("keeps a clipping host's blocker inside it when the host has no parent", () => {
    const { root } = column(1);
    clip(root);

    scopeOver(root)._takeInput(null);

    expect(blockersUnder(root)).toHaveLength(1);
  });
});

describe("UIFocusScope scroll follow", () => {
  /** A 100px list holding one focused row, in a scope that reads input. */
  function followedList(rowY: number): {
    list: TestScrollView;
    row: TestNode;
    scope: UIFocusScope;
  } {
    const root = new TestNode();
    const list = root.add(new TestScrollView({ height: 100 }));
    const row = list.add(new TestNode({ y: rowY })).focusable();
    const scope = scopeOver(root);
    scope._takeInput(null);
    scope.focus(row);
    list.scrolled.length = 0;
    return { list, row, scope };
  }

  it("scrolls the enclosing views innermost first, with the scope's padding", () => {
    const root = new TestNode();
    const outer = root.add(new TestScrollView({ height: 200 }));
    const inner = outer.add(new TestScrollView({ height: 100 }));
    const row = inner.add(new TestNode()).focusable();
    const order: unknown[] = [];
    vi.spyOn(inner, "scrollIntoView").mockImplementation((_element, opts) =>
      order.push(["inner", opts?.padding]),
    );
    vi.spyOn(outer, "scrollIntoView").mockImplementation((_element, opts) =>
      order.push(["outer", opts?.padding]),
    );
    const scope = scopeOver(root, { scrollPadding: 12 });

    scope.focus(row);

    expect(order).toEqual([
      ["inner", 12],
      ["outer", 12],
    ]);
  });

  it("scrolls a row that takes focus by a move into view", () => {
    const { list, scope } = followedList(0);
    const below = list.add(new TestNode({ y: 120 })).focusable();

    expect(scope.move("down")).toBe(true);

    expect(list.scrolled).toEqual([below]);
  });

  it("keeps the player's offset when a row below the focused one comes or goes", () => {
    const { list, scope } = followedList(0);
    list.add(new TestNode({ y: 200 })).focusable();

    // A wheel or a drag pans the rows before the scope ticks.
    list.scrollTo(60);
    scope._tick(null);
    expect(list.scrolled).toEqual([]);

    // The content panel grows and shrinks; the focused row stays put.
    const appended = list.add(new TestNode({ y: 240 })).focusable();
    scope._tick(null);
    list.removeElement(appended);
    scope._tick(null);
    expect(list.scrolled).toEqual([]);
  });

  it("brings a focused row back after the viewport shrinks around it", () => {
    const { list, row, scope } = followedList(80);
    scope._tick(null);
    expect(list.scrolled).toEqual([]);

    list.height = 40;
    scope._tick(null);

    expect(list.scrolled).toEqual([row]);
  });

  it("brings a focused row back after a row arrives above it", () => {
    const { list, row, scope } = followedList(0);
    scope._tick(null);
    expect(list.scrolled).toEqual([]);

    // The layout pass after the insert lays the focused row out past the fold.
    const above = new TestNode({ y: 0, height: 120 }).focusable();
    list.insertElementBefore(above, row);
    row.layoutAt(0, 120);
    list.relayout();
    scope._tick(null);

    expect(list.scrolled).toEqual([row]);
  });

  it("throws on a non-finite scroll padding, naming the value", () => {
    const root = new TestNode();

    expect(() => scopeOver(root, { scrollPadding: -4 })).toThrow(
      "UIFocusScope: scrollPadding must be a finite number of pixels at or " +
        "above 0, got -4.",
    );
    expect(() =>
      scopeOver(root).setOptions({ scrollPadding: Number.NaN }),
    ).toThrow(
      "UIFocusScope.setOptions: scrollPadding must be a finite number of " +
        "pixels at or above 0, got NaN.",
    );
  });
});

describe("UIFocusScope scroll clipping", () => {
  // Eight 30px rows in a 140px list, above a footer button. Unscrolled, the
  // row at 120 is the lowest one a player sees; panned by 90, the last is.
  it.each([
    ["enters a list at the lowest visible row", 0, "footer", "up", 4],
    ["reaches the row below the fold from inside", 0, 4, "down", 5],
    ["drops a row the offset scrolled out of sight", 90, "footer", "up", 7],
  ] as const)("%s", (_name, offset, from, direction, expected) => {
    const root = new TestNode();
    const list = root.add(new TestScrollView({ y: 0, height: 140 }));
    const rows: TestNode[] = [];
    for (let i = 0; i < 8; i += 1) {
      rows.push(list.add(new TestNode({ y: i * 30 })).focusable());
    }
    const footer = root.add(new TestNode({ y: 300 })).focusable();
    list.scrollTo(offset);
    const scope = scopeOver(root);
    scope.focus(from === "footer" ? footer : rows[from]!);

    scope.move(direction);

    expect(scope.focused).toBe(rows[expected]);
  });
});

describe("UIFocusScope input", () => {
  it.each([
    ["the default cadence", undefined, { repeat: true }],
    [
      "the cadence a game asked for",
      { delay: 0.6, interval: 0.04 },
      { repeat: true, repeatDelay: 0.6, repeatInterval: 0.04 },
    ],
    ["a delay alone", { delay: 0.6 }, { repeat: true, repeatDelay: 0.6 }],
    ["no repeat at all", false, undefined],
  ] as const)("asks a direction for %s", (_name, repeat, query) => {
    const { rows, input, scope } = drivenColumn(
      2,
      repeat === undefined ? {} : { input: { repeat } },
    );

    input.press("move-down");
    scope._tick(input);

    expect(input.queries).toEqual([query]);
    expect(scope.focused).toBe(rows[1]);
  });

  it("never asks confirm for a repeat", () => {
    const { input, scope } = drivenColumn(2);

    input.press("interact");
    scope._tick(input);

    expect(input.queries).toEqual([undefined]);
  });

  it("reads the renamed roles a game supplies, one name or a list", () => {
    const { root, rows } = column(2);
    const input = new StubInput();
    input.actions.add("attack").add("menu-down");
    const scope = scopeOver(root, {
      input: { down: "menu-down", confirm: ["interact", "attack"] },
    });
    scope._takeInput(input);

    input.press("menu-down");
    scope._tick(input);
    expect(scope.focused).toBe(rows[1]);

    input.release("menu-down");
    input.press("attack");
    scope._tick(input);
    // The press follows the name that opened it.
    scope._tick(input);
    expect(rows[1]!.activations).toBe(0);

    input.release("attack");
    scope._tick(input);
    expect(rows[1]!.activations).toBe(1);
  });

  it("resolves one direction per tick on a diagonal", () => {
    const root = new TestNode();
    const origin = root
      .add(new TestNode({ x: 0, y: 0, width: 40 }))
      .focusable();
    const below = root
      .add(new TestNode({ x: 0, y: 40, width: 40 }))
      .focusable();
    root.add(new TestNode({ x: 60, y: 0, width: 40 })).focusable();
    const input = new StubInput();
    const scope = scopeOver(root);
    scope._takeInput(input);
    scope.focus(origin);

    input.press("move-down", "move-right");
    scope._tick(input);

    expect(scope.focused).toBe(below);
  });

  it("presses no row when the same tick moved focus off the one confirm aimed at", () => {
    const { rows, input, scope } = drivenColumn(3);

    input.press("move-down", "interact");
    scope._tick(input);
    input.release("move-down", "interact");
    scope._tick(input);

    expect(scope.focused).toBe(rows[1]);
    expect(rows[0]!.activations).toBe(0);
    expect(rows[1]!.activations).toBe(0);
  });

  it("gives confirm the frame when cancel lands with it", () => {
    const onCancel = vi.fn();
    const { rows, input, scope } = drivenColumn(1, { onCancel });

    input.press("interact", "cancel");
    scope._tick(input);
    input.release("interact", "cancel");
    scope._tick(input);

    expect(rows[0]!.activations).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("warns once for a role no action in the map answers to", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = column(1);
    const input = new StubInput();
    input.actions.delete("move-up");
    const scope = scopeOver(root);

    scope._takeInput(input);
    scope._releaseInput();
    scope._takeInput(input);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('"move-up"');
    expect(warn.mock.calls[0]?.[0]).toContain("focus.input.up");
  });
});

describe("UIFocusScope press latch", () => {
  it.each(["press", "tap"] as const)(
    "ignores a confirm %s that landed before the menu took input",
    (how) => {
      const { root, rows } = column(2);
      const input = new StubInput();
      input[how]("interact");
      const scope = scopeOver(root);

      scope._takeInput(input);
      scope._tick(input);
      expect(rows[0]!.activations).toBe(0);

      input.release("interact");
      scope._tick(input);
      input.press("interact");
      scope._tick(input);
      input.release("interact");
      scope._tick(input);
      expect(rows[0]!.activations).toBe(1);
    },
  );

  it("latches again every time the scope takes input back", () => {
    const { rows, input, scope } = drivenColumn(3);

    scope._releaseInput();
    input.press("move-down");
    scope._takeInput(input);
    scope._tick(input);

    expect(scope.focused).toBe(rows[0]);
  });
});

describe("UIFocusScope confirm press", () => {
  it("paints the press while confirm is held and acts once on the release", () => {
    const onActivate = vi.fn();
    const { rows, input, scope } = drivenColumn(2, { onActivate });
    const row = rows[0]!;

    input.press("interact");
    for (let i = 0; i < 3; i += 1) scope._tick(input);
    expect(row.presses).toEqual([true]);
    expect(row.activations).toBe(0);

    input.release("interact");
    scope._tick(input);
    scope._tick(input);
    expect(row.presses).toEqual([true, false]);
    expect(row.activations).toBe(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["keeps a confirm press when the pointer presses the focused row", 0, 1],
    ["drops a confirm press when the pointer presses another row", 1, 0],
  ])("%s", (_name, pressed, activations) => {
    const { rows, input, scope } = drivenColumn(2);

    input.press("interact");
    scope._tick(input);
    input.settle();
    requestPressFocus(rows[pressed]!);
    scope._tick(input);
    expect(scope.focused).toBe(rows[pressed]);
    expect(rows[0]!.presses).toEqual(pressed === 0 ? [true] : [true, false]);

    input.release("interact");
    scope._tick(input);
    expect(rows[0]!.presses).toEqual([true, false]);
    expect(rows[0]!.activations).toBe(activations);
    expect(rows[1]!.activations).toBe(0);
  });

  it("walks no menu underneath a held confirm", () => {
    const { rows, input, scope } = drivenColumn(3);

    input.press("interact");
    scope._tick(input);
    input.press("move-down");
    scope._tick(input);

    expect(scope.focused).toBe(rows[0]);
  });

  it("runs the action when the press and its release land in one window", () => {
    const { rows, input, scope } = drivenColumn(2);

    input.tap("interact");
    scope._tick(input);

    expect(rows[0]!.activations).toBe(1);
    expect(rows[0]!.presses).toEqual([true, false]);
  });

  it.each([
    ["the window loses focus", "forceRelease"],
    ["the confirm action's group is switched off", "silence"],
    ["physical state is cleared", "clearAll"],
  ] as const)("runs nothing when %s under a held confirm", (_name, how) => {
    const { rows, input, scope } = drivenColumn(2);
    input.press("interact");
    scope._tick(input);

    input[how]("interact");
    scope._tick(input);

    expect(rows[0]!.presses).toEqual([true, false]);
    expect(rows[0]!.activations).toBe(0);
  });

  it.each<[string, (scope: UIFocusScope, rows: TestNode[]) => void]>([
    ["focus leaves the element", (scope, rows) => scope.focus(rows[1]!)],
    [
      "the element is hidden under it",
      (scope, rows) => {
        rows[0]!.visible = false;
        scope._tick(null);
      },
    ],
    ["the scope stops reading input", (scope) => scope._releaseInput()],
  ])("drops the press and runs nothing when %s", (_name, act) => {
    const { rows, input, scope } = drivenColumn(2);
    input.press("interact");
    scope._tick(input);
    input.settle();

    act(scope, rows);
    expect(rows[0]!.presses).toEqual([true, false]);

    input.release("interact");
    scope._takeInput(input);
    scope._tick(input);
    expect(rows[0]!.activations).toBe(0);
    expect(rows[1]!.activations).toBe(0);
  });

  it("drops the press with no repaint when the element is destroyed", () => {
    const { root, rows, input, scope } = drivenColumn(2);
    const row = rows[0]!;

    input.press("interact");
    scope._tick(input);
    row.destroy();
    root.removeElement(row);
    scope._tick(input);

    input.release("interact");
    scope._tick(input);
    expect(row.presses).toEqual([true]);
    expect(row.activations).toBe(0);
  });

  it("acts on the release for an element that paints no press", () => {
    const root = new TestNode();
    const row = root
      .add(new TestNode())
      .focusable({}, { setPressed: undefined });
    const input = new StubInput();
    const scope = scopeOver(root);
    scope._takeInput(input);

    input.press("interact");
    scope._tick(input);
    expect(row.presses).toEqual([]);

    input.release("interact");
    scope._tick(input);
    expect(row.activations).toBe(1);
  });

  it("presses nothing on a row a focus callback disabled", () => {
    const { rows, input, scope } = drivenColumn(2);
    const row = rows[1]!;
    scope.setOptions({
      onFocusMove: (element) => {
        if (element === row) row.disabled = true;
      },
    });

    // The pointer press moves focus onto the row inside this tick, and the
    // game's handler disables the row before confirm is read.
    requestPressFocus(row);
    input.press("interact");
    scope._tick(input);
    expect(row.presses).toEqual([]);

    input.release("interact");
    scope._tick(input);
    expect(row.activations).toBe(0);
  });
});

describe("UIFocusScope captured input", () => {
  /** A capturing holder and one plain row under it, in a driven scope. */
  function held(
    options: { takesDirections?: boolean } = {},
    scopeOptions: UIFocusScopeOptions = {},
  ): {
    holder: TestHolder;
    row: TestNode;
    input: StubInput;
    scope: UIFocusScope;
  } {
    const root = new TestNode();
    const holder = root.add(new TestHolder({ y: 0, ...options }));
    holder.focusable();
    const row = root.add(new TestNode({ y: 30 })).focusable();
    const input = new StubInput();
    const scope = scopeOver(root, scopeOptions);
    scope._takeInput(input);
    scope.focus(holder);
    holder.start();
    return { holder, row, input, scope };
  }

  it("hands every direction to the holder and keeps focus on it", () => {
    const { holder, scope, input } = held();

    input.press("move-down");
    scope._tick(input);
    input.release("move-down");
    input.press("move-left");
    scope._tick(input);

    expect(holder.moves).toEqual(["down", "left"]);
    expect(scope.focused).toBe(holder);
  });

  it("moves focus to a holder that took the input while another row held it", () => {
    const { holder, row, scope, input } = held();
    holder.stop();
    scope.focus(row);

    holder.start();
    scope._tick(input);

    expect(scope.focused).toBe(holder);
    input.press("interact");
    scope._tick(input);
    expect(holder.confirms).toBe(1);
  });

  it("keeps a direction a holder that takes none was handed", () => {
    const { holder, scope, input } = held({ takesDirections: false });

    input.press("move-down");
    scope._tick(input);

    expect(scope.focused).toBe(holder);
    expect(holder.moves).toEqual([]);
  });

  it("sends confirm and cancel to the holder, with no press and no action", () => {
    const onCancel = vi.fn();
    const { holder, scope, input } = held({}, { onCancel });

    input.press("cancel");
    scope._tick(input);
    expect(holder.cancels).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();

    input.release("cancel");
    holder.start();
    input.press("interact");
    scope._tick(input);
    input.release("interact");
    scope._tick(input);
    expect(holder.confirms).toBe(1);
    expect(holder.presses).toEqual([]);
    expect(holder.activations).toBe(0);
  });

  it("re-latches when the hold ends, so a held key does not move focus", () => {
    const { holder, row, scope, input } = held();

    // Confirm ends the capture; the direction held with it reaches nobody.
    input.press("move-down", "interact");
    scope._tick(input);
    expect(holder.confirms).toBe(1);
    expect(holder.moves).toEqual([]);

    // The hold keeps producing edges, the way a repeat does.
    input.press("move-down");
    scope._tick(input);
    expect(scope.focused).toBe(holder);

    input.release("move-down");
    scope._tick(input);
    input.press("move-down");
    scope._tick(input);
    expect(scope.focused).toBe(row);
  });

  it.each<[string, (parts: ReturnType<typeof held>) => void]>([
    ["focus leaves the holder", ({ scope, row }) => scope.focus(row)],
    [
      "the holder is hidden under it",
      ({ holder, scope, input }) => {
        holder.visible = false;
        scope._tick(input);
      },
    ],
    ["the scope stops reading input", ({ scope }) => scope._releaseInput()],
    ["the game clears focus", ({ scope }) => scope.focus(null)],
  ])("takes its input back when %s", (_name, act) => {
    const parts = held();

    act(parts);

    expect(parts.holder.releases).toBe(1);
    expect(parts.holder.cancels).toBe(0);
  });

  it("asks nothing of a holder that gave the input back on its own", () => {
    const { holder, scope, input } = held();
    scope._tick(input);

    holder.stop();
    scope.focus(null);

    expect(holder.releases).toBe(0);
  });

  it("routes move, activate and cancel through the holder with no device", () => {
    const onCancel = vi.fn();
    const root = new TestNode();
    const holder = root.add(new TestHolder({ y: 0 }));
    holder.focusable();
    root.add(new TestNode({ y: 30 })).focusable();
    const scope = scopeOver(root, { input: null, onCancel });
    scope._takeInput(null);
    scope.focus(holder);
    holder.start();

    expect(scope.move("down")).toBe(true);
    expect(holder.moves).toEqual(["down"]);
    expect(scope.focused).toBe(holder);

    scope.activate();
    expect(holder.confirms).toBe(1);
    expect(holder.activations).toBe(0);

    holder.start();
    scope.cancel();
    expect(holder.cancels).toBe(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("UIFocusScope with no device", () => {
  it("drives through move, activate and cancel, and warns about nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onCancel = vi.fn();
    const { root, rows } = column(2);
    const scope = scopeOver(root, { input: null, onCancel });
    scope._takeInput(null);
    scope._tick(null);

    expect(scope.focused).toBe(rows[0]);
    scope.move("down");
    expect(scope.focused).toBe(rows[1]);
    scope.activate();
    expect(rows[1]!.activations).toBe(1);
    scope.cancel();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(scope._pollsDevice).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("UIFocusScope input handover", () => {
  it("paints and announces only while it holds input", () => {
    const onFocusChange = vi.fn();
    const root = new TestNode();
    const row = root.add(new TestNode()).focusable({ onFocusChange });
    const scope = scopeOver(root);

    scope.focus(row);
    expect(row.paints).toEqual([]);
    expect(onFocusChange).not.toHaveBeenCalled();

    scope._takeInput(null);
    expect(row.paints).toEqual([true]);
    expect(onFocusChange).toHaveBeenCalledWith(true);

    scope._releaseInput();
    expect(row.paints).toEqual([true, false]);
    expect(onFocusChange).toHaveBeenLastCalledWith(false);
    expect(scope.focused).toBe(row);
  });

  it("reports whether its host is on screen", () => {
    const stage = new TestNode();
    const root = stage.add(new TestNode());
    const scope = scopeOver(root);

    expect(scope._isShown()).toBe(true);
    stage.visible = false;
    expect(scope._isShown()).toBe(false);
    stage.visible = true;
    root.visible = false;
    expect(scope._isShown()).toBe(false);
  });

  it("announces the move with both elements", () => {
    const onFocusMove = vi.fn();
    const { root, rows } = column(2);
    const scope = scopeOver(root, { onFocusMove });

    scope.focus(rows[0]!);
    scope.move("down");

    expect(onFocusMove.mock.calls).toEqual([
      [rows[0], null],
      [rows[1], rows[0]],
    ]);
  });
});

describe("UIFocusScope.setOptions", () => {
  it("rejects a repeat cadence that cannot produce edges", () => {
    const scope = scopeOver(new TestNode());

    expect(() =>
      scope.setOptions({ input: { repeat: { interval: 0 } } }),
    ).toThrow(
      "UIFocusScope.setOptions: input.repeat.interval must be a finite " +
        "number of seconds above 0, got 0.",
    );
    expect(() =>
      scope.setOptions({ input: { repeat: { delay: -1 } } }),
    ).toThrow(
      "UIFocusScope.setOptions: input.repeat.delay must be a finite number " +
        "of seconds at or above 0, got -1.",
    );
  });
});
