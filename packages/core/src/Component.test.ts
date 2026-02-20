import { describe, it, expect } from "vitest";
import { Component } from "./Component.js";

class TestComponent extends Component {}

describe("Component", () => {
  it("enabled defaults to true", () => {
    const c = new TestComponent();
    expect(c.enabled).toBe(true);
  });

  it("can be disabled", () => {
    const c = new TestComponent();
    c.enabled = false;
    expect(c.enabled).toBe(false);
  });

  it("context getter throws when entity has no scene", () => {
    const c = new TestComponent();
    c.entity = { scene: null } as never;
    expect(() => c.context).toThrow(
      "Cannot access context: entity is not attached to a scene.",
    );
  });

  it("context getter returns scene context", () => {
    const mockContext = { resolve: () => {} };
    const c = new TestComponent();
    c.entity = { scene: { context: mockContext } } as never;
    expect(c.context).toBe(mockContext);
  });

  it("lifecycle hooks are optional", () => {
    const c = new TestComponent();
    expect(c.onAdd).toBeUndefined();
    expect(c.onRemove).toBeUndefined();
    expect(c.onDestroy).toBeUndefined();
    expect(c.update).toBeUndefined();
    expect(c.fixedUpdate).toBeUndefined();
  });

  it("subclass can define lifecycle hooks", () => {
    class LifecycleComponent extends Component {
      added = false;
      removed = false;
      destroyed = false;

      onAdd() {
        this.added = true;
      }
      onRemove() {
        this.removed = true;
      }
      onDestroy() {
        this.destroyed = true;
      }
    }

    const c = new LifecycleComponent();
    c.onAdd?.();
    c.onRemove?.();
    c.onDestroy?.();
    expect(c.added).toBe(true);
    expect(c.removed).toBe(true);
    expect(c.destroyed).toBe(true);
  });

  it("subclass can define update methods", () => {
    class UpdatingComponent extends Component {
      lastDt = 0;
      lastFixedDt = 0;

      update(dt: number) {
        this.lastDt = dt;
      }
      fixedUpdate(dt: number) {
        this.lastFixedDt = dt;
      }
    }

    const c = new UpdatingComponent();
    c.update(16);
    c.fixedUpdate(8);
    expect(c.lastDt).toBe(16);
    expect(c.lastFixedDt).toBe(8);
  });
});
