import { describe, it, expect, vi } from "vitest";
import { SceneManager } from "./SceneManager.js";
import { Scene } from "./Scene.js";
import {
  EngineContext,
  QueryCacheKey,
  EventBusKey,
  SceneManagerKey,
  ServiceKey,
} from "./EngineContext.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { _resetEntityIdCounter } from "./Entity.js";
import { SceneHookRegistry, SceneHookRegistryKey } from "./SceneHooks.js";
import type { SceneTransition } from "./SceneTransition.js";

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

function setupWithHooks() {
  _resetEntityIdCounter();
  const ctx = new EngineContext();
  ctx.register(QueryCacheKey, new QueryCache());
  ctx.register(EventBusKey, new EventBus<EngineEvents>());
  const hooks = new SceneHookRegistry();
  ctx.register(SceneHookRegistryKey, hooks);
  const manager = new SceneManager();
  ctx.register(SceneManagerKey, manager);
  manager._setContext(ctx);
  return { manager, ctx, hooks };
}

describe("SceneManager", () => {
  it("starts with no active scene", async () => {
    const { manager } = setup();
    expect(manager.active).toBeUndefined();
    expect(manager.all).toEqual([]);
  });

  describe("push", () => {
    it("pushes a scene and calls onEnter", async () => {
      const { manager } = setup();
      const scene = new GameScene("main");
      await manager.push(scene);
      expect(manager.active).toBe(scene);
      expect(scene.enterCalled).toBe(true);
    });

    it("pauses previous scene when pauseBelow is true", async () => {
      const { manager } = setup();
      const main = new GameScene("main");
      await manager.push(main);
      const pause = new GameScene("pause");
      await manager.push(pause);
      expect(main.pauseCalled).toBe(true);
      expect(main.isPaused).toBe(true);
    });

    it("does not pause previous scene when pauseBelow is false", async () => {
      const { manager } = setup();
      const main = new GameScene("main");
      await manager.push(main);
      const overlay = new OverlayScene();
      await manager.push(overlay);
      expect(main.pauseCalled).toBe(false);
      expect(main.isPaused).toBe(false);
    });

    it("builds correct stack", async () => {
      const { manager } = setup();
      const a = new GameScene("a");
      const b = new GameScene("b");
      await manager.push(a);
      await manager.push(b);
      expect(manager.all).toEqual([a, b]);
    });
  });

  describe("pop", () => {
    it("pops the active scene and calls onExit", async () => {
      const { manager } = setup();
      const scene = new GameScene("main");
      await manager.push(scene);
      const popped = await manager.pop();
      expect(popped).toBe(scene);
      expect(scene.exitCalled).toBe(true);
      expect(manager.active).toBeUndefined();
    });

    it("resumes previous scene on pop", async () => {
      const { manager } = setup();
      const main = new GameScene("main");
      const pause = new GameScene("pause");
      await manager.push(main);
      await manager.push(pause);
      await manager.pop();
      expect(main.resumeCalled).toBe(true);
      expect(main.isPaused).toBe(false);
      expect(manager.active).toBe(main);
    });

    it("returns undefined when stack is empty", async () => {
      const { manager } = setup();
      expect(await manager.pop()).toBeUndefined();
    });

    it("destroys all entities in popped scene", async () => {
      const { manager } = setup();
      const scene = new GameScene("main");
      await manager.push(scene);
      scene.spawn("player");
      scene.spawn("enemy");
      await manager.pop();
      expect(scene.getEntities().size).toBe(0);
    });
  });

  describe("replace", () => {
    it("replaces top scene", async () => {
      const { manager } = setup();
      const old = new GameScene("old");
      const next = new GameScene("new");
      await manager.push(old);
      await manager.replace(next);
      expect(old.exitCalled).toBe(true);
      expect(next.enterCalled).toBe(true);
      expect(manager.active).toBe(next);
      expect(manager.all).toEqual([next]);
    });

    it("works on empty stack (like push)", async () => {
      const { manager } = setup();
      const scene = new GameScene("first");
      await manager.replace(scene);
      expect(manager.active).toBe(scene);
      expect(scene.enterCalled).toBe(true);
    });

    it("fires onPause when replacing non-pausing scene with pausing scene", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const overlay = new OverlayScene(); // pauseBelow=false
      const pauseMenu = new GameScene("pauseMenu"); // pauseBelow=true
      await manager.push(game);
      await manager.push(overlay);
      expect(game.isPaused).toBe(false); // overlay doesn't pause below
      await manager.replace(pauseMenu); // replace overlay with pauseMenu
      expect(game.isPaused).toBe(true);
      expect(game.pauseCalled).toBe(true);
    });

    it("fires onResume when replacing pausing scene with non-pausing scene", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const pauseMenu = new GameScene("pauseMenu"); // pauseBelow=true
      await manager.push(game);
      await manager.push(pauseMenu);
      expect(game.isPaused).toBe(true);
      const overlay = new OverlayScene(); // pauseBelow=false
      await manager.replace(overlay); // replace pauseMenu with overlay
      expect(game.isPaused).toBe(false);
      expect(game.resumeCalled).toBe(true);
    });
  });

  describe("clear", () => {
    it("clears all scenes from top to bottom", async () => {
      const { manager } = setup();
      const a = new GameScene("a");
      const b = new GameScene("b");
      await manager.push(a);
      await manager.push(b);
      manager.clear();
      expect(a.exitCalled).toBe(true);
      expect(b.exitCalled).toBe(true);
      expect(manager.all).toEqual([]);
      expect(manager.active).toBeUndefined();
    });
  });

  describe("events", () => {
    it("emits scene:pushed on push", async () => {
      const { manager, ctx } = setup();
      const bus = ctx.resolve(EventBusKey);
      const handler = vi.fn();
      bus.on("scene:pushed", handler);
      const scene = new GameScene("main");
      await manager.push(scene);
      expect(handler).toHaveBeenCalledWith({ scene });
    });

    it("emits scene:popped on pop", async () => {
      const { manager, ctx } = setup();
      const bus = ctx.resolve(EventBusKey);
      const handler = vi.fn();
      bus.on("scene:popped", handler);
      const scene = new GameScene("main");
      await manager.push(scene);
      await manager.pop();
      expect(handler).toHaveBeenCalledWith({ scene });
    });

    it("emits scene:replaced on replace", async () => {
      const { manager, ctx } = setup();
      const bus = ctx.resolve(EventBusKey);
      const handler = vi.fn();
      bus.on("scene:replaced", handler);
      const old = new GameScene("old");
      const next = new GameScene("new");
      await manager.push(old);
      await manager.replace(next);
      expect(handler).toHaveBeenCalledWith({ oldScene: old, newScene: next });
    });
  });

  describe("clear edge cases", () => {
    it("handles corrupted stack with undefined entry gracefully", async () => {
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
    it("flushes destroy queues for all scenes", async () => {
      const { manager } = setup();
      const scene = new GameScene("main");
      await manager.push(scene);
      const e = scene.spawn("doomed");
      scene.destroyEntity(e);
      expect(scene.getEntities().size).toBe(1);
      manager._flushDestroyQueues();
      expect(scene.getEntities().size).toBe(0);
    });
  });

  describe("activeScenes", () => {
    it("returns all non-paused scenes", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      await manager.push(game);
      expect(manager.activeScenes).toEqual([game]);
    });

    it("excludes stack-paused scenes", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const pause = new GameScene("pause");
      await manager.push(game);
      await manager.push(pause);
      // game is stack-paused (pause.pauseBelow = true)
      expect(manager.activeScenes).toEqual([pause]);
    });

    it("includes scenes below a non-pausing overlay", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const overlay = new OverlayScene();
      await manager.push(game);
      await manager.push(overlay);
      // overlay.pauseBelow = false, so game is still active
      expect(manager.activeScenes).toEqual([game, overlay]);
    });

    it("excludes manually paused scenes", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      await manager.push(game);
      game.paused = true;
      expect(manager.activeScenes).toEqual([]);
    });
  });

  describe("cascade pause", () => {
    it("pauses all scenes below a pauseBelow scene through overlays", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const hud = new OverlayScene(); // pauseBelow=false
      const pauseMenu = new GameScene("pauseMenu"); // pauseBelow=true
      await manager.push(game);
      await manager.push(hud);
      await manager.push(pauseMenu);
      // Both game and hud should be paused because pauseMenu.pauseBelow=true
      expect(game.isPaused).toBe(true);
      expect(hud.isPaused).toBe(true);
      expect(pauseMenu.isPaused).toBe(false);
      expect(manager.activeScenes).toEqual([pauseMenu]);
    });

    it("restores correct state after pop", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const pauseMenu = new GameScene("pause");
      await manager.push(game);
      await manager.push(pauseMenu);
      expect(game.isPaused).toBe(true);
      await manager.pop();
      expect(game.isPaused).toBe(false);
      expect(game.resumeCalled).toBe(true);
    });

    it("keeps deeper scenes paused after popping top when middle scene has pauseBelow", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const pause1 = new GameScene("pause1");
      const pause2 = new GameScene("pause2");
      await manager.push(game);
      await manager.push(pause1); // pauses game
      await manager.push(pause2); // pauses pause1 (and game stays paused)
      expect(game.isPaused).toBe(true);
      expect(pause1.isPaused).toBe(true);
      await manager.pop(); // pop pause2
      // pause1 still has pauseBelow=true, so game stays paused
      expect(game.isPaused).toBe(true);
      expect(pause1.isPaused).toBe(false);
    });

    it("fires onPause on all affected scenes during push", async () => {
      const { manager } = setup();
      const game = new GameScene("game");
      const hud = new OverlayScene(); // pauseBelow=false
      await manager.push(game);
      await manager.push(hud);
      expect(game.pauseCalled).toBe(false); // hud doesn't pause below
      const pauseMenu = new GameScene("pauseMenu");
      await manager.push(pauseMenu);
      // Both game and hud should have received onPause
      expect(game.pauseCalled).toBe(true);
    });
  });

  describe("scene hooks", () => {

    it("runs beforeEnter and afterExit hooks around push / pop", async () => {
      const { manager, hooks } = setupWithHooks();
      const events: string[] = [];
      hooks.register({
        beforeEnter: (s) => {
          events.push(`before:${s.name}`);
        },
        afterExit: (s) => {
          events.push(`after:${s.name}`);
        },
      });
      const scene = new GameScene("game");
      await manager.push(scene);
      expect(events).toEqual(["before:game"]);
      expect(scene.enterCalled).toBe(true);
      await manager.pop();
      expect(events).toEqual(["before:game", "after:game"]);
    });

    it("awaits async beforeEnter hooks before onEnter fires", async () => {
      const { manager, hooks } = setupWithHooks();
      let hookCompleted = false;
      hooks.register({
        beforeEnter: () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              hookCompleted = true;
              resolve();
            }, 0);
          }),
      });
      const scene = new GameScene("g");
      await manager.push(scene);
      expect(hookCompleted).toBe(true);
      expect(scene.enterCalled).toBe(true);
    });

    it("clears scoped services after afterExit", async () => {
      const { manager, hooks } = setupWithHooks();
      const key = new ServiceKey<string>("scoped-test", { scope: "scene" });
      let sawScoped: string | undefined;
      hooks.register({
        beforeEnter: (s) => {
          s._registerScoped(key, "hello");
        },
        afterExit: (s) => {
          sawScoped = s._resolveScoped(key);
        },
      });
      const scene = new GameScene("g");
      await manager.push(scene);
      await manager.pop();
      // afterExit hook should have seen the scoped value still present.
      expect(sawScoped).toBe("hello");
      // After pop, the map is cleared.
      expect(scene._resolveScoped(key)).toBeUndefined();
    });

    it("_mountDetached runs hooks + onEnter without mutating the stack", async () => {
      const { manager, hooks } = setupWithHooks();
      let beforeCount = 0;
      hooks.register({
        beforeEnter: () => {
          beforeCount++;
        },
      });
      const detached = new GameScene("detached");
      await manager._mountDetached(detached);
      expect(beforeCount).toBe(1);
      expect(detached.enterCalled).toBe(true);
      expect(manager.all).toHaveLength(0);
    });

    it("_unmountDetached runs afterExit + onExit for a detached scene", async () => {
      const { manager, hooks } = setupWithHooks();
      let afterCount = 0;
      hooks.register({
        afterExit: () => {
          afterCount++;
        },
      });
      const detached = new GameScene("detached");
      await manager._mountDetached(detached);
      manager._unmountDetached(detached);
      expect(detached.exitCalled).toBe(true);
      expect(afterCount).toBe(1);
    });
  });

  describe("scene hooks (extended)", () => {

    it("runs hooks on replace (afterExit for old, beforeEnter for new)", async () => {
      const { manager, hooks } = setupWithHooks();
      const events: string[] = [];
      hooks.register({
        beforeEnter: (s) => {
          events.push(`before:${s.name}`);
        },
        afterExit: (s) => {
          events.push(`after:${s.name}`);
        },
      });
      const first = new GameScene("first");
      await manager.push(first);
      const second = new GameScene("second");
      await manager.replace(second);
      expect(events).toEqual([
        "before:first",
        "after:first",
        "before:second",
      ]);
    });

    it("runs afterExit hooks on clear for every scene", async () => {
      const { manager, hooks } = setupWithHooks();
      const exited: string[] = [];
      hooks.register({
        afterExit: (s) => {
          exited.push(s.name);
        },
      });
      await manager.push(new GameScene("a"));
      await manager.push(new GameScene("b"));
      await manager.push(new GameScene("c"));
      manager.clear();
      // Cleared top-to-bottom
      expect(exited).toEqual(["c", "b", "a"]);
    });
  });

  describe("reentrant guard", () => {
    it("throws when push is called during an in-progress push", async () => {
      const { manager, hooks } = setupWithHooks();
      hooks.register({
        beforeEnter: async () => {
          // Attempt reentrant push inside a hook
          await expect(
            manager.push(new GameScene("reentrant")),
          ).rejects.toThrow("called during an in-progress transition");
        },
      });
      await manager.push(new GameScene("main"));
    });

    it("rejects when pop is called during an in-progress push", async () => {
      const { manager, hooks } = setupWithHooks();
      await manager.push(new GameScene("base"));
      let popPromise: Promise<unknown> | undefined;
      hooks.register({
        beforeEnter: () => {
          popPromise = manager.pop();
        },
      });
      await manager.push(new GameScene("trigger"));
      await expect(popPromise).rejects.toThrow(
        "called during an in-progress transition",
      );
    });
  });

  describe("pause/resume ordering", () => {
    it("fires onPause after onEnter during push", async () => {
      const { manager } = setupWithHooks();
      const events: string[] = [];
      class TrackedScene extends Scene {
        readonly name: string;
        constructor(name: string) {
          super();
          this.name = name;
        }
        onEnter() {
          events.push(`enter:${this.name}`);
        }
        onPause() {
          events.push(`pause:${this.name}`);
        }
      }
      const game = new TrackedScene("game");
      await manager.push(game);
      const menu = new TrackedScene("menu");
      await manager.push(menu);
      // game.onPause should fire AFTER menu.onEnter
      expect(events).toEqual(["enter:game", "enter:menu", "pause:game"]);
    });

    it("fires onResume after old scene exits during replace", async () => {
      const { manager } = setupWithHooks();
      const events: string[] = [];
      class TrackedScene extends Scene {
        readonly name: string;
        override readonly pauseBelow: boolean;
        constructor(name: string, pauseBelow = true) {
          super();
          this.name = name;
          this.pauseBelow = pauseBelow;
        }
        onEnter() {
          events.push(`enter:${this.name}`);
        }
        onResume() {
          events.push(`resume:${this.name}`);
        }
      }
      const game = new TrackedScene("game");
      await manager.push(game);
      const pause = new TrackedScene("pause", true);
      await manager.push(pause);
      events.length = 0; // reset

      const overlay = new TrackedScene("overlay", false);
      await manager.replace(overlay);
      // game.onResume should fire AFTER overlay.onEnter
      expect(events).toEqual(["enter:overlay", "resume:game"]);
    });
  });

  describe("transitions", () => {
    function makeFakeTransition(
      duration: number,
      log?: string[],
    ): {
      transition: SceneTransition;
      ticks: Array<{ dt: number; elapsed: number }>;
    } {
      const ticks: Array<{ dt: number; elapsed: number }> = [];
      return {
        ticks,
        transition: {
          duration,
          begin(ctx) {
            log?.push(`begin(${ctx.elapsed})`);
          },
          tick(dt, ctx) {
            ticks.push({ dt, elapsed: ctx.elapsed });
            log?.push(`tick(${dt},${ctx.elapsed})`);
          },
          end(ctx) {
            log?.push(`end(${ctx.elapsed})`);
          },
        },
      };
    }

    async function flush(): Promise<void> {
      await new Promise((r) => setTimeout(r, 0));
    }

    it("isTransitioning is true during a transition", async () => {
      const { manager } = setup();
      const scene = new GameScene("main");
      const { transition } = makeFakeTransition(100);
      const p = manager.push(scene, { transition });
      await flush();
      expect(manager.isTransitioning).toBe(true);
      manager._tickTransition(100);
      await p;
      expect(manager.isTransitioning).toBe(false);
    });

    it("isTransitioning is false when no transition is provided", async () => {
      const { manager } = setup();
      await manager.push(new GameScene("main"));
      expect(manager.isTransitioning).toBe(false);
    });

    it("_tickTransition advances elapsed and calls tick", async () => {
      const { manager } = setup();
      const { transition, ticks } = makeFakeTransition(100);
      const p = manager.push(new GameScene("a"), { transition });
      await flush();
      manager._tickTransition(16);
      expect(ticks).toHaveLength(1);
      expect(ticks[0]!.dt).toBe(16);
      expect(ticks[0]!.elapsed).toBe(16);
      manager._tickTransition(84);
      await p;
    });

    it("calls begin on first tick and end when elapsed >= duration", async () => {
      const { manager } = setup();
      const log: string[] = [];
      const { transition } = makeFakeTransition(50, log);
      const p = manager.push(new GameScene("a"), { transition });
      await flush();
      manager._tickTransition(20);
      expect(log).toContain("begin(0)");
      manager._tickTransition(30);
      expect(log).toContain("end(50)");
      expect(manager.isTransitioning).toBe(false);
      await p;
    });

    it("zero-duration transition calls begin and end immediately", async () => {
      const { manager } = setup();
      const log: string[] = [];
      const { transition } = makeFakeTransition(0, log);
      await manager.push(new GameScene("a"), { transition });
      expect(log).toContain("begin(0)");
      expect(log).toContain("end(0)");
      expect(manager.isTransitioning).toBe(false);
    });

    it("queues sequential pushes", async () => {
      const { manager } = setup();
      const { transition: t1 } = makeFakeTransition(100);
      const { transition: t2 } = makeFakeTransition(100);
      const p1 = manager.push(new GameScene("a"), { transition: t1 });
      const p2 = manager.push(new GameScene("b"), { transition: t2 });
      await flush();
      expect(manager.isTransitioning).toBe(true);
      manager._tickTransition(100);
      await p1;
      await flush();
      expect(manager.isTransitioning).toBe(true);
      manager._tickTransition(100);
      await p2;
      expect(manager.isTransitioning).toBe(false);
      expect(manager.all).toHaveLength(2);
    });

    it("clear() during an active transition calls end and cancels queued ops", async () => {
      const { manager } = setup();
      const log: string[] = [];
      const { transition } = makeFakeTransition(200, log);
      const pushPromise = manager.push(new GameScene("a"), { transition });
      await flush();
      manager._tickTransition(50);
      expect(manager.isTransitioning).toBe(true);

      const { transition: t2 } = makeFakeTransition(100);
      const queuedPromise = manager.push(new GameScene("b"), {
        transition: t2,
      });

      manager.clear();
      expect(manager.isTransitioning).toBe(false);
      expect(log).toContain("end(50)");
      expect(manager.all).toHaveLength(0);

      await pushPromise;
      await queuedPromise;
      expect(manager.all).toHaveLength(0);
    });

    it("pop with transition runs transition before removing", async () => {
      const { manager } = setup();
      await manager.push(new GameScene("a"));
      await manager.push(new GameScene("b"));
      const log: string[] = [];
      const { transition } = makeFakeTransition(100, log);
      const popPromise = manager.pop({ transition });
      await flush();
      expect(manager.all).toHaveLength(2);
      manager._tickTransition(100);
      const popped = await popPromise;
      expect(popped?.name).toBe("b");
      expect(manager.all).toHaveLength(1);
      expect(log).toContain("begin(0)");
      expect(log).toContain("end(100)");
    });

    it("replace with transition keeps both scenes during transition", async () => {
      const { manager, ctx } = setup();
      const bus = ctx.resolve(EventBusKey);
      const replaceHandler = vi.fn();
      bus.on("scene:replaced", replaceHandler);

      const old = new GameScene("old");
      await manager.push(old);
      const log: string[] = [];
      const { transition } = makeFakeTransition(100, log);
      const replacePromise = manager.replace(new GameScene("new"), {
        transition,
      });
      await flush();
      expect(manager.all).toHaveLength(2);
      expect(old.exitCalled).toBe(false);

      manager._tickTransition(100);
      await replacePromise;

      expect(old.exitCalled).toBe(true);
      expect(manager.all).toHaveLength(1);
      expect(manager.active?.name).toBe("new");
      expect(replaceHandler).toHaveBeenCalledTimes(1);
      expect(log).toContain("end(100)");
    });

    it("emits scene:transition:started and scene:transition:ended events", async () => {
      const { manager, ctx } = setup();
      const bus = ctx.resolve(EventBusKey);
      const started = vi.fn();
      const ended = vi.fn();
      bus.on("scene:transition:started", started);
      bus.on("scene:transition:ended", ended);

      const { transition } = makeFakeTransition(50);
      const scene = new GameScene("a");
      const p = manager.push(scene, { transition });
      await flush();
      expect(started).toHaveBeenCalledWith({
        kind: "push",
        fromScene: undefined,
        toScene: scene,
      });
      manager._tickTransition(50);
      expect(ended).toHaveBeenCalledWith({
        kind: "push",
        fromScene: undefined,
        toScene: scene,
      });
      await p;
    });

    it("does not re-call begin if it throws on first tick", async () => {
      const { manager } = setup();
      let beginCalls = 0;
      const transition: SceneTransition = {
        duration: 100,
        begin() {
          beginCalls++;
          throw new Error("boom");
        },
        tick() {},
      };
      const p = manager.push(new GameScene("a"), { transition });
      await flush();
      manager._tickTransition(16);
      manager._tickTransition(16);
      manager._tickTransition(16);
      expect(beginCalls).toBe(1);
      manager._tickTransition(100);
      await p;
    });

    it("scene.isTransitioning reflects manager state", async () => {
      const { manager } = setup();
      const scene = new GameScene("a");
      const { transition } = makeFakeTransition(100);
      const p = manager.push(scene, { transition });
      await flush();
      expect(scene.isTransitioning).toBe(true);
      manager._tickTransition(100);
      await p;
      expect(scene.isTransitioning).toBe(false);
    });
  });
});
