import { describe, expect, it } from "vitest";
import {
  AssetHandle,
  Component,
  Entity,
  ErrorBoundaryKey,
  Transform,
  createMockScene,
} from "@yagejs/core";
import type { EntityHandle, Scene } from "@yagejs/core";
import { buildLevelCatalog } from "../catalog/build.js";
import { defineLevelEntity, defineLevelProject } from "../catalog/declare.js";
import type { LevelCatalog, LevelEntityClass } from "../catalog/types.js";
import type { LevelDocument, LevelPlacement } from "../document/types.js";
import { defineLevelAsset, param } from "../params/kinds.js";
import { defineParams } from "../params/schema.js";
import type { ParamsOf } from "../params/types.js";
import { prepareLevel } from "../prepare/prepare.js";
import type { PreparedLevel } from "../prepare/types.js";
import { LevelLoadError } from "./errors.js";
import { instantiateLevel } from "./instantiate.js";

const textureAsset = defineLevelAsset<string>({
  kind: "texture",
  create: (path) => new AssetHandle<string>("texture", path),
});

const CrateParams = defineParams({
  texture: param.asset(textureAsset, "sprites/crate.png"),
});

/**
 * What each entity saw, so setup order and arguments are observable. Entities
 * are recorded by scene key: a class-spawned entity is named after its class,
 * here as everywhere in the engine, so a placement's authored `name` is not
 * what distinguishes one crate from another.
 */
const seen: {
  setup: string[];
  texture: Map<string, AssetHandle<string>>;
  parents: Map<string, string | null>;
  enabled: string[];
} = { setup: [], texture: new Map(), parents: new Map(), enabled: [] };

function resetSeen(): void {
  seen.setup = [];
  seen.texture = new Map();
  seen.parents = new Map();
  seen.enabled = [];
}

class EnableMarker extends Component {
  constructor(private readonly failing = false) {
    super();
  }

  onEnable(): void {
    const key = this.entity.requireKey();
    if (this.failing) throw new Error(`${key} refused to enable`);
    seen.enabled.push(key);
  }
}

class Crate extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.crate",
    version: 1,
    params: CrateParams,
  });

  setup(params: ParamsOf<typeof CrateParams>): void {
    this.add(new Transform());
    this.add(new EnableMarker());
    const key = this.requireKey();
    seen.setup.push(key);
    seen.texture.set(key, params.texture);
    seen.parents.set(key, this.parent?.requireKey() ?? null);
  }
}

/** Stands in for a renderer visual: the two members a level duck-types. */
class Painted extends Component {
  private _layerName: string;

  constructor(layer = "default") {
    super();
    this._layerName = layer;
  }

  get layerName(): string {
    return this._layerName;
  }

  setLayer(name: string): void {
    this._layerName = name;
  }
}

/** A second visual the type deliberately puts somewhere else. */
class Badge extends Painted {}

class Painter extends Entity {
  static readonly level = defineLevelEntity({ id: "game.painter", version: 1 });

  setup(): void {
    this.add(new Transform());
    this.add(new Painted());
    this.add(new Badge("ui"));
  }
}

class Marker extends Entity {
  static readonly level = defineLevelEntity({ id: "game.marker", version: 1 });

  setup(): void {
    this.add(new Transform());
    seen.setup.push(this.requireKey());
  }
}

class Untransformed extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.untransformed",
    version: 1,
  });
}

class Exploding extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.exploding",
    version: 1,
  });

  setup(): void {
    throw new Error("setup went wrong");
  }
}

class Unenablable extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.unenablable",
    version: 1,
  });

  setup(): void {
    this.add(new Transform());
    this.add(new EnableMarker(true));
  }
}

function catalogOf(...entities: LevelEntityClass[]): LevelCatalog {
  const result = buildLevelCatalog(defineLevelProject({ entities }));
  if (!result.ok) throw new Error(result.errors[0]?.message ?? "no catalog");
  return result.catalog;
}

function placement(overrides: Partial<LevelPlacement> = {}): LevelPlacement {
  return {
    id: "p1",
    type: "game.crate",
    typeVersion: 1,
    active: true,
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    params: { texture: "sprites/crate.png" },
    extensions: {},
    ...overrides,
  };
}

function documentOf(...entities: LevelPlacement[]): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    entities,
    extensions: {},
  };
}

function prepare(
  entities: LevelPlacement[],
  ...classes: LevelEntityClass[]
): PreparedLevel {
  resetSeen();
  const prepared = prepareLevel(
    documentOf(...entities),
    catalogOf(...(classes.length > 0 ? classes : [Crate])),
  );
  expect(prepared.diagnostics).toEqual([]);
  return prepared;
}

function sceneOf(): Scene {
  return createMockScene().scene;
}

describe("instantiateLevel", () => {
  it("puts every placement in the scene under a namespaced key", () => {
    const scene = sceneOf();
    const prepared = prepare([
      placement({ id: "p1" }),
      placement({ id: "p2", key: "hero" }),
    ]);

    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
    });

    expect(scene.findByKey("forest/p1")).toBe(instance.get("p1"));
    expect(scene.findByKey("forest/hero")).toBe(instance.get("p2"));
    expect(instance.entities).toHaveLength(2);
    expect(instance.id).toBe("forest");
  });

  it("hands setup the decoded parameters", () => {
    const scene = sceneOf();
    const prepared = prepare([
      placement({ params: { texture: "sprites/one.png" } }),
    ]);

    instantiateLevel(scene, prepared, { namespace: "forest" });

    expect(seen.texture.get("forest/p1")).toEqual(
      new AssetHandle("texture", "sprites/one.png"),
    );
  });

  it("links the authored hierarchy before setup runs, parent-first", () => {
    const scene = sceneOf();
    const prepared = prepare([
      placement({ id: "child", parent: "parent" }),
      placement({ id: "parent" }),
    ]);

    instantiateLevel(scene, prepared, { namespace: "forest" });

    expect(seen.setup).toEqual(["forest/parent", "forest/child"]);
    expect(seen.parents.get("forest/child")).toBe("forest/parent");
  });

  it("keeps placements at one depth in document order, whatever the parents", () => {
    const scene = sceneOf();
    const prepared = prepare([
      placement({ id: "child", parent: "b" }),
      placement({ id: "a" }),
      placement({ id: "b" }),
    ]);

    const instance = instantiateLevel(scene, prepared, { namespace: "forest" });

    expect(seen.setup).toEqual(["forest/a", "forest/b", "forest/child"]);
    expect(instance.entities.map((entity) => entity.requireKey())).toEqual([
      "forest/a",
      "forest/b",
      "forest/child",
    ]);
  });

  it("puts a placement's visuals on the layer it names, and leaves the rest", () => {
    const scene = sceneOf();
    const prepared = prepare(
      [
        placement({
          id: "sign",
          type: "game.painter",
          layer: "props",
          params: {},
        }),
      ],
      Painter,
    );

    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
    });

    const entity = instance.entities[0];
    expect(entity?.get(Painted).layerName).toBe("props");
    // The type put this one on "ui" itself, so the level's layer is not an
    // instruction to move it.
    expect(entity?.get(Badge).layerName).toBe("ui");
  });

  it("leaves every visual alone when the placement names no layer", () => {
    const scene = sceneOf();
    const prepared = prepare(
      [placement({ id: "sign", type: "game.painter", params: {} })],
      Painter,
    );

    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
    });

    expect(instance.entities[0]?.get(Painted).layerName).toBe("default");
  });

  it("composes the instance transform into a top-level placement only", () => {
    const scene = sceneOf();
    const prepared = prepare([
      placement({
        id: "root",
        transform: {
          position: { x: 10, y: 0 },
          rotation: 0,
          scale: { x: 2, y: 2 },
        },
      }),
      placement({
        id: "child",
        parent: "root",
        transform: {
          position: { x: 5, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
      }),
    ]);

    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
      transform: { position: { x: 100, y: 0 }, scale: { x: 3, y: 3 } },
    });

    const root = instance.get("root")?.get(Transform);
    expect(root?.position.x).toBe(130);
    expect(root?.scale.x).toBe(6);
    const child = instance.get("child")?.get(Transform);
    expect(child?.position.x).toBe(5);
    expect(child?.scale.x).toBe(1);
  });

  it("rotates a top-level placement's offset by the instance rotation", () => {
    const scene = sceneOf();
    const prepared = prepare([
      placement({
        transform: {
          position: { x: 10, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
      }),
    ]);

    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
      transform: { rotation: Math.PI / 2 },
    });

    const transform = instance.get("p1")?.get(Transform);
    expect(transform?.position.x).toBeCloseTo(0);
    expect(transform?.position.y).toBeCloseTo(10);
    expect(transform?.rotation).toBeCloseTo(Math.PI / 2);
  });

  it("applies the authored active states before returning", () => {
    const scene = sceneOf();
    const prepared = prepare([
      placement({ id: "on" }),
      placement({ id: "off", active: false }),
    ]);

    const instance = instantiateLevel(scene, prepared, { namespace: "forest" });

    expect(seen.enabled).toEqual(["forest/on"]);
    expect(instance.get("on")?.activeSelf).toBe(true);
    expect(instance.get("off")?.activeSelf).toBe(false);
  });

  it("leaves everything dormant when the caller defers activation", () => {
    const scene = sceneOf();
    const prepared = prepare([placement()]);

    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
      activation: "deferred",
    });

    expect(seen.enabled).toEqual([]);
    expect(instance.get("p1")?.activeSelf).toBe(false);

    instance.activate();
    expect(seen.enabled).toEqual(["forest/p1"]);
  });

  it("loads a placement whose declaration takes no parameters", () => {
    const scene = sceneOf();
    const prepared = prepare(
      [placement({ type: "game.marker", params: {} })],
      Marker,
    );

    const instance = instantiateLevel(scene, prepared, { namespace: "forest" });

    expect(instance.get("p1")).toBeDefined();
    expect(seen.setup).toEqual(["forest/p1"]);
  });

  it("keeps two instances of one document apart by namespace", () => {
    const scene = sceneOf();
    const prepared = prepare([placement()]);

    const first = instantiateLevel(scene, prepared, { namespace: "a" });
    const second = instantiateLevel(scene, prepared, { namespace: "b" });

    expect(first.get("p1")).not.toBe(second.get("p1"));
    expect(scene.findByKey("a/p1")).toBe(first.get("p1"));
    expect(scene.findByKey("b/p1")).toBe(second.get("p1"));
  });
});

describe("instantiateLevel refusals", () => {
  it("refuses a prepared level that carries diagnostics, and reports them", () => {
    const scene = sceneOf();
    const prepared = prepareLevel(
      documentOf(placement({ type: "game.ghost" })),
      catalogOf(Crate),
    );

    let thrown: unknown;
    try {
      instantiateLevel(scene, prepared, { namespace: "forest" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LevelLoadError);
    const error = thrown as LevelLoadError;
    expect(error.documentId).toBe("forest");
    expect(error.placementId).toBe("p1");
    expect(error.diagnostics).toEqual(prepared.diagnostics);
    expect(scene.getEntities()).toHaveLength(0);
  });

  it("names how many problems it did not list", () => {
    const scene = sceneOf();
    const prepared = prepareLevel(
      documentOf(
        ...["a", "b", "c", "d", "e"].map((id) =>
          placement({ id, type: "game.ghost" }),
        ),
      ),
      catalogOf(Crate),
    );

    expect(() =>
      instantiateLevel(scene, prepared, { namespace: "forest" }),
    ).toThrow(/And 2 more/);
  });

  it("rejects a namespace that is empty or carries the separator", () => {
    const scene = sceneOf();
    const prepared = prepare([placement()]);

    for (const namespace of ["", "a/b"]) {
      expect(() => instantiateLevel(scene, prepared, { namespace })).toThrow(
        LevelLoadError,
      );
    }
    expect(scene.getEntities()).toHaveLength(0);
  });

  it("rejects an instance transform that is not usable", () => {
    const scene = sceneOf();
    const prepared = prepare([placement()]);
    const bad = [
      { position: { x: Number.NaN, y: 0 } },
      { scale: { x: Number.POSITIVE_INFINITY, y: 1 } },
      { rotation: Number.POSITIVE_INFINITY },
    ];

    for (const transform of bad) {
      expect(() =>
        instantiateLevel(scene, prepared, { namespace: "forest", transform }),
      ).toThrow(LevelLoadError);
    }
    expect(scene.getEntities()).toHaveLength(0);
  });

  it("places a level instance at a scale of zero", () => {
    // A whole level held at no size, ready to be tweened up. Whether that is
    // useful is the game's to decide; it is a number the engine can hold.
    const scene = sceneOf();
    const prepared = prepare([placement()]);

    instantiateLevel(scene, prepared, {
      namespace: "forest",
      transform: { scale: { x: 0, y: 0 } },
    });

    expect(scene.getEntities()).toHaveLength(1);
  });
});

describe("instantiateLevel failure paths", () => {
  it("rolls the whole batch back when one setup throws", () => {
    const scene = sceneOf();
    const prepared = prepare(
      [
        placement({ id: "ok", type: "game.marker", params: {} }),
        placement({ id: "bad", type: "game.exploding", params: {} }),
      ],
      Marker,
      Exploding,
    );

    let thrown: unknown;
    try {
      instantiateLevel(scene, prepared, { namespace: "forest" });
    } catch (error) {
      thrown = error;
    }

    const error = thrown as LevelLoadError;
    expect(error).toBeInstanceOf(LevelLoadError);
    expect(error.placementId).toBe("bad");
    expect(error.typeId).toBe("game.exploding");
    expect(error.message).toContain("setup went wrong");
    expect((error.cause as Error).message).toBe("setup went wrong");
    expect(scene.getEntities()).toHaveLength(0);
    expect(scene.findByKey("forest/ok")).toBeUndefined();
  });

  it("refuses an entity that has no Transform to place", () => {
    const scene = sceneOf();
    const prepared = prepare(
      [placement({ type: "game.untransformed", params: {} })],
      Untransformed,
    );

    expect(() =>
      instantiateLevel(scene, prepared, { namespace: "forest" }),
    ).toThrow(/has no Transform/);
    expect(scene.getEntities()).toHaveLength(0);
  });

  it("disposes the committed instance when activation fails", () => {
    const scene = sceneOf();
    const prepared = prepare(
      [
        placement({ id: "ok", type: "game.marker", params: {} }),
        placement({ id: "bad", type: "game.unenablable", params: {} }),
      ],
      Marker,
      Unenablable,
    );

    let thrown: unknown;
    try {
      instantiateLevel(scene, prepared, { namespace: "forest" });
    } catch (error) {
      thrown = error;
    }

    const error = thrown as LevelLoadError;
    expect(error).toBeInstanceOf(LevelLoadError);
    expect(error.placementId).toBe("bad");
    expect(error.typeId).toBe("game.unenablable");
    expect(scene.findByKey("forest/ok")).toBeUndefined();
    expect(scene.findByKey("forest/bad")).toBeUndefined();
  });
});

describe("developer callbacks", () => {
  it("attributes a throwing parameter codec through the error boundary", () => {
    const { scene, context } = createMockScene();
    const boundary = context.resolve(ErrorBoundaryKey);
    // Asset descriptors must be deterministic. This deliberately broken one
    // succeeds while preparation derives assets and fails when runtime
    // decoding calls it again, so the runtime callback boundary stays covered
    // without admitting a custom parameter kind.
    let calls = 0;
    const fragileAsset = defineLevelAsset({
      kind: "fragile",
      create: (path: string) => {
        calls++;
        if (calls > 1) {
          throw new Error("this codec is broken");
        }
        return new AssetHandle<string>("fragile", path);
      },
    });
    const FragileParams = defineParams({
      broken: param.asset(fragileAsset, "x"),
    });
    class Fragile extends Entity {
      static readonly level = defineLevelEntity({
        id: "game.fragile",
        version: 1,
        params: FragileParams,
      });

      setup(): void {
        this.add(new Transform());
      }
    }
    const prepared = prepare(
      [placement({ type: "game.fragile", params: { broken: "x" } })],
      Fragile,
    );

    let thrown: unknown;
    try {
      instantiateLevel(scene, prepared, { namespace: "forest" });
    } catch (error) {
      thrown = error;
    }

    const error = thrown as LevelLoadError;
    expect(error).toBeInstanceOf(LevelLoadError);
    expect(error.placementId).toBe("p1");
    expect(error.typeId).toBe("game.fragile");
    expect(error.path).toEqual(["broken"]);
    expect(boundary.getCallbackErrors()).toEqual([
      {
        kind: 'Level parameter codec for "game.fragile"',
        entity: "forest/p1",
        scene: "mock-scene",
        error: 'Parameter "broken" could not be decoded: this codec is broken',
      },
    ]);
  });

  it("names the outer level when one loaded from a setup() fails", () => {
    const scene = sceneOf();
    const inner = prepareLevel(
      {
        format: "yage-level",
        version: 1,
        id: "inner",
        metadata: {},
        entities: [placement({ type: "game.ghost" })],
        extensions: {},
      },
      catalogOf(Crate),
    );
    class Nesting extends Entity {
      static readonly level = defineLevelEntity({
        id: "game.nesting",
        version: 1,
      });

      setup(): void {
        this.add(new Transform());
        instantiateLevel(this.scene, inner, { namespace: "inner" });
      }
    }
    const prepared = prepare(
      [placement({ type: "game.nesting", params: {} })],
      Nesting,
    );

    let thrown: unknown;
    try {
      instantiateLevel(scene, prepared, { namespace: "forest" });
    } catch (error) {
      thrown = error;
    }

    const error = thrown as LevelLoadError;
    expect(error.documentId).toBe("forest");
    expect(error.placementId).toBe("p1");
    expect((error.cause as LevelLoadError).documentId).toBe("inner");
    expect(scene.getEntities()).toHaveLength(0);
  });
});

describe("LevelInstance", () => {
  it("destroys only what it created, child-first, and only once", () => {
    const scene = sceneOf();
    const stranger = scene.spawn("stranger");
    const prepared = prepare([
      placement({ id: "parent" }),
      placement({ id: "child", parent: "parent" }),
    ]);
    const instance = instantiateLevel(scene, prepared, { namespace: "forest" });
    const parent = instance.get("parent");
    const child = instance.get("child");

    instance.dispose();
    instance.dispose();

    expect(parent?.isDestroyed).toBe(true);
    expect(child?.isDestroyed).toBe(true);
    expect(stranger.isDestroyed).toBe(false);
    expect(instance.isDisposed).toBe(true);
    expect(instance.entities).toEqual([]);
    expect(instance.get("parent")).toBeUndefined();
  });

  it("visits a child before its parent", () => {
    const scene = sceneOf();
    const prepared = prepare([
      placement({ id: "parent" }),
      placement({ id: "child", parent: "parent" }),
    ]);
    const instance = instantiateLevel(scene, prepared, { namespace: "forest" });
    // Destruction is queued to the end of the frame, so the visit itself is
    // what carries the order — a component's onDestroy would see neither.
    const order: string[] = [];
    for (const id of ["parent", "child"]) {
      const entity = instance.get(id);
      if (!entity) continue;
      const destroy = entity.destroy.bind(entity);
      entity.destroy = (): void => {
        order.push(id);
        destroy();
      };
    }

    instance.dispose();

    expect(order).toEqual(["child", "parent"]);
  });

  it("destroys an authored entity the game reparented elsewhere", () => {
    const scene = sceneOf();
    const host = scene.spawn("host");
    const prepared = prepare([placement({ id: "p1" })]);
    const instance = instantiateLevel(scene, prepared, { namespace: "forest" });
    const authored = instance.get("p1");

    host.addChild("adopted", authored as Entity);
    instance.dispose();

    expect(authored?.isDestroyed).toBe(true);
    expect(host.isDestroyed).toBe(false);
  });

  it("finishes disposing after one entity fails to be destroyed", () => {
    const { scene, context } = createMockScene();
    const boundary = context.resolve(ErrorBoundaryKey);
    resetSeen();
    const prepared = prepareLevel(
      documentOf(placement({ id: "a" }), placement({ id: "b" })),
      catalogOf(Crate),
    );
    const instance = instantiateLevel(scene, prepared, { namespace: "forest" });
    const failing = instance.get("b");
    if (failing) {
      failing.destroy = (): void => {
        throw new Error("teardown went wrong");
      };
    }

    instance.dispose();

    expect(instance.get("a")).toBeUndefined();
    expect(boundary.getCallbackErrors()).toEqual([
      {
        kind: "Level instance disposal",
        entity: failing?.name,
        scene: "mock-scene",
        error: "teardown went wrong",
      },
    ]);
  });

  it("reports an entity the game destroyed as gone", () => {
    const scene = sceneOf();
    const prepared = prepare([placement()]);
    const instance = instantiateLevel(scene, prepared, { namespace: "forest" });

    instance.get("p1")?.destroy();

    expect(instance.get("p1")).toBeUndefined();
    expect(instance.entities).toEqual([]);
  });

  it("activates once and refuses a second call", () => {
    const scene = sceneOf();
    const prepared = prepare([placement()]);
    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
      activation: "deferred",
    });

    instance.activate();

    expect(() => instance.activate()).toThrow(/already activated/);
    expect(seen.enabled).toEqual(["forest/p1"]);
  });

  it("refuses to activate a disposed instance", () => {
    const scene = sceneOf();
    const prepared = prepare([placement()]);
    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
      activation: "deferred",
    });

    instance.dispose();

    expect(() => instance.activate()).toThrow(/disposed/);
  });
});

describe("entity references", () => {
  const SwitchParams = defineParams({
    door: param.entityRef<Crate>({ types: ["game.crate"] }),
    twin: param.entityRef({ types: ["game.switch"], optional: true }),
  });

  /** How many setups had run when the switch's own component was enabled. */
  let setupsAtEnable = -1;

  class CountSetupsAtEnable extends Component {
    onEnable(): void {
      setupsAtEnable = seen.setup.length;
    }
  }

  /** What each switch resolved, and whether its target had set up yet. */
  const resolved = new Map<
    string,
    { door: EntityHandle<Crate>; doorSetUp: boolean; twin: boolean }
  >();

  class Switch extends Entity {
    static readonly level = defineLevelEntity({
      id: "game.switch",
      version: 1,
      params: SwitchParams,
    });

    private handles?: ParamsOf<typeof SwitchParams>;

    setup(params: ParamsOf<typeof SwitchParams>): void {
      this.add(new Transform());
      this.add(new EnableMarker());
      this.add(new CountSetupsAtEnable());
      this.handles = params;
      const key = this.requireKey();
      seen.setup.push(key);
      resolved.set(key, {
        door: params.door,
        // Read during setup on purpose: the target's own setup may not have
        // run yet, which is the rule the documentation states.
        doorSetUp: seen.setup.includes(params.door.current?.requireKey() ?? ""),
        twin: params.twin !== undefined,
      });
    }

    /** The entity the `door` handle points at now. */
    get door(): Crate | undefined {
      return this.handles?.door.current;
    }
  }

  function aSwitch(overrides: Partial<LevelPlacement> = {}): LevelPlacement {
    return placement({
      id: "s1",
      type: "game.switch",
      params: { door: "p1", twin: null },
      ...overrides,
    });
  }

  it("hands setup a handle on the entity the target became", () => {
    const scene = sceneOf();
    const prepared = prepare([aSwitch(), placement()], Crate, Switch);

    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
    });

    const target = instance.get("p1");
    expect(resolved.get("forest/s1")?.door.current).toBe(target);
    expect(target).toBeInstanceOf(Crate);
  });

  it("resolves a target listed after the placement that points at it", () => {
    // The switch is first in the document, so its setup runs first. Every
    // placement is reserved before any setup, so the handle still resolves.
    const scene = sceneOf();
    const prepared = prepare([aSwitch(), placement()], Crate, Switch);

    instantiateLevel(scene, prepared, { namespace: "forest" });

    expect(resolved.get("forest/s1")?.doorSetUp).toBe(false);
    expect(resolved.get("forest/s1")?.door.current).toBeDefined();
  });

  it("resolves two placements that point at each other", () => {
    const scene = sceneOf();
    const Pair = class extends Entity {
      static readonly level = defineLevelEntity({
        id: "game.pair",
        version: 1,
        params: defineParams({
          other: param.entityRef({ types: ["game.pair"] }),
        }),
      });

      other: Entity | undefined;

      setup(params: { other: EntityHandle }): void {
        this.add(new Transform());
        this.other = params.other.current;
      }
    };
    const prepared = prepare(
      [
        placement({ id: "a", type: "game.pair", params: { other: "b" } }),
        placement({ id: "b", type: "game.pair", params: { other: "a" } }),
      ],
      Pair,
    );

    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
    });

    const a = instance.get("a") as InstanceType<typeof Pair>;
    const b = instance.get("b") as InstanceType<typeof Pair>;
    expect(a.other).toBe(b);
    expect(b.other).toBe(a);
  });

  it("decodes an unchosen optional reference to undefined", () => {
    const scene = sceneOf();
    const prepared = prepare([aSwitch(), placement()], Crate, Switch);

    instantiateLevel(scene, prepared, { namespace: "forest" });

    expect(resolved.get("forest/s1")?.twin).toBe(false);
  });

  it("has run every setup by the time a component is enabled", () => {
    // What replaces an `onLevelReady()` hook: activation happens after the
    // whole batch, so the first `onEnable()` is later than every `setup()`.
    const scene = sceneOf();
    const prepared = prepare([aSwitch(), placement()], Crate, Switch);

    instantiateLevel(scene, prepared, { namespace: "forest" });

    // The switch is enabled first and the crate sets up second, so a count of
    // two is the whole document having set up before the first enable.
    expect(seen.enabled).toEqual(["forest/s1", "forest/p1"]);
    expect(setupsAtEnable).toBe(2);
  });

  it("expires the handle when the target is destroyed, and leaves the referrer", () => {
    const scene = sceneOf();
    const prepared = prepare([aSwitch(), placement()], Crate, Switch);
    const instance = instantiateLevel(scene, prepared, {
      namespace: "forest",
    });
    const referrer = instance.get("s1") as Switch;

    instance.get("p1")?.destroy();
    scene._flushDestroyQueue();

    expect(referrer.door).toBeUndefined();
    expect(referrer.isDestroyed).toBe(false);
  });
});
