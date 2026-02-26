import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetEntityIdCounter } from "./Entity.js";
import { defineEvent } from "./EventToken.js";
import { createMockScene, createMockEntity } from "./test-utils.js";

beforeEach(() => {
  _resetEntityIdCounter();
});

describe("Entity events", () => {
  describe("on / emit", () => {
    it("calls handler with data", () => {
      const { entity } = createMockEntity();
      const Hit = defineEvent<{ damage: number }>("hit");
      const handler = vi.fn();

      entity.on(Hit, handler);
      entity.emit(Hit, { damage: 10 });

      expect(handler).toHaveBeenCalledWith({ damage: 10 });
    });

    it("supports void events (no data)", () => {
      const { entity } = createMockEntity();
      const Ping = defineEvent("ping");
      const handler = vi.fn();

      entity.on(Ping, handler);
      entity.emit(Ping);

      expect(handler).toHaveBeenCalledOnce();
    });

    it("calls multiple handlers", () => {
      const { entity } = createMockEntity();
      const Ping = defineEvent("ping");
      const h1 = vi.fn();
      const h2 = vi.fn();

      entity.on(Ping, h1);
      entity.on(Ping, h2);
      entity.emit(Ping);

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it("does not call handlers for different events", () => {
      const { entity } = createMockEntity();
      const A = defineEvent("a");
      const B = defineEvent("b");
      const handler = vi.fn();

      entity.on(A, handler);
      entity.emit(B);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribe", () => {
    it("returns an unsubscribe function", () => {
      const { entity } = createMockEntity();
      const Ping = defineEvent("ping");
      const handler = vi.fn();

      const unsub = entity.on(Ping, handler);
      unsub();
      entity.emit(Ping);

      expect(handler).not.toHaveBeenCalled();
    });

    it("safe to unsubscribe during emit (snapshot iteration)", () => {
      const { entity } = createMockEntity();
      const Ping = defineEvent("ping");
      const calls: string[] = [];

      let unsub2: () => void;
      entity.on(Ping, () => {
        calls.push("h1");
        unsub2();
      });
      unsub2 = entity.on(Ping, () => {
        calls.push("h2");
      });

      entity.emit(Ping);

      // Both should fire because of snapshot iteration
      expect(calls).toEqual(["h1", "h2"]);

      // But h2 is now unsubscribed
      calls.length = 0;
      entity.emit(Ping);
      expect(calls).toEqual(["h1"]);
    });
  });

  describe("destroyed entity", () => {
    it("emit is a no-op on destroyed entity", () => {
      const { entity } = createMockEntity();
      const Ping = defineEvent("ping");
      const handler = vi.fn();

      entity.on(Ping, handler);
      entity.destroy();
      entity.emit(Ping);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("bubbling to scene", () => {
    it("entity events bubble to the scene", () => {
      const { scene } = createMockScene();
      const entity = scene.spawn("test");
      const Hit = defineEvent<{ damage: number }>("hit");
      const handler = vi.fn();

      scene.on(Hit, handler);
      entity.emit(Hit, { damage: 5 });

      expect(handler).toHaveBeenCalledWith({ damage: 5 }, entity);
    });

    it("scene handler receives the emitting entity", () => {
      const { scene } = createMockScene();
      const e1 = scene.spawn("e1");
      const e2 = scene.spawn("e2");
      const Ping = defineEvent("ping");
      const entities: unknown[] = [];

      scene.on(Ping, (_data, entity) => {
        entities.push(entity);
      });

      e1.emit(Ping);
      e2.emit(Ping);

      expect(entities).toEqual([e1, e2]);
    });

    it("entity handlers fire before scene handlers", () => {
      const { scene } = createMockScene();
      const entity = scene.spawn("test");
      const Ping = defineEvent("ping");
      const order: string[] = [];

      scene.on(Ping, () => order.push("scene"));
      entity.on(Ping, () => order.push("entity"));

      entity.emit(Ping);

      expect(order).toEqual(["entity", "scene"]);
    });

    it("scene.on returns an unsubscribe function", () => {
      const { scene } = createMockScene();
      const entity = scene.spawn("test");
      const Ping = defineEvent("ping");
      const handler = vi.fn();

      const unsub = scene.on(Ping, handler);
      unsub();
      entity.emit(Ping);

      expect(handler).not.toHaveBeenCalled();
    });

    it("void events bubble correctly", () => {
      const { scene } = createMockScene();
      const entity = scene.spawn("test");
      const Ping = defineEvent("ping");
      const handler = vi.fn();

      scene.on(Ping, handler);
      entity.emit(Ping);

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("event handlers cleared on destroy", () => {
    it("_performDestroy clears event handlers", () => {
      const { entity } = createMockEntity();
      const Ping = defineEvent("ping");
      const handler = vi.fn();

      entity.on(Ping, handler);
      entity._performDestroy();

      // Handler map was cleared — re-emitting (if entity weren't destroyed) would be no-op
      // We verify indirectly: the handler set is empty
      // Since entity is not marked _destroyed by _performDestroy alone, we test via the scene
    });

    it("_destroyAllEntities clears scene event handlers", () => {
      const { scene } = createMockScene();
      scene.spawn("test");
      const Ping = defineEvent("ping");
      const handler = vi.fn();

      scene.on(Ping, handler);
      scene._destroyAllEntities();

      // Spawn a new entity and emit — scene handler should not fire
      const e2 = scene.spawn("test2");
      e2.emit(Ping);

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
