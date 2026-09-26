import { describe, it, expect, vi } from "vitest";
import { Engine } from "./Engine.js";
import {
  ErrorBoundaryKey,
  GameLoopKey,
  SystemSchedulerKey,
} from "./EngineContext.js";

describe("Engine startup", () => {
  it("ignores external ticker callbacks that fire before startup completes", async () => {
    vi.useFakeTimers();

    const engine = new Engine();
    engine
      .use({
        name: "early-ticker",
        version: "1.0.0",
        install: (context) => {
          const loop = context.resolve(GameLoopKey);
          loop.attachTicker((callback) => {
            const timeout = setTimeout(() => callback(20), 0);
            return () => clearTimeout(timeout);
          });
        },
      })
      .use({
        name: "async-install",
        version: "1.0.0",
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      });

    try {
      const startPromise = engine.start();
      await vi.advanceTimersByTimeAsync(20);
      await startPromise;

      expect(engine.loop.frameCount).toBe(0);
      expect(
        engine.context.resolve(ErrorBoundaryKey).getCallbackErrors(),
      ).toEqual([]);
      expect(
        engine.context
          .resolve(SystemSchedulerKey)
          .getAllSystems()
          .every((system) => system.enabled),
      ).toBe(true);
    } finally {
      engine.destroy();
      vi.useRealTimers();
    }
  });
});
