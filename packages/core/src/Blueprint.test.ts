import { describe, it, expect, beforeEach } from "vitest";
import { defineBlueprint } from "./Blueprint.js";
import type { Blueprint } from "./Blueprint.js";
import { Component } from "./Component.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { EventBusKey } from "./EngineContext.js";
import { createMockScene } from "./test-utils.js";
import { defineTrait, trait } from "./Trait.js";

beforeEach(() => {
  _resetEntityIdCounter();
});

class HealthComponent extends Component {
  constructor(public hp: number) {
    super();
  }
}

class NameTag extends Component {
  constructor(public displayName: string) {
    super();
  }
}

describe("defineBlueprint", () => {
  it("creates a blueprint with name and build function", () => {
    const bp = defineBlueprint("enemy", (entity) => {
      entity.add(new HealthComponent(100));
    });

    expect(bp.name).toBe("enemy");
    expect(bp.build).toBeTypeOf("function");
  });

  it("parameterless blueprint (void P)", () => {
    const bp = defineBlueprint("coin", (entity) => {
      entity.add(new HealthComponent(1));
    });

    expect(bp.name).toBe("coin");
  });

  it("parameterized blueprint", () => {
    const bp = defineBlueprint<{ hp: number; name: string }>(
      "npc",
      (entity, params) => {
        entity.add(new HealthComponent(params.hp));
        entity.add(new NameTag(params.name));
      },
    );

    expect(bp.name).toBe("npc");
  });
});

describe("scene.spawn(blueprint)", () => {
  it("spawns entity from parameterless blueprint", () => {
    const { scene } = createMockScene();
    const Coin = defineBlueprint("coin", (entity) => {
      entity.add(new HealthComponent(1));
    });

    const entity = scene.spawn(Coin);

    expect(entity.name).toBe("coin");
    expect(entity.get(HealthComponent).hp).toBe(1);
  });

  it("spawns entity from parameterized blueprint", () => {
    const { scene } = createMockScene();
    const Enemy = defineBlueprint<{ hp: number }>("enemy", (entity, params) => {
      entity.add(new HealthComponent(params.hp));
    });

    const entity = scene.spawn(Enemy, { hp: 50 });

    expect(entity.name).toBe("enemy");
    expect(entity.get(HealthComponent).hp).toBe(50);
  });

  it("entity is wired to scene before build() is called", () => {
    const { scene } = createMockScene();
    let sceneInBuild: unknown = "not set";

    const bp = defineBlueprint("test", (entity) => {
      sceneInBuild = entity.scene;
    });

    scene.spawn(bp);

    expect(sceneInBuild).toBe(scene);
  });

  it("entity:created fires before build()", () => {
    const { scene, context } = createMockScene();
    const bus = context.resolve(EventBusKey);

    const events: string[] = [];
    bus.on("entity:created", () => events.push("entity:created"));

    const bp = defineBlueprint("test", () => {
      events.push("build");
    });

    scene.spawn(bp);

    expect(events).toEqual(["entity:created", "build"]);
  });

  it("class-based blueprint works", () => {
    class EnemyBlueprint implements Blueprint<{ hp: number }> {
      readonly name = "enemy";
      build(entity: Entity, params: { hp: number }) {
        entity.add(new HealthComponent(params.hp));
      }
    }

    const { scene } = createMockScene();
    const entity = scene.spawn(new EnemyBlueprint(), { hp: 200 });

    expect(entity.name).toBe("enemy");
    expect(entity.get(HealthComponent).hp).toBe(200);
  });

  it("existing spawn(name) still works", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("player");

    expect(entity.name).toBe("player");
    expect(entity.scene).toBe(scene);
  });

  it("existing spawn() with no args still works", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn();

    expect(entity.name).toBe("Entity");
    expect(entity.scene).toBe(scene);
  });
});

// ---- Class-based spawn tests ----

describe("scene.spawn(Class)", () => {
  it("spawns entity subclass and wires scene", () => {
    const { scene } = createMockScene();

    class Wall extends Entity {}

    const wall = scene.spawn(Wall);

    expect(wall).toBeInstanceOf(Wall);
    expect(wall).toBeInstanceOf(Entity);
    expect(wall.scene).toBe(scene);
  });

  it("calls setup() with params after scene attachment", () => {
    const { scene } = createMockScene();
    let sceneInSetup: unknown = "not set";

    class Box extends Entity {
      w = 0;
      h = 0;
      setup(params: { w: number; h: number }) {
        sceneInSetup = this.scene;
        this.w = params.w;
        this.h = params.h;
      }
    }

    const box = scene.spawn(Box, { w: 10, h: 20 });

    expect(sceneInSetup).toBe(scene);
    expect(box.w).toBe(10);
    expect(box.h).toBe(20);
  });

  it("setup() can add components that access services", () => {
    const { scene } = createMockScene();

    class Marker extends Entity {
      setup() {
        this.add(new HealthComponent(42));
      }
    }

    const marker = scene.spawn(Marker);
    expect(marker.get(HealthComponent).hp).toBe(42);
  });

  it("works without setup() and without params", () => {
    const { scene } = createMockScene();

    class Empty extends Entity {}

    const e = scene.spawn(Empty);
    expect(e).toBeInstanceOf(Empty);
    expect(e.scene).toBe(scene);
  });

  it("entity:created fires before setup()", () => {
    const { scene, context } = createMockScene();
    const bus = context.resolve(EventBusKey);

    const events: string[] = [];
    bus.on("entity:created", () => events.push("entity:created"));

    class Tracked extends Entity {
      setup() {
        events.push("setup");
      }
    }

    scene.spawn(Tracked);

    expect(events).toEqual(["entity:created", "setup"]);
  });

  it("works with traited entity subclass", () => {
    const { scene } = createMockScene();

    const Interactable = defineTrait<{ interact(): void }>("Interactable");

    @trait(Interactable)
    class Light extends Entity {
      toggled = false;
      interact() {
        this.toggled = true;
      }
    }

    const light = scene.spawn(Light);

    expect(light).toBeInstanceOf(Entity);
    expect(light.hasTrait(Interactable)).toBe(true);
    light.interact();
    expect(light.toggled).toBe(true);
  });
});
