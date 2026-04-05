import { describe, it, expect, vi } from "vitest";
import { SceneManager } from "./SceneManager.js";
import { Scene } from "./Scene.js";
import {
  EngineContext,
  QueryCacheKey,
  EventBusKey,
  SceneManagerKey,
} from "./EngineContext.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { _resetEntityIdCounter } from "./Entity.js";

class GameScene extends Scene {
  readonly name: string;
  enterCalled = false;
  exitCalled = false;
  pauseCalled = false;
  resumeCalled = false;

  constructor(name: string) {
    super();
    this.name = name;
  }

  onEnter() {
    this.enterCalled = true;
  }
  onExit() {
    this.exitCalled = true;
  }
  onPause() {
    this.pauseCalled = true;
  }
  onResume() {
    this.resumeCalled = true;
  }
}

class OverlayScene extends Scene {
  readonly name = "overlay";
  override readonly pauseBelow = false;
  override readonly transparentBelow = true;
}

function setup() {
  _resetEntityIdCounter();
  const ctx = new EngineContext();
  ctx.register(QueryCacheKey, new QueryCache());
  ctx.register(EventBusKey, new EventBus<EngineEvents>());
  const manager = new SceneManager();
  ctx.register(SceneManagerKey, manager);
  manager._setContext(ctx);
  return { manager, ctx };
}

describe("SceneManager", () => {
  it("starts with no active scene", () => {
    const { manager } = setup();
    expect(manager.active).toBeUndefined();
    expect(manager.all).toEqual([]);
  });

  describe("push", () => {
    it("pushes a scene and calls onEnter", () => {
      const { manager } = setup();
      const scene = new GameScene("main");
      manager.push(scene);
      expect(manager.active).toBe(scene);
      expect(scene.enterCalled).toBe(true);
    });

    it("pauses previous scene when pauseBelow is true", () => {
      const { manager } = setup();
      const main = new GameScene("main");
      manager.push(main);
      const pause = new GameScene("pause");
      manager.push(pause);
      expect(main.pauseCalled).toBe(true);
      expect(main.isPaused).toBe(true);
    });

    it("does not pause previous scene when pauseBelow is false", () => {
      const { manager } = setup();
      const main = new GameScene("main");
      manager.push(main);
      const overlay = new OverlayScene();
      manager.push(overlay);
      expect(main.pauseCalled).toBe(false);
      expect(main.isPaused).toBe(false);
    });

    it("builds correct stack", () => {
      const { manager } = setup();
      const a = new GameScene("a");
      const b = new GameScene("b");
      manager.push(a);
      manager.push(b);
      expect(manager.all).toEqual([a, b]);
    });
  });

  describe("pop", () => {
    it("pops the active scene and calls onExit", () => {
      const { manager } = setup();
      const scene = new GameScene("main");
      manager.push(scene);
      const popped = manager.pop();
      expect(popped).toBe(scene);
      expect(scene.exitCalled).toBe(true);
      expect(manager.active).toBeUndefined();
    });

    it("resumes previous scene on pop", () => {
      const { manager } = setup();
      const main = new GameScene("main");
      const pause = new GameScene("pause");
      manager.push(main);
      manager.push(pause);
      manager.pop();
      expect(main.resumeCalled).toBe(true);
      expect(main.isPaused).toBe(false);
      expect(manager.active).toBe(main);
    });

    it("returns undefined when stack is empty", () => {
      const { manager } = setup();
      expect(manager.pop()).toBeUndefined();
    });

    it("destroys all entities in popped scene", () => {
      const { manager } = setup();
      const scene = new GameScene("main");
      manager.push(scene);
      scene.spawn("player");
      scene.spawn("enemy");
      manager.pop();
      expect(scene.getEntities().size).toBe(0);
    });
  });

  describe("replace", () => {
    it("replaces top scene", () => {
      const { manager } = setup();
      const old = new GameScene("old");
      const next = new GameScene("new");
      manager.push(old);
      manager.replace(next);
      expect(old.exitCalled).toBe(true);
      expect(next.enterCalled).toBe(true);
      expect(manager.active).toBe(next);
      expect(manager.all).toEqual([next]);
    });

    it("works on empty stack (like push)", () => {
      const { manager } = setup();
      const scene = new GameScene("first");
      manager.replace(scene);
      expect(manager.active).toBe(scene);
      expect(scene.enterCalled).toBe(true);
    });

    it("fires onPause when replacing non-pausing scene with pausing scene", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const overlay = new OverlayScene(); // pauseBelow=false
      const pauseMenu = new GameScene("pauseMenu"); // pauseBelow=true
      manager.push(game);
      manager.push(overlay);
      expect(game.isPaused).toBe(false); // overlay doesn't pause below
      manager.replace(pauseMenu); // replace overlay with pauseMenu
      expect(game.isPaused).toBe(true);
      expect(game.pauseCalled).toBe(true);
    });

    it("fires onResume when replacing pausing scene with non-pausing scene", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const pauseMenu = new GameScene("pauseMenu"); // pauseBelow=true
      manager.push(game);
      manager.push(pauseMenu);
      expect(game.isPaused).toBe(true);
      const overlay = new OverlayScene(); // pauseBelow=false
      manager.replace(overlay); // replace pauseMenu with overlay
      expect(game.isPaused).toBe(false);
      expect(game.resumeCalled).toBe(true);
    });
  });

  describe("clear", () => {
    it("clears all scenes from top to bottom", () => {
      const { manager } = setup();
      const a = new GameScene("a");
      const b = new GameScene("b");
      manager.push(a);
      manager.push(b);
      manager.clear();
      expect(a.exitCalled).toBe(true);
      expect(b.exitCalled).toBe(true);
      expect(manager.all).toEqual([]);
      expect(manager.active).toBeUndefined();
    });
  });

  describe("events", () => {
    it("emits scene:pushed on push", () => {
      const { manager, ctx } = setup();
      const bus = ctx.resolve(EventBusKey);
      const handler = vi.fn();
      bus.on("scene:pushed", handler);
      const scene = new GameScene("main");
      manager.push(scene);
      expect(handler).toHaveBeenCalledWith({ scene });
    });

    it("emits scene:popped on pop", () => {
      const { manager, ctx } = setup();
      const bus = ctx.resolve(EventBusKey);
      const handler = vi.fn();
      bus.on("scene:popped", handler);
      const scene = new GameScene("main");
      manager.push(scene);
      manager.pop();
      expect(handler).toHaveBeenCalledWith({ scene });
    });

    it("emits scene:replaced on replace", () => {
      const { manager, ctx } = setup();
      const bus = ctx.resolve(EventBusKey);
      const handler = vi.fn();
      bus.on("scene:replaced", handler);
      const old = new GameScene("old");
      const next = new GameScene("new");
      manager.push(old);
      manager.replace(next);
      expect(handler).toHaveBeenCalledWith({ oldScene: old, newScene: next });
    });
  });

  describe("clear edge cases", () => {
    it("handles corrupted stack with undefined entry gracefully", () => {
      const { manager } = setup();
      // Inject an undefined into the internal stack to trigger the defensive guard.
      // This simulates an impossible state where pop() returns undefined despite length > 0.
      const stack = (manager as unknown as { stack: Array<Scene | undefined> })["stack"];
      stack.push(undefined as unknown as Scene);
      // clear should not throw — the guard breaks out of the loop
      manager.clear();
      expect(manager.active).toBeUndefined();
    });
  });

  describe("_flushDestroyQueues", () => {
    it("flushes destroy queues for all scenes", () => {
      const { manager } = setup();
      const scene = new GameScene("main");
      manager.push(scene);
      const e = scene.spawn("doomed");
      scene.destroyEntity(e);
      expect(scene.getEntities().size).toBe(1);
      manager._flushDestroyQueues();
      expect(scene.getEntities().size).toBe(0);
    });
  });

  describe("activeScenes", () => {
    it("returns all non-paused scenes", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      manager.push(game);
      expect(manager.activeScenes).toEqual([game]);
    });

    it("excludes stack-paused scenes", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const pause = new GameScene("pause");
      manager.push(game);
      manager.push(pause);
      // game is stack-paused (pause.pauseBelow = true)
      expect(manager.activeScenes).toEqual([pause]);
    });

    it("includes scenes below a non-pausing overlay", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const overlay = new OverlayScene();
      manager.push(game);
      manager.push(overlay);
      // overlay.pauseBelow = false, so game is still active
      expect(manager.activeScenes).toEqual([game, overlay]);
    });

    it("excludes manually paused scenes", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      manager.push(game);
      game.paused = true;
      expect(manager.activeScenes).toEqual([]);
    });
  });

  describe("cascade pause", () => {
    it("pauses all scenes below a pauseBelow scene through overlays", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const hud = new OverlayScene(); // pauseBelow=false
      const pauseMenu = new GameScene("pauseMenu"); // pauseBelow=true
      manager.push(game);
      manager.push(hud);
      manager.push(pauseMenu);
      // Both game and hud should be paused because pauseMenu.pauseBelow=true
      expect(game.isPaused).toBe(true);
      expect(hud.isPaused).toBe(true);
      expect(pauseMenu.isPaused).toBe(false);
      expect(manager.activeScenes).toEqual([pauseMenu]);
    });

    it("restores correct state after pop", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const pauseMenu = new GameScene("pause");
      manager.push(game);
      manager.push(pauseMenu);
      expect(game.isPaused).toBe(true);
      manager.pop();
      expect(game.isPaused).toBe(false);
      expect(game.resumeCalled).toBe(true);
    });

    it("keeps deeper scenes paused after popping top when middle scene has pauseBelow", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const pause1 = new GameScene("pause1");
      const pause2 = new GameScene("pause2");
      manager.push(game);
      manager.push(pause1); // pauses game
      manager.push(pause2); // pauses pause1 (and game stays paused)
      expect(game.isPaused).toBe(true);
      expect(pause1.isPaused).toBe(true);
      manager.pop(); // pop pause2
      // pause1 still has pauseBelow=true, so game stays paused
      expect(game.isPaused).toBe(true);
      expect(pause1.isPaused).toBe(false);
    });

    it("fires onPause on all affected scenes during push", () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const hud = new OverlayScene(); // pauseBelow=false
      manager.push(game);
      manager.push(hud);
      expect(game.pauseCalled).toBe(false); // hud doesn't pause below
      const pauseMenu = new GameScene("pauseMenu");
      manager.push(pauseMenu);
      // Both game and hud should have received onPause
      expect(game.pauseCalled).toBe(true);
    });
  });
});
