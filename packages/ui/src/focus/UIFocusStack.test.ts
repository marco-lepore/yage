import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Node as YogaNode } from "yoga-layout";
import type { DisplayContainer } from "@yagejs/renderer";
import { MockContainer } from "../test-helpers.js";
import type { UIContainerElement, UIElement } from "../types.js";
import { FocusState } from "./FocusState.js";
import { takePointerRequest } from "./pointer-request.js";
import { UIFocusScope } from "./UIFocusScope.js";
import type { UIFocusInputSource } from "./UIFocusScope.js";
import { UIFocusStack } from "./UIFocusStack.js";

/** A stand-in element: a container, a laid-out box, and optional focus. */
class TestNode implements UIContainerElement {
  readonly container = new MockContainer();
  readonly children: UIElement[] = [];
  paints: boolean[] = [];
  activations = 0;

  constructor(y = 0) {
    this.container.position.set(0, y);
  }

  get displayObject(): DisplayContainer {
    return this.container as unknown as DisplayContainer;
  }

  get yogaNode(): YogaNode {
    return {
      getComputedWidth: () => 100,
      getComputedHeight: () => 20,
    } as unknown as YogaNode;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(value: boolean) {
    this.container.visible = value;
  }

  focusable(): this {
    new FocusState(
      this,
      {},
      {
        focusableByDefault: true,
        paint: (focused) => this.paints.push(focused),
        activate: () => {
          this.activations += 1;
        },
      },
    );
    return this;
  }

  add<T extends TestNode>(child: T): T {
    this.children.push(child);
    this.container.addChild(child.container);
    return child;
  }

  addElement(child: UIElement): void {
    this.children.push(child);
  }

  removeElement(): void {}

  insertElementBefore(): void {}

  update(): void {}

  destroy(): void {}
}

class StubInput implements UIFocusInputSource {
  private readonly held = new Set<string>();
  private readonly edges = new Set<string>();
  private readonly playerReleases = new Set<string>();

  isPressed(action: string): boolean {
    return this.held.has(action);
  }

  isJustPressed(action: string): boolean {
    return this.edges.has(action);
  }

  isJustReleasedByPlayer(action: string): boolean {
    return this.playerReleases.has(action);
  }

  hasAction(): boolean {
    return true;
  }

  press(...names: string[]): void {
    for (const name of names) {
      this.held.add(name);
      this.edges.add(name);
      this.playerReleases.delete(name);
    }
  }

  release(...names: string[]): void {
    for (const name of names) {
      this.held.delete(name);
      this.playerReleases.add(name);
    }
    this.edges.clear();
  }
}

/** A panel with one focusable row, ready to host a scope. */
function menu(stage: TestNode): { panel: TestNode; row: TestNode } {
  const panel = stage.add(new TestNode());
  const row = panel.add(new TestNode()).focusable();
  return { panel, row };
}

function scopeOver(panel: TestNode): UIFocusScope {
  return new UIFocusScope(
    { displayObject: panel.displayObject, roots: () => panel.children },
    {},
  );
}

beforeEach(() => {
  takePointerRequest();
  vi.restoreAllMocks();
});

describe("UIFocusStack", () => {
  it("gives input to the scope shown most recently", () => {
    const stage = new TestNode();
    const first = menu(stage);
    const second = menu(stage);
    second.panel.visible = false;
    const menuScope = scopeOver(first.panel);
    const dialogScope = scopeOver(second.panel);
    const stack = new UIFocusStack();
    stack._register(menuScope);
    stack._register(dialogScope);

    stack._observe();
    stack._drive(null);
    expect(stack.active).toBe(menuScope);
    expect(first.row.paints).toEqual([true]);

    second.panel.visible = true;
    stack._observe();
    stack._drive(null);

    expect(stack.active).toBe(dialogScope);
    expect(dialogScope.focused).toBe(second.row);
    // The menu keeps the row it had, painted as any other resting row.
    expect(menuScope.focused).toBe(first.row);
    expect(first.row.paints).toEqual([true, false]);
  });

  it("hands input back on the element the outer scope had", () => {
    const stage = new TestNode();
    const first = menu(stage);
    const extra = first.panel.add(new TestNode(30)).focusable();
    const second = menu(stage);
    second.panel.visible = false;
    const menuScope = scopeOver(first.panel);
    const dialogScope = scopeOver(second.panel);
    const stack = new UIFocusStack();
    stack._register(menuScope);
    stack._register(dialogScope);
    stack._observe();
    stack._drive(null);
    menuScope.move("down");
    expect(menuScope.focused).toBe(extra);

    second.panel.visible = true;
    stack._observe();
    stack._drive(null);
    second.panel.visible = false;
    stack._observe();
    stack._drive(null);

    expect(stack.active).toBe(menuScope);
    expect(menuScope.focused).toBe(extra);
    expect(extra.paints.at(-1)).toBe(true);
  });

  it("stops driving a scope hidden by an ancestor rather than itself", () => {
    const stage = new TestNode();
    const surface = stage.add(new TestNode());
    const panel = surface.add(new TestNode());
    panel.add(new TestNode()).focusable();
    const scope = scopeOver(panel);
    const stack = new UIFocusStack();
    stack._register(scope);
    stack._observe();
    stack._drive(null);
    expect(stack.active).toBe(scope);

    surface.visible = false;
    stack._observe();
    stack._drive(null);

    expect(stack.active).toBeNull();
    expect(scope.hasInput).toBe(false);
  });

  it("records a shown transition taken while the stack was suspended", () => {
    const stage = new TestNode();
    const { panel } = menu(stage);
    panel.visible = false;
    const scope = scopeOver(panel);
    const stack = new UIFocusStack();
    stack._register(scope);

    panel.visible = true;
    stack._observe();
    stack._suspend();
    stack._observe();
    stack._drive(null);

    expect(stack.active).toBe(scope);
  });

  it("resolves two scopes shown in one frame by registration order", () => {
    const stage = new TestNode();
    const first = menu(stage);
    const second = menu(stage);
    const firstScope = scopeOver(first.panel);
    const secondScope = scopeOver(second.panel);
    const stack = new UIFocusStack();
    stack._register(firstScope);
    stack._register(secondScope);

    stack._observe();
    stack._drive(null);

    expect(stack.active).toBe(secondScope);
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
    // A tree filled before it is mounted registers the dialog's scope first,
    // and the menu around it never takes the dialog's rows into its own walk.
    stack._register(dialogScope);
    stack._register(menuScope);

    stack._observe();
    stack._drive(null);

    expect(stack.active).toBe(dialogScope);
    expect(menuScope.hasInput).toBe(false);
  });

  it("re-latches on return rather than keeping a stale latch", () => {
    const stage = new TestNode();
    const { panel, row } = menu(stage);
    const scope = scopeOver(panel);
    const stack = new UIFocusStack();
    stack._register(scope);
    const input = new StubInput();

    input.press("interact");
    stack._observe();
    stack._drive(input);
    expect(row.activations).toBe(0);

    input.release("interact");
    stack._suspend();
    stack._observe();
    stack._drive(input);
    input.press("interact");
    stack._drive(input);
    input.release("interact");
    stack._drive(input);

    expect(row.activations).toBe(1);
  });

  it("latches again every time a scope takes input back", () => {
    const stage = new TestNode();
    const { panel, row } = menu(stage);
    const scope = scopeOver(panel);
    const stack = new UIFocusStack();
    stack._register(scope);
    const input = new StubInput();
    stack._observe();
    stack._drive(input);

    stack._suspend();
    input.press("interact");
    stack._observe();
    stack._drive(input);

    expect(row.activations).toBe(0);
  });

  it("drops a scope unregistered while it holds input", () => {
    const stage = new TestNode();
    const { panel, row } = menu(stage);
    const scope = scopeOver(panel);
    const stack = new UIFocusStack();
    stack._register(scope);
    stack._observe();
    stack._drive(null);
    expect(row.paints).toEqual([true]);

    stack._unregister(scope);

    expect(stack.active).toBeNull();
    expect(scope.hasInput).toBe(false);
    expect(row.paints).toEqual([true, false]);

    stack._observe();
    stack._drive(null);
    expect(stack.active).toBeNull();
  });

  it("reports whether any shown scope reads a device", () => {
    const stage = new TestNode();
    const { panel } = menu(stage);
    const headless = new UIFocusScope(
      { displayObject: panel.displayObject, roots: () => panel.children },
      { input: null },
    );
    const stack = new UIFocusStack();
    stack._register(headless);
    stack._observe();
    expect(stack._hasDeviceScope()).toBe(false);

    stack._register(scopeOver(panel));
    stack._observe();
    expect(stack._hasDeviceScope()).toBe(true);
  });

  it("takes input away from the scope holding it when destroyed", () => {
    const stage = new TestNode();
    const { panel, row } = menu(stage);
    const scope = scopeOver(panel);
    const stack = new UIFocusStack();
    stack._register(scope);
    stack._observe();
    stack._drive(null);

    stack.destroy();

    expect(stack.active).toBeNull();
    expect(row.paints).toEqual([true, false]);
  });
});
