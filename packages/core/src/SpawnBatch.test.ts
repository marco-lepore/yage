import { describe, expect, it } from "vitest";
import { defineBlueprint } from "./Blueprint.js";
import { Component } from "./Component.js";
import {
  ErrorBoundaryKey,
  EventBusKey,
  QueryCacheKey,
} from "./EngineContext.js";
import { Entity } from "./Entity.js";
import type { EntityHandle } from "./EntityHandle.js";
import { defineEvent } from "./EventToken.js";
import { Scene } from "./Scene.js";
import { createMockScene } from "./test-utils.js";

interface MarkerOptions {
  throwOnEnable?: boolean;
  throwOnDisable?: boolean;
  throwOnCleanup?: boolean;
  afterThrowCleanup?: () => void;
  throwOnDestroy?: boolean;
}

class MarkerComponent extends Component {
  constructor(
    private readonly label: string,
    private readonly events: string[],
    private readonly options: MarkerOptions = {},
  ) {
    super();
  }

  onAdd(): void {
    this.events.push(`${this.label}:add`);
    if (this.options.throwOnCleanup) {
      this.addCleanup(() => {
        this.events.push(`${this.label}:cleanup`);
        this.addCleanup(() =>
          this.events.push(`${this.label}:dynamic-cleanup`),
        );
        throw new Error(`${this.label}:cleanup failed`);
      });
      this.addCleanup(() => this.options.afterThrowCleanup?.());
    }
  }

  onEnable(): void {
    this.events.push(`${this.label}:enable`);
    if (this.options.throwOnEnable)
      throw new Error(`${this.label}:activation failed`);
  }

  onDisable(): void {
    this.events.push(`${this.label}:disable`);
    if (this.options.throwOnDisable)
      throw new Error(`${this.label}:disable failed`);
  }

  onDestroy(): void {
    this.events.push(`${this.label}:destroy`);
    if (this.options.throwOnDestroy)
      throw new Error(`${this.label}:destroy failed`);
  }
}

describe("Scene.spawnBatch", () => {
  it("publishes the complete batch, then activates it", () => {
    const { scene, context } = createMockScene();
    const bus = context.resolve(EventBusKey);
    const query = context.resolve(QueryCacheKey).register([MarkerComponent]);
    const engineEvents: string[] = [];
    const componentEvents: string[] = [];
    const setupEvents: string[] = [];
    const seenAtFirstPublication: string[] = [];
    let queriedAtPublication = -1;

    bus.on("entity:created", ({ entity }) => {
      engineEvents.push(`created:${entity.name}`);
      if (seenAtFirstPublication.length === 0) {
        for (const member of scene.getEntities()) {
          seenAtFirstPublication.push(member.name);
        }
        queriedAtPublication = query.size;
      }
    });
    bus.on("component:added", ({ entity }) =>
      engineEvents.push(`component:${entity.name}`),
    );

    class Parent extends Entity {
      other?: EntityHandle<Child>;
      setup(params: { other: EntityHandle<Child> }): void {
        this.other = params.other;
        setupEvents.push(`parent:${this.parent?.name ?? "root"}`);
        this.add(new MarkerComponent("parent", componentEvents));
      }
    }
    class Child extends Entity {
      other?: EntityHandle<Parent>;
      setup(params: { other: EntityHandle<Parent> }): void {
        this.other = params.other;
        setupEvents.push(`child:${this.parent?.name ?? "root"}`);
        this.add(new MarkerComponent("child", componentEvents));
      }
    }

    const result = scene.spawnBatch((batch) => {
      const parent = batch.reserve(Parent, { key: "level/parent" });
      const child = batch.reserve(Child, { key: "level/child" });
      batch.addChild(parent, "placement-child", child);
      batch.setup(parent, { other: child.handle() });
      batch.setup(child, { other: parent.handle() });

      setupEvents.push(`ready:${child.parent?.name}`);
      expect(child.handle().current).toBe(child);
      expect(scene.getEntities().size).toBe(0);
      expect(scene.findByKey("level/parent")).toBeUndefined();
      expect(query.size).toBe(0);
      return { parent, child };
    });

    expect(setupEvents).toEqual([
      "parent:root",
      "child:Parent",
      "ready:Parent",
    ]);
    expect(result.parent.other?.current).toBe(result.child);
    expect(result.child.other?.current).toBe(result.parent);
    // The first subscriber already sees the whole set, keys included, and no
    // entity has joined a query yet.
    expect(seenAtFirstPublication).toEqual(["Parent", "Child"]);
    expect(queriedAtPublication).toBe(0);
    expect(engineEvents).toEqual([
      "created:Parent",
      "component:Parent",
      "created:Child",
      "component:Child",
    ]);
    expect(componentEvents).toEqual([
      "parent:add",
      "child:add",
      "parent:enable",
      "child:enable",
    ]);
    expect(query.toArray()).toEqual([result.parent, result.child]);
    expect(scene.findByKey("level/child")).toBe(result.child);
  });

  it("commits an entity reserved inactive dormant, ready to be woken later", () => {
    const { scene, context } = createMockScene();
    const query = context.resolve(QueryCacheKey).register([MarkerComponent]);
    const events: string[] = [];
    class Dormant extends Entity {
      setup(): void {
        this.add(new MarkerComponent("dormant", events));
      }
    }

    const entity = scene.spawnBatch((batch) => {
      const dormant = batch.reserve(Dormant, {
        key: "level/dormant",
        active: false,
      });
      batch.setup(dormant);
      return dormant;
    });

    expect([...scene.getEntities()]).toEqual([entity]);
    expect(entity.isActive).toBe(false);
    expect(scene.findByKey("level/dormant")).toBe(entity);
    expect(query.size).toBe(0);
    expect(events).toEqual(["dormant:add"]);

    entity.setActive(true);
    expect(entity.isActive).toBe(true);
    expect(query.toArray()).toEqual([entity]);
    expect(events).toEqual(["dormant:add", "dormant:enable"]);
  });

  it("keeps a dormant subtree dormant when its root wakes", () => {
    const { scene } = createMockScene();
    const root = scene.spawnBatch((batch) => {
      const parent = batch.reserve(Entity, { active: false });
      const awake = batch.reserve(Entity);
      const asleep = batch.reserve(Entity, { active: false });
      batch.addChild(parent, "awake", awake);
      batch.addChild(parent, "asleep", asleep);
      return parent;
    });

    expect(root.isActive).toBe(false);
    expect(root.getChild("awake").isActive).toBe(false);

    root.setActive(true);
    expect(root.getChild("awake").isActive).toBe(true);
    expect(root.getChild("asleep").isActive).toBe(false);
  });

  it("takes setup children in every spawnChild form", () => {
    const { scene } = createMockScene();
    const built: string[] = [];
    const blueprint = defineBlueprint<{ label: string }>(
      "BlueprintChild",
      (entity, params) => {
        built.push(`${entity.parent?.name ?? "unlinked"}:${params.label}`);
      },
    );
    class ClassChild extends Entity {
      setup(params: { label: string }): void {
        built.push(`${this.parent?.name ?? "unlinked"}:${params.label}`);
      }
    }
    class Parent extends Entity {
      setup(): void {
        this.spawnChild("plain");
        this.spawnChild(
          "class",
          ClassChild,
          { label: "class" },
          { key: "level/class" },
        );
        this.spawnChild("blueprint", blueprint, { label: "blueprint" });
      }
    }

    const parent = scene.spawnBatch((batch) => {
      const reservation = batch.reserve(Parent, { key: "level/parent" });
      batch.setup(reservation);
      return reservation;
    });

    expect([...parent.children.keys()]).toEqual([
      "plain",
      "class",
      "blueprint",
    ]);
    expect(scene.findByKey("level/class")).toBe(parent.children.get("class"));
    // `spawnChild` runs setup before it links the parent, inside a batch
    // exactly as outside one. `batch.addChild` is the call that links an
    // authored parent first.
    expect(built).toEqual(["unlinked:class", "unlinked:blueprint"]);
    built.length = 0;
    scene.spawn("outside").spawnChild("class", ClassChild, { label: "class" });
    expect(built).toEqual(["unlinked:class"]);

    // The children joined the batch, so they were published with it and are
    // active now that it committed.
    expect(parent.getChild("class").isActive).toBe(true);
    expect(scene.getEntities().size).toBe(6);
  });

  it("rolls back setup children, keeps developer events, and publishes none of its own", () => {
    const { scene, context } = createMockScene();
    const bus = context.resolve(EventBusKey);
    const engineEvents: string[] = [];
    const developerEvents: string[] = [];
    const componentEvents: string[] = [];
    const SetupSignal = defineEvent("spawn-batch:setup");
    let firstHandle: EntityHandle<Entity> | undefined;
    let childHandle: EntityHandle<Entity> | undefined;
    scene.on(SetupSignal, () => developerEvents.push("setup"));
    bus.on("entity:created", ({ entity }) =>
      engineEvents.push(`created:${entity.name}`),
    );
    bus.on("entity:destroyed", ({ entity }) =>
      engineEvents.push(`destroyed:${entity.name}`),
    );

    class SetupChild extends Entity {
      setup(): void {
        this.add(new MarkerComponent("child", componentEvents));
        childHandle = this.handle();
      }
    }
    class First extends Entity {
      setup(): void {
        this.add(new MarkerComponent("first", componentEvents));
        this.spawnChild("helper", SetupChild);
        this.emit(SetupSignal);
      }
    }
    class Failing extends Entity {
      setup(): void {
        this.add(new MarkerComponent("failing", componentEvents));
        throw new Error("second setup failed");
      }
    }

    expect(() =>
      scene.spawnBatch((batch) => {
        const first = batch.reserve(First, { key: "level/first" });
        const failing = batch.reserve(Failing, { key: "level/failing" });
        firstHandle = first.handle();
        batch.setup(first);
        batch.setup(failing);
      }),
    ).toThrow("second setup failed");

    expect(engineEvents).toEqual([]);
    expect(developerEvents).toEqual(["setup"]);
    expect(firstHandle?.current).toBeUndefined();
    expect(childHandle?.current).toBeUndefined();
    expect(scene.getEntities().size).toBe(0);
    expect(scene.findByKey("level/first")).toBeUndefined();
    // The keys are free again, so the same set can be reserved immediately.
    expect(() =>
      scene.spawnBatch((batch) =>
        batch.reserve(Entity, { key: "level/first" }),
      ),
    ).not.toThrow();
  });

  it("rejects a top-level spawn before it constructs the entity", () => {
    const { scene } = createMockScene();
    let constructions = 0;
    const boundSpawn = scene.spawn.bind(scene);
    class Counted extends Entity {
      constructor() {
        super();
        constructions++;
      }
    }
    class ViaBound extends Entity {
      setup(): void {
        boundSpawn(Counted);
      }
    }
    class ViaPrototype extends Entity {
      setup(): void {
        Scene.prototype.spawn.call(this.scene, Counted);
      }
    }

    for (const Culprit of [ViaBound, ViaPrototype]) {
      expect(() =>
        scene.spawnBatch((batch) => {
          const culprit = batch.reserve(Culprit);
          batch.setup(culprit);
        }),
      ).toThrow("spawn() cannot create a top-level entity");
    }
    expect(constructions).toBe(0);
    expect(scene.getEntities().size).toBe(0);
  });

  it("rejects a top-level spawn from a setup-created child", () => {
    const { scene } = createMockScene();
    let constructions = 0;
    class Escaped extends Entity {
      constructor() {
        super();
        constructions++;
      }
    }
    class Child extends Entity {
      setup(): void {
        this.scene.spawn(Escaped);
      }
    }
    class Parent extends Entity {
      setup(): void {
        this.spawnChild("child", Child);
      }
    }

    expect(() =>
      scene.spawnBatch((batch) => {
        const parent = batch.reserve(Parent);
        batch.setup(parent);
      }),
    ).toThrow("spawn() cannot create a top-level entity");
    expect(constructions).toBe(0);
    expect(scene.getEntities().size).toBe(0);
  });

  it("rejects self-destruction and hierarchy across the batch boundary", () => {
    const { scene } = createMockScene();
    const unrelated = scene.spawn("unrelated", { key: "game/unrelated" });
    // Dormant, so parenting a reserved entity under it fails as an ownership
    // problem rather than by waking the entity mid-batch.
    unrelated.setActive(false);
    class Invalid extends Entity {
      setup(mode: "destroy" | "foreign-parent" | "foreign-child"): void {
        if (mode === "destroy") this.destroy();
        if (mode === "foreign-parent") unrelated.addChild("authored", this);
        if (mode === "foreign-child") this.addChild("unrelated", unrelated);
      }
    }

    for (const mode of [
      "destroy",
      "foreign-parent",
      "foreign-child",
    ] as const) {
      expect(() =>
        scene.spawnBatch((batch) => {
          const invalid = batch.reserve(Invalid, { key: `level/${mode}` });
          batch.setup(invalid, mode);
        }),
      ).toThrow(/was destroyed|does not own/);
      expect(scene.findByKey("game/unrelated")).toBe(unrelated);
      expect(unrelated.isDestroyed).toBe(false);
      expect(unrelated.parent).toBeNull();
      expect(unrelated.children.size).toBe(0);
      expect(scene.getEntities().size).toBe(1);
    }
  });

  it("rejects an outside entity joining the batch's hierarchy", () => {
    const { scene } = createMockScene();
    class Adopter extends Entity {
      setup(): void {
        this.addChild("outsider", new Entity("outsider"));
      }
    }

    expect(() =>
      scene.spawnBatch((batch) => {
        const adopter = batch.reserve(Adopter);
        batch.setup(adopter);
      }),
    ).toThrow("scene running a spawn batch");
    expect(scene.getEntities().size).toBe(0);
  });

  it("rejects activating a reserved entity before the batch commits", () => {
    const { scene } = createMockScene();
    class EagerlyActive extends Entity {
      setup(): void {
        this.setActive(true);
      }
    }

    expect(() =>
      scene.spawnBatch((batch) => {
        const eager = batch.reserve(EagerlyActive, { active: false });
        batch.setup(eager);
      }),
    ).toThrow("became active during a spawn batch");
    expect(scene.getEntities().size).toBe(0);
  });

  it("rejects a key another entity already holds", () => {
    const { scene } = createMockScene();
    scene.spawn("taken", { key: "level/taken" });

    expect(() =>
      scene.spawnBatch((batch) =>
        batch.reserve(Entity, { key: "level/taken" }),
      ),
    ).toThrow('already has an entity with key "level/taken"');
    expect(() =>
      scene.spawnBatch((batch) => {
        batch.reserve(Entity, { key: "level/twice" });
        batch.reserve(Entity, { key: "level/twice" });
      }),
    ).toThrow('already reserved an entity with key "level/twice"');
    expect(scene.getEntities().size).toBe(1);
  });

  it("keeps an activation failure primary while cleanup continues and is attributed", () => {
    const { scene, context } = createMockScene();
    const boundary = context.resolve(ErrorBoundaryKey);
    const query = context.resolve(QueryCacheKey).register([MarkerComponent]);
    const componentEvents: string[] = [];
    class First extends Entity {
      setup(): void {
        this.add(
          new MarkerComponent("first", componentEvents, {
            throwOnDisable: true,
            throwOnCleanup: true,
          }),
        );
      }
    }
    class Second extends Entity {
      setup(): void {
        this.add(
          new MarkerComponent("second", componentEvents, {
            throwOnEnable: true,
            throwOnDestroy: true,
          }),
        );
      }
    }

    expect(() =>
      scene.spawnBatch((batch) => {
        const first = batch.reserve(First, { key: "level/first" });
        const second = batch.reserve(Second, { key: "level/second" });
        batch.setup(first);
        batch.setup(second);
      }),
    ).toThrow("second:activation failed");

    expect(scene.getEntities().size).toBe(0);
    expect(scene.findByKey("level/first")).toBeUndefined();
    expect(scene.findByKey("level/second")).toBeUndefined();
    expect(query.size).toBe(0);
    expect(boundary.getCallbackErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Component MarkerComponent",
          error: "second:activation failed",
        }),
        expect.objectContaining({ error: "first:disable failed" }),
        expect.objectContaining({ error: "first:cleanup failed" }),
        expect.objectContaining({ error: "second:destroy failed" }),
      ]),
    );
  });

  it("keeps a setup error primary after every cleanup hook throws", () => {
    const { scene, context } = createMockScene();
    const boundary = context.resolve(ErrorBoundaryKey);
    const events: string[] = [];
    let laterCleanupRan = false;
    class Failing extends Entity {
      setup(): void {
        this.add(
          new MarkerComponent("cleanup", events, {
            throwOnCleanup: true,
            afterThrowCleanup: () => {
              laterCleanupRan = true;
            },
            throwOnDestroy: true,
          }),
        );
        throw new Error("setup remained primary");
      }
    }

    expect(() =>
      scene.spawnBatch((batch) => {
        const failing = batch.reserve(Failing, { key: "level/failing" });
        batch.setup(failing);
      }),
    ).toThrow("setup remained primary");

    expect(scene.getEntities().size).toBe(0);
    expect(scene.findByKey("level/failing")).toBeUndefined();
    expect(laterCleanupRan).toBe(true);
    expect(events).toContain("cleanup:dynamic-cleanup");
    expect(boundary.getCallbackErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Entity setup() hook",
          entity: "Failing",
          error: "setup remained primary",
        }),
        expect.objectContaining({ error: "cleanup:cleanup failed" }),
        expect.objectContaining({ error: "cleanup:destroy failed" }),
      ]),
    );
  });

  it.each(["entity:created", "component:added"] as const)(
    "tears the batch down completely when a %s subscriber throws",
    (eventName) => {
      const { scene, context } = createMockScene();
      const bus = context.resolve(EventBusKey);
      const query = context.resolve(QueryCacheKey).register([MarkerComponent]);
      const componentEvents: string[] = [];
      const failure = new Error(`${eventName} publication failed`);
      bus.on(eventName, () => {
        throw failure;
      });
      class Published extends Entity {
        setup(): void {
          this.add(
            new MarkerComponent("published", componentEvents, {
              throwOnDestroy: true,
            }),
          );
        }
      }

      expect(() =>
        scene.spawnBatch((batch) => {
          const first = batch.reserve(Published, { key: "level/first" });
          const second = batch.reserve(Published, { key: "level/second" });
          batch.setup(first);
          batch.setup(second);
        }),
      ).toThrow(failure);

      expect(scene.getEntities().size).toBe(0);
      expect(scene.findByKey("level/first")).toBeUndefined();
      expect(scene.findByKey("level/second")).toBeUndefined();
      expect(query.size).toBe(0);
    },
  );

  it("rejects a parent cycle instead of walking it", () => {
    const { scene } = createMockScene();

    expect(() =>
      scene.spawnBatch((batch) => {
        const a = batch.reserve(Entity, { key: "level/a" });
        const b = batch.reserve(Entity, { key: "level/b" });
        // `Entity.addChild` accepts the second link: it rejects self-parenting
        // and an entity that already has a parent, not a closed loop.
        batch.addChild(a, "b", b);
        batch.addChild(b, "a", a);
      }),
    ).toThrow("parent cycle");

    expect(scene.getEntities().size).toBe(0);
    expect(scene.findByKey("level/a")).toBeUndefined();
  });

  it("lets a publication subscriber spawn, like any other engine work", () => {
    const { scene, context } = createMockScene();
    const bus = context.resolve(EventBusKey);
    class Watched extends Entity {}

    // The transaction is over once the entities are in the scene, so a
    // subscriber reacting to the batch is doing ordinary work.
    bus.on("entity:created", ({ entity }) => {
      if (entity instanceof Watched) scene.spawn("reaction");
    });

    const watched = scene.spawnBatch((batch) =>
      batch.reserve(Watched, { key: "level/watched" }),
    );

    expect(scene.findByKey("level/watched")).toBe(watched);
    expect(scene.findEntity("reaction")).toBeDefined();
  });

  it("pairs entity:destroyed only with the entities it announced", () => {
    const { scene, context } = createMockScene();
    const bus = context.resolve(EventBusKey);
    const destroyed: string[] = [];
    class First extends Entity {}
    class Second extends Entity {}
    bus.on("entity:created", ({ entity }) => {
      if (entity.name === "First") throw new Error("announce failed");
    });
    bus.on("entity:destroyed", ({ entity }) => destroyed.push(entity.name));

    expect(() =>
      scene.spawnBatch((batch) => {
        batch.reserve(First, { key: "level/first" });
        batch.reserve(Second, { key: "level/second" });
      }),
    ).toThrow("announce failed");

    // The second entity never reached its own `entity:created`, so it gets no
    // `entity:destroyed` either — no listener sees an unpaired destruction.
    expect(destroyed).toEqual(["First"]);
    expect(scene.getEntities().size).toBe(0);
    expect(scene.findByKey("level/second")).toBeUndefined();
  });

  it("rejects entities it does not own, a second batch, and its own leftovers", () => {
    const { scene } = createMockScene();
    const outsider = scene.spawn("outsider");
    const leaked = scene.spawnBatch((batch) => {
      expect(() => batch.setup(outsider)).toThrow("is not part of this spawn");
      expect(() =>
        batch.addChild(outsider, "x", batch.reserve(Entity)),
      ).toThrow("is not part of this spawn");
      expect(() => scene.spawnBatch(() => undefined)).toThrow(
        "already running a spawn batch",
      );
      return batch;
    });

    expect(() => leaked.reserve(Entity)).toThrow("spawn batch is closed");
  });
});

describe("SpawnOptions.active", () => {
  it("spawns dormant without firing enable hooks", () => {
    const { scene, context } = createMockScene();
    const query = context.resolve(QueryCacheKey).register([MarkerComponent]);
    const events: string[] = [];
    class Sleeper extends Entity {
      setup(): void {
        this.add(new MarkerComponent("sleeper", events));
      }
    }

    const sleeper = scene.spawn(Sleeper, { active: false });
    expect(sleeper.isActive).toBe(false);
    expect(sleeper.activeSelf).toBe(false);
    expect(events).toEqual(["sleeper:add"]);
    expect(query.size).toBe(0);

    sleeper.setActive(true);
    expect(events).toEqual(["sleeper:add", "sleeper:enable"]);
    expect(query.toArray()).toEqual([sleeper]);
  });

  it("keeps a dormant child dormant when its active parent adopts it", () => {
    const { scene } = createMockScene();
    const parent = scene.spawn("parent");
    const child = parent.spawnChild("child", { active: false });

    expect(parent.isActive).toBe(true);
    expect(child.isActive).toBe(false);

    child.setActive(true);
    expect(child.isActive).toBe(true);
  });

  it("routes a two-argument options object to options, not setup params", () => {
    const { scene } = createMockScene();
    let received: unknown = "unset";
    class Configured extends Entity {
      setup(params?: { active?: boolean }): void {
        received = params;
      }
    }

    const entity = scene.spawn(Configured, { active: false });
    expect(received).toBeUndefined();
    expect(entity.isActive).toBe(false);
  });
});
