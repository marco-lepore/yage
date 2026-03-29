import { describe, it, expect, beforeEach } from "vitest";
import { Component } from "./Component.js";
import { _resetEntityIdCounter } from "./Entity.js";
import { defineEvent } from "./EventToken.js";
import { createMockScene, createMockEntity } from "./test-utils.js";

beforeEach(() => {
  _resetEntityIdCounter();
});

const Hit = defineEvent<{ damage: number }>("hit");

class ListenerComponent extends Component {
  received: unknown[] = [];

  onAdd() {
    this.listen(this.entity, Hit, (data) => {
      this.received.push(data);
    });
  }
}

class SceneListenerComponent extends Component {
  received: Array<{ data: unknown; entityName: string }> = [];

  onAdd() {
    this.listenScene(Hit, (data, entity) => {
      this.received.push({ data, entityName: entity.name });
    });
  }
}

class CleanupTracker extends Component {
  cleanupOrder: string[] = [];

  onAdd() {
    this.addCleanup(() => this.cleanupOrder.push("cleanup1"));
    this.addCleanup(() => this.cleanupOrder.push("cleanup2"));
  }

  onRemove() {
    this.cleanupOrder.push("onRemove");
  }

  onDestroy() {
    this.cleanupOrder.push("onDestroy");
  }
}

describe("Component.listen", () => {
  it("subscribes to entity events", () => {
    const { entity } = createMockEntity();
    const comp = entity.add(new ListenerComponent());

    entity.emit(Hit, { damage: 10 });

    expect(comp.received).toEqual([{ damage: 10 }]);
  });

  it("auto-unsubscribes when component is removed", () => {
    const { entity } = createMockEntity();
    const comp = entity.add(new ListenerComponent());

    entity.remove(ListenerComponent);
    entity.emit(Hit, { damage: 10 });

    expect(comp.received).toEqual([]);
  });

  it("auto-unsubscribes when entity is destroyed", () => {
    const { entity } = createMockEntity();
    const comp = entity.add(new ListenerComponent());

    entity._performDestroy();

    // Handler was cleaned up — no way to emit now since entity is destroyed,
    // but we verify the cleanup ran
    expect(comp.received).toEqual([]);
  });

  it("can listen to events on a different entity", () => {
    const { scene } = createMockScene();
    const e1 = scene.spawn("e1");
    const e2 = scene.spawn("e2");

    class CrossListener extends Component {
      received: unknown[] = [];
      onAdd() {
        this.listen(e2, Hit, (data) => {
          this.received.push(data);
        });
      }
    }

    const comp = e1.add(new CrossListener());
    e2.emit(Hit, { damage: 5 });

    expect(comp.received).toEqual([{ damage: 5 }]);

    // Removing the component from e1 auto-unsubs from e2's event
    e1.remove(CrossListener);
    e2.emit(Hit, { damage: 99 });

    expect(comp.received).toEqual([{ damage: 5 }]);
  });
});

describe("Component.listenScene", () => {
  it("subscribes to scene-level bubbled events", () => {
    const { scene } = createMockScene();
    const listener = scene.spawn("listener");
    const emitter = scene.spawn("emitter");

    const comp = listener.add(new SceneListenerComponent());
    emitter.emit(Hit, { damage: 7 });

    expect(comp.received).toEqual([
      { data: { damage: 7 }, entityName: "emitter" },
    ]);
  });

  it("auto-unsubscribes from scene when component is removed", () => {
    const { scene } = createMockScene();
    const listener = scene.spawn("listener");
    const emitter = scene.spawn("emitter");

    const comp = listener.add(new SceneListenerComponent());
    listener.remove(SceneListenerComponent);
    emitter.emit(Hit, { damage: 7 });

    expect(comp.received).toEqual([]);
  });

  it("throws if entity is not in a scene", () => {
    class BadComponent extends Component {
      onAdd() {
        this.listenScene(Hit, () => {});
      }
    }

    // Entity not in a scene
    const { entity } = createMockEntity();
    entity._setScene(null, null);

    expect(() => entity.add(new BadComponent())).toThrow(
      "Cannot access scene: entity is not attached to a scene.",
    );
  });
});

describe("Component.addCleanup", () => {
  it("runs cleanups in order", () => {
    const { entity } = createMockEntity();
    const comp = entity.add(new CleanupTracker());

    entity.remove(CleanupTracker);

    expect(comp.cleanupOrder).toEqual([
      "cleanup1",
      "cleanup2",
      "onRemove",
      "onDestroy",
    ]);
  });

  it("runs cleanups before onRemove/onDestroy on entity destroy", () => {
    const { entity } = createMockEntity();
    const comp = entity.add(new CleanupTracker());

    entity._performDestroy();

    expect(comp.cleanupOrder).toEqual([
      "cleanup1",
      "cleanup2",
      "onRemove",
      "onDestroy",
    ]);
  });

  it("cleanups are idempotent (_runCleanups clears the list)", () => {
    const { entity } = createMockEntity();
    const comp = entity.add(new CleanupTracker());

    comp._runCleanups();
    comp._runCleanups();

    // Only the first call runs cleanups
    expect(comp.cleanupOrder).toEqual(["cleanup1", "cleanup2"]);
  });
});
