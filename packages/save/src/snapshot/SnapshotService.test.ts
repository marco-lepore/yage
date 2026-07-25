import { describe, it, expect, vi } from "vitest";
import {
  Scene,
  Entity,
  Component,
  Transform,
  EngineContext,
  SceneManagerKey,
  QueryCacheKey,
  EventBusKey,
  ErrorBoundaryKey,
  _resetEntityIdCounter,
  QueryCache,
  EventBus,
  ErrorBoundary,
  Logger,
  LogLevel,
  SceneManager,
  serializable,
} from "@yagejs/core";
import type { EngineEvents } from "@yagejs/core";
import type { SnapshotResolver } from "@yagejs/core";
import { MemoryStorage } from "./test-helpers.js";
import type { GameSnapshot } from "./types.js";
import { SnapshotService } from "./SnapshotService.js";
import { SnapshotServiceKey } from "./keys.js";

// ---- Custom serializable component for testing ----

@serializable
class HealthComponent extends Component {
  hp: number;
  constructor(hp = 100) {
    super();
    this.hp = hp;
  }
  serialize() {
    return { hp: this.hp };
  }
  static fromSnapshot(data: { hp: number }): HealthComponent {
    return new HealthComponent(data.hp);
  }
}

// ---- Test entities ----

@serializable
class MockEntity extends Entity {
  restored = false;
  userData: unknown = null;

  setup() {
    this.add(new Transform({ position: { x: 10, y: 20 } }));
    this.add(new HealthComponent(100));
  }

  serialize() {
    return { tag: "mock-user-data" };
  }

  afterRestore(data: unknown) {
    this.restored = true;
    this.userData = data;
  }
}

@serializable
class SimpleEntity extends Entity {
  setup() {
    this.add(new Transform());
  }
}

@serializable
class ParentEntity extends Entity {
  setup() {
    this.add(new Transform({ position: { x: 50, y: 50 } }));
  }
}

@serializable
class ChildEntity extends Entity {
  setup() {
    this.add(new Transform({ position: { x: 10, y: 0 } }));
  }
}

@serializable
class RefHolderEntity extends Entity {
  targetId = -1;
  resolvedTarget: Entity | null = null;

  setup() {
    this.add(new Transform());
  }

  serialize() {
    return { targetId: this.targetId };
  }

  afterRestore(data: { targetId: number }, resolve: SnapshotResolver) {
    this.targetId = data.targetId;
    this.resolvedTarget = resolve.entity(data.targetId);
  }
}

// ---- Test scene ----

@serializable
class MockScene extends Scene {
  readonly name = "mock";
  enterCalled = false;
  restored = false;
  restoredData: unknown = null;

  onEnter() {
    this.enterCalled = true;
    this.spawn(MockEntity);
    this.spawn(SimpleEntity);
  }

  serialize() {
    return { counter: 42 };
  }

  afterRestore(data: unknown) {
    this.restored = true;
    this.restoredData = data;
  }
}

@serializable
class HierarchyScene extends Scene {
  readonly name = "hierarchy";

  onEnter() {
    const parent = this.spawn(ParentEntity);
    const child = this.spawn(ChildEntity);
    parent.addChild("arm", child);
  }
}

@serializable
class PauseTrackingScene extends Scene {
  readonly name = "pauseTracking";
  pauseCalls = 0;

  onPause() {
    this.pauseCalls++;
  }
}

// ---- Helpers ----

function createTestContext() {
  _resetEntityIdCounter();
  const ctx = new EngineContext();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  const logger = new Logger({ level: LogLevel.Debug });
  const boundary = new ErrorBoundary(logger);
  const sceneManager = new SceneManager();

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);
  ctx.register(SceneManagerKey, sceneManager);

  sceneManager._setContext(ctx);

  const storage = new MemoryStorage();
  const service = new SnapshotService(storage, ctx);
  ctx.register(SnapshotServiceKey, service);

  return { ctx, sceneManager, storage, service };
}

// ---- Tests ----

describe("SnapshotService", () => {
  describe("snapshot operations", () => {
    it("hasSnapshot returns false for empty slot", async () => {
      const { service } = createTestContext();
      expect(service.hasSnapshot("slot1")).toBe(false);
    });

    it("saveSnapshot + hasSnapshot returns true", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new MockScene());

      service.saveSnapshot("slot1");
      expect(service.hasSnapshot("slot1")).toBe(true);
    });

    it("deleteSnapshot removes a snapshot", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new MockScene());

      service.saveSnapshot("slot1");
      service.deleteSnapshot("slot1");
      expect(service.hasSnapshot("slot1")).toBe(false);
    });

    it("loadSnapshot throws on missing slot", async () => {
      const { service } = createTestContext();
      await expect(service.loadSnapshot("missing")).rejects.toThrow(
        /No save found/,
      );
    });

    it("loadSnapshot throws on unregistered scene type", async () => {
      const { service, storage } = createTestContext();
      storage.save(
        "yage:snapshot:slot1",
        JSON.stringify({
          version: 4,
          timestamp: Date.now(),
          scenes: [{ type: "UnknownScene", paused: false, entities: [] }],
        }),
      );

      await expect(service.loadSnapshot("slot1")).rejects.toThrow(
        /Cannot load scene type/,
      );
    });

    it("loadSnapshot throws on version mismatch", async () => {
      const { service, storage } = createTestContext();
      storage.save(
        "yage:snapshot:slot1",
        JSON.stringify({
          version: 999,
          timestamp: Date.now(),
          scenes: [],
        }),
      );

      await expect(service.loadSnapshot("slot1")).rejects.toThrow(
        /version mismatch/,
      );
    });

    it("importSnapshot throws on version mismatch before writing to storage", async () => {
      const { service, storage } = createTestContext();
      const badSnapshot = {
        version: 999,
        timestamp: Date.now(),
        scenes: [],
      };

      await expect(
        service.importSnapshot("slot1", badSnapshot),
      ).rejects.toThrow(/version mismatch/);

      // Verify nothing was written to storage
      expect(storage.load("yage:snapshot:slot1")).toBeNull();
    });

    it("concurrent loadSnapshot throws", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new MockScene());
      service.saveSnapshot("slot1");

      // Start first load (don't await)
      const first = service.loadSnapshot("slot1");

      // Second load should throw while first is in progress
      await expect(service.loadSnapshot("slot1")).rejects.toThrow(
        /already in progress/,
      );

      await first;
    });
  });

  describe("auto-serialization", () => {
    it("saveSnapshot captures entity components automatically", async () => {
      const { service, sceneManager, storage } = createTestContext();
      await sceneManager.push(new MockScene());

      const scene = sceneManager.active as MockScene;
      const entities = [...scene.getEntities()];
      const mockEntity = entities.find(
        (e) => e instanceof MockEntity,
      ) as MockEntity;
      mockEntity.get(Transform).setPosition(99, 88);
      mockEntity.get(HealthComponent).hp = 42;

      service.saveSnapshot("test");

      const raw = storage.load("yage:snapshot:test");
      expect(raw).not.toBeNull();
      const snapshot = JSON.parse(raw!);
      expect(snapshot.scenes).toHaveLength(1);
      expect(snapshot.scenes[0].entities).toHaveLength(2);
    });
  });

  describe("full round-trip", () => {
    it("save → load → entities restored with correct state", async () => {
      const { service, sceneManager } = createTestContext();

      await sceneManager.push(new MockScene());
      const originalScene = sceneManager.active as MockScene;
      expect(originalScene.enterCalled).toBe(true);

      const entities = [...originalScene.getEntities()];
      const mockEntity = entities.find(
        (e) => e instanceof MockEntity,
      ) as MockEntity;
      mockEntity.get(Transform).setPosition(99, 88);
      mockEntity.get(HealthComponent).hp = 42;

      service.saveSnapshot("test");

      await service.loadSnapshot("test");

      const restoredScene = sceneManager.active as MockScene;
      expect(restoredScene).not.toBe(originalScene);
      expect(restoredScene.enterCalled).toBe(false); // onEnter patched away
      expect(restoredScene.restored).toBe(true);
      expect(restoredScene.restoredData).toEqual({ counter: 42 });

      const restoredEntities = [...restoredScene.getEntities()];
      const restoredMock = restoredEntities.find(
        (e) => e instanceof MockEntity,
      ) as MockEntity;
      expect(restoredMock).toBeDefined();
      expect(restoredMock.restored).toBe(true);
      expect(restoredMock.userData).toEqual({ tag: "mock-user-data" });

      const t = restoredMock.get(Transform);
      expect(t.position.x).toBe(99);
      expect(t.position.y).toBe(88);

      const h = restoredMock.get(HealthComponent);
      expect(h.hp).toBe(42);
    });

    it("round-trips a non-default entity.timeScale", async () => {
      const { service, sceneManager } = createTestContext();

      await sceneManager.push(new MockScene());
      const originalScene = sceneManager.active as MockScene;

      const mockEntity = [...originalScene.getEntities()].find(
        (e) => e instanceof MockEntity,
      ) as MockEntity;
      mockEntity.timeScale = 0.25;

      service.saveSnapshot("test");
      await service.loadSnapshot("test");

      const restoredScene = sceneManager.active as MockScene;
      const restoredMock = [...restoredScene.getEntities()].find(
        (e) => e instanceof MockEntity,
      ) as MockEntity;
      expect(restoredMock.timeScale).toBe(0.25);

      // The untouched SimpleEntity keeps the default.
      const simple = [...restoredScene.getEntities()].find(
        (e) => e instanceof SimpleEntity,
      ) as SimpleEntity;
      expect(simple.timeScale).toBe(1);
    });

    it("fires onPause on a scene restored in a paused state", async () => {
      const { service, sceneManager } = createTestContext();

      const original = new PauseTrackingScene();
      await sceneManager.push(original);
      original.paused = true;
      expect(original.pauseCalls).toBe(1);

      service.saveSnapshot("test");
      await service.loadSnapshot("test");

      const restored = sceneManager.active as PauseTrackingScene;
      expect(restored).not.toBe(original);
      expect(restored.paused).toBe(true);
      expect(restored.pauseCalls).toBe(1);
    });

    it("omits a default entity.timeScale from the snapshot", async () => {
      const { service, sceneManager, storage } = createTestContext();

      await sceneManager.push(new MockScene());
      service.saveSnapshot("test");

      const raw = JSON.parse(storage.load("yage:snapshot:test")!) as {
        scenes: { entities: { timeScale?: number }[] }[];
      };
      for (const sceneEntry of raw.scenes) {
        for (const entityEntry of sceneEntry.entities) {
          expect(entityEntry.timeScale).toBeUndefined();
        }
      }
    });

    it("unknown entity types produce warnings and are skipped", async () => {
      const { service, storage } = createTestContext();

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      storage.save(
        "yage:snapshot:slot1",
        JSON.stringify({
          version: 4,
          timestamp: Date.now(),
          scenes: [
            {
              type: "MockScene",
              paused: false,
              entities: [
                {
                  id: 999,
                  type: "UnknownEntity",
                  components: [],
                  userData: null,
                },
              ],
            },
          ],
        }),
      );

      await service.loadSnapshot("slot1");

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("UnknownEntity"),
      );
      warn.mockRestore();
    });
  });

  describe("parent/child relationships", () => {
    it("serializes and restores parent/child hierarchy", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new HierarchyScene());

      service.saveSnapshot("test");
      await service.loadSnapshot("test");

      const scene = sceneManager.active!;
      const entities = [...scene.getEntities()];
      const parent = entities.find((e) => e instanceof ParentEntity)!;
      const child = entities.find((e) => e instanceof ChildEntity)!;

      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      expect(child.parent).toBe(parent);
      expect(parent.children.get("arm")).toBe(child);
    });

    it("snapshot captures parentId and childName", async () => {
      const { service, sceneManager, storage } = createTestContext();
      await sceneManager.push(new HierarchyScene());

      service.saveSnapshot("test");

      const raw = storage.load("yage:snapshot:test");
      const snapshot = JSON.parse(raw!);
      const entities = snapshot.scenes[0].entities as Array<{
        id: number;
        parentId?: number;
        childName?: string;
      }>;

      const childEntry = entities.find((e) => e.parentId != null);
      expect(childEntry).toBeDefined();
      expect(childEntry!.childName).toBe("arm");

      const parentEntry = entities.find((e) => e.id === childEntry!.parentId);
      expect(parentEntry).toBeDefined();
    });

    it("restores Transform hierarchy (world position)", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new HierarchyScene());

      // Verify original world position
      const originalScene = sceneManager.active!;
      const originalChild = [...originalScene.getEntities()].find(
        (e) => e instanceof ChildEntity,
      )!;
      const originalWorld = originalChild.get(Transform).worldPosition;
      expect(originalWorld.x).toBe(60); // parent(50) + child(10)
      expect(originalWorld.y).toBe(50); // parent(50) + child(0)

      service.saveSnapshot("test");
      await service.loadSnapshot("test");

      const scene = sceneManager.active!;
      const child = [...scene.getEntities()].find(
        (e) => e instanceof ChildEntity,
      )!;
      const world = child.get(Transform).worldPosition;
      expect(world.x).toBe(60);
      expect(world.y).toBe(50);
    });
  });

  describe("entity activeness", () => {
    it("round-trips a dormant entity and omits the field when active", async () => {
      const { service, sceneManager, storage } = createTestContext();
      await sceneManager.push(new HierarchyScene());

      const parent = [...sceneManager.active!.getEntities()].find(
        (e) => e instanceof ParentEntity,
      )!;
      parent.setActive(false);

      service.saveSnapshot("test");
      const entries = (
        JSON.parse(storage.load("yage:snapshot:test")!) as GameSnapshot
      ).scenes[0]!.entities;
      // Only the parent's own bit is stored — the child is dormant by descent.
      expect(entries.filter((e) => e.activeSelf === false)).toHaveLength(1);

      await service.loadSnapshot("test");

      const restored = [...sceneManager.active!.getEntities()];
      const restoredParent = restored.find((e) => e instanceof ParentEntity)!;
      const restoredChild = restored.find((e) => e instanceof ChildEntity)!;
      expect(restoredParent.activeSelf).toBe(false);
      expect(restoredChild.activeSelf).toBe(true);
      expect(restoredChild.isActive).toBe(false);
    });

    it("restores an all-active hierarchy as active", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new HierarchyScene());

      service.saveSnapshot("test");
      await service.loadSnapshot("test");

      for (const entity of sceneManager.active!.getEntities()) {
        expect(entity.isActive).toBe(true);
      }
    });
  });

  describe("SnapshotResolver", () => {
    it("afterRestore receives resolver that maps saved IDs to entities", async () => {
      const { service, sceneManager } = createTestContext();

      // Build a scene with a RefHolder pointing at a MockEntity
      @serializable
      class ResolverScene extends Scene {
        readonly name = "resolver";
        onEnter() {
          const target = this.spawn(MockEntity);
          const holder = this.spawn(RefHolderEntity);
          holder.targetId = target.id;
        }
      }

      await sceneManager.push(new ResolverScene());

      service.saveSnapshot("test");
      await service.loadSnapshot("test");

      const scene = sceneManager.active!;
      const holder = [...scene.getEntities()].find(
        (e) => e instanceof RefHolderEntity,
      ) as RefHolderEntity;

      expect(holder).toBeDefined();
      expect(holder.resolvedTarget).not.toBeNull();
      expect(holder.resolvedTarget).toBeInstanceOf(MockEntity);
    });

    it("resolver returns null for unknown IDs", async () => {
      const { service, sceneManager } = createTestContext();

      @serializable
      class BadRefScene extends Scene {
        readonly name = "badref";
        onEnter() {
          const holder = this.spawn(RefHolderEntity);
          holder.targetId = 99999; // non-existent
        }
      }

      await sceneManager.push(new BadRefScene());

      service.saveSnapshot("test");
      await service.loadSnapshot("test");

      const scene = sceneManager.active!;
      const holder = [...scene.getEntities()].find(
        (e) => e instanceof RefHolderEntity,
      ) as RefHolderEntity;

      expect(holder.resolvedTarget).toBeNull();
    });
  });

  describe("user data", () => {
    it("saveData/loadData round-trips structured data", async () => {
      const { service } = createTestContext();
      const profile = { bestScore: 42, unlocks: ["dash", "double-jump"] };

      service.saveData("profile", profile);
      expect(service.loadData("profile")).toEqual(profile);
    });

    it("loadData returns null for missing slot", async () => {
      const { service } = createTestContext();
      expect(service.loadData("missing")).toBeNull();
    });

    it("hasData returns true for data slot", async () => {
      const { service } = createTestContext();
      service.saveData("profile", { x: 1 });
      expect(service.hasData("profile")).toBe(true);
    });

    it("hasData returns false for snapshot-only slot", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new MockScene());
      service.saveSnapshot("quick");
      expect(service.hasData("quick")).toBe(false);
    });

    it("deleteData removes data slot", async () => {
      const { service } = createTestContext();
      service.saveData("profile", { x: 1 });
      service.deleteData("profile");
      expect(service.hasData("profile")).toBe(false);
    });

    it("hasSnapshot and hasData are independent", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new MockScene());

      service.saveSnapshot("slot");
      service.saveData("slot", { x: 1 });

      expect(service.hasSnapshot("slot")).toBe(true);
      expect(service.hasData("slot")).toBe(true);

      service.deleteSnapshot("slot");
      expect(service.hasSnapshot("slot")).toBe(false);
      expect(service.hasData("slot")).toBe(true);
    });
  });

  describe("export/import", () => {
    it("exportSnapshot returns saved snapshot data", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new MockScene());

      service.saveSnapshot("slot1");
      const exported = service.exportSnapshot("slot1");

      expect(exported).not.toBeNull();
      expect(exported!.version).toBe(4);
      expect(exported!.scenes).toHaveLength(1);
    });

    it("exportSnapshot returns null for missing slot", async () => {
      const { service } = createTestContext();
      expect(service.exportSnapshot("missing")).toBeNull();
    });

    it("importSnapshot stores and hydrates", async () => {
      const { service, sceneManager } = createTestContext();

      // Build a snapshot by saving first
      await sceneManager.push(new MockScene());
      service.saveSnapshot("source");
      const snapshot = service.exportSnapshot("source")!;

      // Import into a different slot
      await service.importSnapshot("target", snapshot);

      // Verify it was stored
      expect(service.hasSnapshot("target")).toBe(true);

      // Verify the scene was hydrated
      const restoredScene = sceneManager.active as MockScene;
      expect(restoredScene.restored).toBe(true);
    });

    it("exportData/importData round-trips", async () => {
      const { service } = createTestContext();
      const data = { score: 99 };

      service.saveData("profile", data);
      const exported = service.exportData("profile");
      expect(exported).toEqual(data);

      service.importData("copy", exported!);
      expect(service.loadData("copy")).toEqual(data);
    });
  });

  describe("snapshot contributors (extras)", () => {
    it("registered contributors round-trip through extras", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new MockScene());

      const captured: unknown[] = [];
      service.registerSnapshotExtra("demo", {
        serialize: () => ({ payload: "hello", n: 42 }),
        restore: (data) => {
          captured.push(data);
        },
      });

      service.saveSnapshot("slot1");
      const exported = service.exportSnapshot("slot1");
      expect(exported?.extras).toEqual({ demo: { payload: "hello", n: 42 } });

      await service.loadSnapshot("slot1");
      expect(captured).toEqual([{ payload: "hello", n: 42 }]);
    });

    it("contributors that return undefined are omitted from extras", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new MockScene());
      service.registerSnapshotExtra("nothing", {
        serialize: () => undefined,
        restore: () => {},
      });
      service.saveSnapshot("slot1");
      const exported = service.exportSnapshot("slot1");
      expect(exported?.extras).toBeUndefined();
    });

    it("warns when a snapshot has extras for an unregistered contributor", async () => {
      const { service, sceneManager, storage } = createTestContext();
      await sceneManager.push(new MockScene());
      storage.save(
        "yage:snapshot:slot1",
        JSON.stringify({
          version: 4,
          timestamp: Date.now(),
          scenes: [{ type: "MockScene", paused: false, entities: [] }],
          extras: { ghost: { unused: true } },
        }),
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await service.loadSnapshot("slot1");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`"ghost"`));
      warn.mockRestore();
    });

    it("unregisterSnapshotExtra stops a contributor from running", async () => {
      const { service, sceneManager } = createTestContext();
      await sceneManager.push(new MockScene());
      const serialize = vi.fn(() => ({ a: 1 }));
      service.registerSnapshotExtra("dropme", {
        serialize,
        restore: () => {},
      });
      service.unregisterSnapshotExtra("dropme");
      service.saveSnapshot("slot1");
      expect(serialize).not.toHaveBeenCalled();
    });
  });

  describe("component restore ordering", () => {
    // onAdd() call log shared by the ordering test components below.
    const addLog: string[] = [];

    @serializable
    class OrderEarly extends Component {
      static restorePriority = 20;
      onAdd() {
        addLog.push("OrderEarly");
      }
      serialize() {
        return {};
      }
      static fromSnapshot(): OrderEarly {
        return new OrderEarly();
      }
    }

    @serializable
    class OrderLate extends Component {
      static restorePriority = 200;
      onAdd() {
        addLog.push("OrderLate");
      }
      serialize() {
        return {};
      }
      static fromSnapshot(): OrderLate {
        return new OrderLate();
      }
    }

    // No restorePriority — falls in the default (100) bucket.
    @serializable
    class OrderDefaultA extends Component {
      onAdd() {
        addLog.push("OrderDefaultA");
      }
      serialize() {
        return {};
      }
      static fromSnapshot(): OrderDefaultA {
        return new OrderDefaultA();
      }
    }

    @serializable
    class OrderDefaultB extends Component {
      onAdd() {
        addLog.push("OrderDefaultB");
      }
      serialize() {
        return {};
      }
      static fromSnapshot(): OrderDefaultB {
        return new OrderDefaultB();
      }
    }

    @serializable
    class OrderEntity extends Entity {
      setup() {
        // Deliberately added in descending priority so the serialized
        // order disagrees with the declared restore order.
        this.add(new OrderLate());
        this.add(new OrderDefaultA());
        this.add(new OrderEarly());
      }
    }

    @serializable
    class TieEntity extends Entity {
      setup() {
        this.add(new OrderDefaultB());
        this.add(new OrderDefaultA());
      }
    }

    @serializable
    class DepConsumer extends Component {
      sawProvider = false;
      onAdd() {
        this.sawProvider = this.entity.get(OrderEarly) instanceof OrderEarly;
      }
      serialize() {
        return {};
      }
      static fromSnapshot(): DepConsumer {
        return new DepConsumer();
      }
    }

    @serializable
    class DepEntity extends Entity {
      setup() {
        this.add(new OrderEarly());
        this.add(new DepConsumer());
      }
    }

    @serializable
    class OrderScene extends Scene {
      readonly name = "order";
    }

    async function roundTrip(EntityClass: new () => Entity) {
      const { service, sceneManager } = createTestContext();
      const scene = new OrderScene();
      await sceneManager.push(scene);
      scene.spawn(EntityClass);
      service.saveSnapshot("slot1");
      addLog.length = 0;
      await service.loadSnapshot("slot1");
      return { sceneManager };
    }

    it("restores components in ascending declared priority regardless of serialized order", async () => {
      await roundTrip(OrderEntity);
      expect(addLog).toEqual(["OrderEarly", "OrderDefaultA", "OrderLate"]);
    });

    it("restores an undeclared component between lower and higher declared priorities", async () => {
      await roundTrip(OrderEntity);
      expect(addLog.indexOf("OrderEarly")).toBeLessThan(
        addLog.indexOf("OrderDefaultA"),
      );
      expect(addLog.indexOf("OrderDefaultA")).toBeLessThan(
        addLog.indexOf("OrderLate"),
      );
    });

    it("restores equal priorities in save-time add order", async () => {
      await roundTrip(TieEntity);
      expect(addLog).toEqual(["OrderDefaultB", "OrderDefaultA"]);
    });

    it("lets onAdd() read a lower-priority sibling", async () => {
      const { service, sceneManager } = createTestContext();
      // Serialized with the consumer FIRST — only the priority sort makes
      // the provider available when the consumer's onAdd() runs.
      const snapshot = {
        version: 4,
        timestamp: Date.now(),
        scenes: [
          {
            type: "OrderScene",
            paused: false,
            entities: [
              {
                id: 1,
                type: "DepEntity",
                components: [
                  { type: "DepConsumer", data: {} },
                  { type: "OrderEarly", data: {} },
                ],
                userData: null,
              },
            ],
          },
        ],
      };
      await service.importSnapshot("slot1", snapshot as GameSnapshot);
      const restored = [...sceneManager.active!.getEntities()].find(
        (e) => e instanceof DepEntity,
      ) as DepEntity;
      expect(restored.get(DepConsumer).sawProvider).toBe(true);
    });

    it("skips a type missing from the registry without disturbing the order of the rest", async () => {
      const { service } = createTestContext();
      const snapshot = {
        version: 4,
        timestamp: Date.now(),
        scenes: [
          {
            type: "OrderScene",
            paused: false,
            entities: [
              {
                id: 1,
                type: "OrderEntity",
                components: [
                  { type: "OrderLate", data: {} },
                  { type: "NotARegisteredComponent", data: {} },
                  { type: "OrderEarly", data: {} },
                ],
                userData: null,
              },
            ],
          },
        ],
      };
      addLog.length = 0;
      await service.importSnapshot("slot1", snapshot as GameSnapshot);
      expect(addLog).toEqual(["OrderEarly", "OrderLate"]);
    });
  });
});
