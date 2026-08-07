import {
  Engine,
  Scene,
  SceneTime,
  SceneTimeKey,
  advanceFrames,
  createMockScene,
} from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { InputManager } from "./InputManager.js";
import { InputPlugin } from "./InputPlugin.js";
import { InputManagerKey } from "./types.js";

class GameScene extends Scene {
  readonly name = "game";
}

/** Pauses the scene below it, like a pause menu. */
class PauseScene extends Scene {
  readonly name = "pause";
}

async function startEngine(): Promise<Engine> {
  const engine = new Engine();
  engine.use(new InputPlugin({ actions: { jump: ["Space"] } }));
  await engine.start();
  return engine;
}

describe("buffered press on a scene clock", () => {
  it("holds the window across a pause menu and expires once the scene runs again", async () => {
    const engine = await startEngine();
    const game = new GameScene();
    await engine.scenes.push(game);
    const input = engine.context.resolve(InputManagerKey);
    const clock = game.tryResolveScoped(SceneTimeKey);
    if (!clock) throw new Error("Expected the engine to register a SceneTime");

    input.fireActionDown("jump");
    advanceFrames(engine, 1);

    // Half a second of pause menu. The input clock keeps running because
    // InputPollSystem is global; the game scene leaves activeScenes, so the
    // engine stops ticking its SceneTime.
    await engine.scenes.push(new PauseScene());
    advanceFrames(engine, 30);

    expect(clock.elapsed).toBeLessThan(0.12);
    expect(input.consumeBufferedPress("jump", 0.12)).toBe(false);
    expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(true);

    // Back in the game, the same window expires on the scene's own time.
    await engine.scenes.pop();
    input.fireActionUp("jump");
    input.fireActionDown("jump");
    advanceFrames(engine, 10);

    expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(false);
    engine.destroy();
  });

  it("holds the window while the scene is frozen", () => {
    const { scene } = createMockScene();
    const clock = new SceneTime(scene);
    const input = new InputManager();
    input.setActionMap({ jump: ["Space"] });
    input._registerClock(clock);

    clock.freezeFor(0.5);
    input.fireActionDown("jump");

    // A frozen scene still ticks — it just accrues nothing.
    clock._tick(0.2);
    input._advanceTime(200);

    expect(clock.elapsed).toBe(0);
    expect(input.consumeBufferedPress("jump", 0.12)).toBe(false);
    expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(true);
  });
});
