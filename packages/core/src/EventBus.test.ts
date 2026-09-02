import { describe, it, expect, vi } from "vitest";
import { EventBus } from "./EventBus.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Logger, LogLevel } from "./Logger.js";

interface TestEvents {
  greet: { name: string };
  count: { value: number };
  empty: undefined;
}

describe("EventBus", () => {
  it("calls handler on emit", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on("greet", handler);
    bus.emit("greet", { name: "Alice" });
    expect(handler).toHaveBeenCalledWith({ name: "Alice" });
  });

  it("calls multiple handlers in registration order", () => {
    const bus = new EventBus<TestEvents>();
    const order: number[] = [];
    bus.on("greet", () => order.push(1));
    bus.on("greet", () => order.push(2));
    bus.on("greet", () => order.push(3));
    bus.emit("greet", { name: "test" });
    expect(order).toEqual([1, 2, 3]);
  });

  it("returns unsubscribe function from on()", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsub = bus.on("greet", handler);
    unsub();
    bus.emit("greet", { name: "test" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("once() fires handler only once", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.once("greet", handler);
    bus.emit("greet", { name: "first" });
    bus.emit("greet", { name: "second" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ name: "first" });
  });

  it("once() returns unsubscribe that prevents firing", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsub = bus.once("greet", handler);
    unsub();
    bus.emit("greet", { name: "test" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does nothing when emitting with no handlers", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit("greet", { name: "test" })).not.toThrow();
  });

  it("clear(event) removes handlers for that event", () => {
    const bus = new EventBus<TestEvents>();
    const greetHandler = vi.fn();
    const countHandler = vi.fn();
    bus.on("greet", greetHandler);
    bus.on("count", countHandler);
    bus.clear("greet");
    bus.emit("greet", { name: "test" });
    bus.emit("count", { value: 42 });
    expect(greetHandler).not.toHaveBeenCalled();
    expect(countHandler).toHaveBeenCalledWith({ value: 42 });
  });

  it("clear() removes all handlers", () => {
    const bus = new EventBus<TestEvents>();
    const greetHandler = vi.fn();
    const countHandler = vi.fn();
    bus.on("greet", greetHandler);
    bus.on("count", countHandler);
    bus.clear();
    bus.emit("greet", { name: "test" });
    bus.emit("count", { value: 42 });
    expect(greetHandler).not.toHaveBeenCalled();
    expect(countHandler).not.toHaveBeenCalled();
  });

  it("handler can unsubscribe during emission", () => {
    const bus = new EventBus<TestEvents>();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const unsub = bus.on("greet", () => {
      handler1();
      unsub();
    });
    bus.on("greet", handler2);
    bus.emit("greet", { name: "test" });
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    // Second emit — handler1 should not fire
    bus.emit("greet", { name: "again" });
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(2);
  });

  it("handles undefined event data", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on("empty", handler);
    bus.emit("empty", undefined);
    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it("unsubscribe is safe after clear() removes all handlers", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsub = bus.on("greet", handler);
    bus.clear(); // removes the handlers map entry
    // Calling unsub should not throw even though the handler list is gone
    expect(() => unsub()).not.toThrow();
  });

  it("double unsubscribe is safe (handler already removed)", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsub = bus.on("greet", handler);
    unsub(); // first call removes the handler
    unsub(); // second call: arr exists but indexOf returns -1
    bus.emit("greet", { name: "test" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("an unsubscribe removes only its own registration, once", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const unsubFirst = bus.on("greet", handler);
    bus.on("greet", handler);

    unsubFirst();
    unsubFirst();
    bus.emit("greet", { name: "test" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("an unsubscribe held across clear(event) does not remove a later registration", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const stale = bus.on("greet", handler);
    bus.clear("greet");
    bus.on("greet", handler);

    stale();
    bus.emit("greet", { name: "test" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("once() fires once when an earlier handler re-emits the same event", () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    let reemitted = false;
    bus.once("greet", () => {
      order.push("A");
      if (!reemitted) {
        reemitted = true;
        bus.emit("greet", { name: "again" });
      }
    });
    bus.once("greet", () => order.push("B"));

    bus.emit("greet", { name: "first" });

    expect(order).toEqual(["A", "B"]);
  });

  describe("with an error boundary wired", () => {
    function createWiredBus() {
      const logger = new Logger({ level: LogLevel.Debug });
      const boundary = new ErrorBoundary(logger);
      const bus = new EventBus<TestEvents>();
      bus._setErrorBoundary(boundary);
      return { bus, boundary };
    }

    it("a throwing handler stays registered and rethrows on later emits too", () => {
      const { bus } = createWiredBus();
      let calls = 0;
      bus.on("greet", () => {
        calls++;
        throw new Error("boom");
      });

      expect(() => bus.emit("greet", { name: "a" })).toThrow("boom");
      expect(() => bus.emit("greet", { name: "b" })).toThrow("boom");
      expect(() => bus.emit("greet", { name: "c" })).toThrow("boom");

      expect(calls).toBe(3); // never removed
    });

    it("a throwing handler stops later handlers on the same emit and rethrows", () => {
      const { bus } = createWiredBus();
      const after = vi.fn();
      bus.on("greet", () => {
        throw new Error("boom");
      });
      bus.on("greet", after);

      expect(() => bus.emit("greet", { name: "test" })).toThrow("boom");

      expect(after).not.toHaveBeenCalled();
    });

    it("a throwing tap observer stops handlers on the same emit and rethrows", () => {
      const { bus } = createWiredBus();
      const handler = vi.fn();
      bus.tap(() => {
        throw new Error("observer boom");
      });
      bus.on("greet", handler);

      expect(() => bus.emit("greet", { name: "a" })).toThrow("observer boom");

      expect(handler).not.toHaveBeenCalled();
    });

    it("an async once() handler that rejects is reported through emit's boundary", async () => {
      const { bus, boundary } = createWiredBus();
      const rejection = new Promise<unknown>((resolve) => {
        process.once("unhandledRejection", resolve);
      });
      bus.once(
        "greet",
        (() => Promise.reject(new Error("async boom"))) as unknown as (
          data: TestEvents["greet"],
        ) => void,
      );

      bus.emit("greet", { name: "a" });
      const reason = await rejection;

      expect((reason as Error).message).toBe("async boom");
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Event bus handler",
        error: "async boom",
      });
    });
  });
});
