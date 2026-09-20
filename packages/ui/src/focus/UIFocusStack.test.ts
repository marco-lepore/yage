import { beforeEach, describe, expect, it, vi } from "vitest";
import { takePointerRequest } from "./pointer-request.js";
import type { UIFocusInputSource, UIFocusScope } from "./UIFocusScope.js";
import { UIFocusStack } from "./UIFocusStack.js";
import { StubInput, TestNode, scopeOver } from "./test-nodes.js";

/** `count` panels on one stage, a focusable row and a registered scope each. */
function stacked(count: number): {
  stack: UIFocusStack;
  panels: TestNode[];
  rows: TestNode[];
  scopes: UIFocusScope[];
} {
  const stage = new TestNode();
  const stack = new UIFocusStack();
  const panels: TestNode[] = [];
  const rows: TestNode[] = [];
  const scopes: UIFocusScope[] = [];
  for (let i = 0; i < count; i += 1) {
    const panel = stage.add(new TestNode());
    rows.push(panel.add(new TestNode()).focusable());
    panels.push(panel);
    scopes.push(scopeOver(panel));
    stack._register(scopes[i]!);
  }
  return { stack, panels, rows, scopes };
}

/** One frame of the focus system over a stack it drives. */
function frame(stack: UIFocusStack, input: UIFocusInputSource | null): void {
  stack._observe();
  stack._drive(input);
}

beforeEach(() => {
  takePointerRequest();
  vi.restoreAllMocks();
});

describe("UIFocusStack", () => {
  it("gives input to the scope shown most recently and hands it back", () => {
    const { stack, panels, rows, scopes } = stacked(2);
    const extra = panels[0]!.add(new TestNode({ y: 30 })).focusable();
    panels[1]!.visible = false;
    frame(stack, null);
    expect(stack.active).toBe(scopes[0]);
    scopes[0]!.move("down");
    expect(extra.paints).toEqual([true]);

    panels[1]!.visible = true;
    frame(stack, null);
    expect(stack.active).toBe(scopes[1]);
    expect(scopes[1]!.focused).toBe(rows[1]);
    // The menu keeps the row it had, painted as any other resting row.
    expect(scopes[0]!.focused).toBe(extra);
    expect(extra.paints).toEqual([true, false]);

    panels[1]!.visible = false;
    frame(stack, null);
    expect(stack.active).toBe(scopes[0]);
    expect(scopes[0]!.focused).toBe(extra);
    expect(extra.paints).toEqual([true, false, true]);
  });

  it("stops driving a scope hidden by an ancestor rather than itself", () => {
    const stage = new TestNode();
    const surface = stage.add(new TestNode());
    const panel = surface.add(new TestNode());
    panel.add(new TestNode()).focusable();
    const scope = scopeOver(panel);
    const stack = new UIFocusStack();
    stack._register(scope);
    frame(stack, null);
    expect(stack.active).toBe(scope);

    surface.visible = false;
    frame(stack, null);

    expect(stack.active).toBeNull();
    expect(scope.hasInput).toBe(false);
  });

  it("records a shown transition taken while the stack was suspended", () => {
    const { stack, panels, scopes } = stacked(1);
    panels[0]!.visible = false;

    panels[0]!.visible = true;
    stack._observe();
    stack._suspend();
    frame(stack, null);

    expect(stack.active).toBe(scopes[0]);
  });

  it("resolves two scopes shown in one frame by registration order", () => {
    const { stack, scopes } = stacked(2);

    frame(stack, null);

    expect(stack.active).toBe(scopes[1]);
  });

  it("drives a nested scope registered before the one around it", () => {
    const stage = new TestNode();
    const menuPanel = stage.add(new TestNode());
    menuPanel.add(new TestNode()).focusable();
    const dialog = menuPanel.add(new TestNode());
    dialog.add(new TestNode()).focusable();
    const dialogScope = scopeOver(dialog);
    const menuScope = scopeOver(menuPanel);
    const stack = new UIFocusStack();
    // A tree filled before it is mounted registers the dialog's scope first.
    stack._register(dialogScope);
    stack._register(menuScope);

    frame(stack, null);

    expect(stack.active).toBe(dialogScope);
    expect(menuScope.hasInput).toBe(false);
  });

  it("latches again every time a scope takes input back", () => {
    const { stack, rows } = stacked(1);
    const input = new StubInput();
    frame(stack, input);

    stack._suspend();
    input.press("interact");
    frame(stack, input);
    expect(rows[0]!.activations).toBe(0);

    input.release("interact");
    stack._drive(input);
    input.press("interact");
    stack._drive(input);
    input.release("interact");
    stack._drive(input);
    expect(rows[0]!.activations).toBe(1);
  });

  it.each(["_unregister", "destroy"] as const)(
    "takes input away from the scope holding it on %s",
    (how) => {
      const { stack, rows, scopes } = stacked(1);
      frame(stack, null);
      expect(rows[0]!.paints).toEqual([true]);

      if (how === "destroy") stack.destroy();
      else stack._unregister(scopes[0]!);

      expect(stack.active).toBeNull();
      expect(scopes[0]!.hasInput).toBe(false);
      expect(rows[0]!.paints).toEqual([true, false]);
      if (how === "destroy") return;
      frame(stack, null);
      expect(stack.active).toBeNull();
    },
  );

  it("reports whether any shown scope reads a device", () => {
    const panel = new TestNode().add(new TestNode());
    panel.add(new TestNode()).focusable();
    const stack = new UIFocusStack();
    stack._register(scopeOver(panel, { input: null }));
    stack._observe();
    expect(stack._hasDeviceScope()).toBe(false);

    stack._register(scopeOver(panel));
    stack._observe();
    expect(stack._hasDeviceScope()).toBe(true);
  });
});
