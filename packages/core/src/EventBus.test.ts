import { describe, it, expect, vi } from "vitest";
import { EventBus } from "./EventBus.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import type { ErrorPolicy } from "./ErrorBoundary.js";
import { Logger, LogLevel } from "./Logger.js";
import { GameLoop } from "./GameLoop.js";

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

  describe("with an error boundary wired", () => {
    function createWiredBus(policy: ErrorPolicy = "isolate") {
      const logger = new Logger({ level: LogLevel.Debug });
      const loop = new GameLoop();
      const boundary = new ErrorBoundary(logger, policy, loop);
      const bus = new EventBus<TestEvents>();
      bus._setErrorBoundary(boundary);
      return { bus, boundary, loop };
    }

    it("a throwing handler stays registered and keeps running on later emits", () => {
      const { bus, boundary } = createWiredBus();
      let calls = 0;
      bus.on("greet", () => {
        calls++;
        throw new Error("boom");
      });

      bus.emit("greet", { name: "a" });
      bus.emit("greet", { name: "b" });
      bus.emit("greet", { name: "c" });

      expect(calls).toBe(3); // still registered — never removed
      // Only the first failure is reported; the rest are muted.
      expect(boundary.getCallbackErrors()).toHaveLength(1);
    });

    it("does not stop other handlers on the same emit", () => {
      const { bus } = createWiredBus();
      const after = vi.fn();
      bus.on("greet", () => {
        throw new Error("boom");
      });
      bus.on("greet", after);

      bus.emit("greet", { name: "test" });

      expect(after).toHaveBeenCalledOnce();
    });

    it("a throwing tap observer is muted after its first failure and doesn't block handlers", () => {
      const { bus, boundary } = createWiredBus();
      const handler = vi.fn();
      bus.tap(() => {
        throw new Error("observer boom");
      });
      bus.on("greet", handler);

      bus.emit("greet", { name: "a" });
      bus.emit("greet", { name: "b" });

      expect(handler).toHaveBeenCalledTimes(2);
      expect(boundary.getCallbackErrors()).toHaveLength(1);
    });

    it("an async once() handler that rejects is reported through emit's boundary", async () => {
      const { bus, boundary } = createWiredBus();
      bus.once(
        "greet",
        (() => Promise.reject(new Error("async boom"))) as unknown as (
          data: TestEvents["greet"],
        ) => void,
      );

      bus.emit("greet", { name: "a" });
      await Promise.resolve();
      await Promise.resolve();

      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Event bus handler",
        error: "async boom",
      });
    });
  });

  describe("with a fatal error boundary wired", () => {
    function createWiredBus() {
      const logger = new Logger({ level: LogLevel.Debug });
      const loop = new GameLoop();
      const boundary = new ErrorBoundary(logger, "fatal", loop);
      const bus = new EventBus<TestEvents>();
      bus._setErrorBoundary(boundary);
      return { bus, boundary, loop };
    }

    it("a throwing handler stops the loop and rethrows out of emit()", () => {
      const { bus, loop } = createWiredBus();
      loop.start();
      bus.on("greet", () => {
        throw new Error("boom");
      });
      expect(() => bus.emit("greet", { name: "a" })).toThrow("boom");
      expect(loop.isRunning).toBe(false);
    });

    it("an async handler's rejection stops the loop and reaches the host's unhandled-rejection channel", async () => {
      const { bus, loop } = createWiredBus();
      loop.start();
      const rejection = new Promise<unknown>((resolve) => {
        process.once("unhandledRejection", resolve);
      });
      bus.on(
        "greet",
        (() => Promise.reject(new Error("async boom"))) as unknown as (
          data: TestEvents["greet"],
        ) => void,
      );
      bus.emit("greet", { name: "a" });
      const reason = await rejection;
      expect((reason as Error).message).toBe("async boom");
      expect(loop.isRunning).toBe(false);
    });
  });
});
