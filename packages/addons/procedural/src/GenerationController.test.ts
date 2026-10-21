import { describe, expect, it, vi } from "vitest";
import {
  advanceFrames,
  createTestEngine,
  ErrorBoundaryKey,
  InspectorKey,
  InspectorPlugin,
  Scene,
} from "@yagejs/core";
import { RoomGenerator } from "./core/RoomGenerator.js";
import { roomDefinition } from "./core/test-fixtures.js";
import {
  GenerationController,
  GenerationFinishedEvent,
} from "./GenerationController.js";

class TestScene extends Scene {
  readonly name = "generation";
}
describe("GenerationController", () => {
  it("uses component updates, pause/enable lifecycle and ordinary Inspector getters", async () => {
    const engine = await createTestEngine({ debug: true }, [
      new InspectorPlugin(),
    ]);
    try {
      const scene = new TestScene();
      await engine.scenes.push(scene);
      const host = scene.spawn("generator");
      const generator = new RoomGenerator(roomDefinition(), { seed: 2 });
      const controller = host.add(new GenerationController(generator, 1));
      const finished = vi.fn();
      host.on(GenerationFinishedEvent, finished);
      advanceFrames(engine, 1);
      expect(generator.steps).toBe(1);
      controller.enabled = false;
      advanceFrames(engine, 3);
      expect(generator.steps).toBe(1);
      controller.enabled = true;
      host.setActive(false);
      advanceFrames(engine, 3);
      expect(generator.steps).toBe(1);
      host.setActive(true);
      advanceFrames(engine, 300);
      expect(generator.status).toBe("succeeded");
      expect(finished).toHaveBeenCalledExactlyOnceWith({ status: "succeeded" });
      const inspected = engine.context
        .resolve(InspectorKey)
        .getComponentData("generator", "GenerationController");
      expect(inspected).toMatchObject({
        generation: {
          status: "succeeded",
          options: { seed: 2 },
          placedRooms: expect.any(Array),
          connections: expect.any(Array),
        },
      });
    } finally {
      engine.destroy();
    }
  });
  it("cancels unfinished work when removed or when its scene exits", async () => {
    const engine = await createTestEngine();
    try {
      const scene = new TestScene();
      await engine.scenes.push(scene);
      const first = new RoomGenerator(roomDefinition(), { seed: 1 });
      const host = scene.spawn("first");
      host.add(new GenerationController(first, 1));
      host.remove(GenerationController);
      expect(first.status).toBe("cancelled");
      const second = new RoomGenerator(roomDefinition(), { seed: 1 });
      scene.spawn("second").add(new GenerationController(second));
      await engine.scenes.pop();
      expect(second.status).toBe("cancelled");
    } finally {
      engine.destroy();
    }
  });
  it("attributes a throwing completion listener through the engine and stops fan-out", async () => {
    const engine = await createTestEngine();
    try {
      const scene = new TestScene();
      await engine.scenes.push(scene);
      const generator = new RoomGenerator(roomDefinition(), { seed: 0 });
      generator.generate();
      const host = scene.spawn("host");
      host.add(new GenerationController(generator));
      const later = vi.fn();
      host.on(GenerationFinishedEvent, () => {
        throw new Error("completion failed");
      });
      host.on(GenerationFinishedEvent, later);
      expect(() => advanceFrames(engine, 1)).toThrow("completion failed");
      expect(later).not.toHaveBeenCalled();
      expect(
        engine.context.resolve(ErrorBoundaryKey).getCallbackErrors(),
      ).toHaveLength(1);
    } finally {
      engine.destroy();
    }
  });
});
