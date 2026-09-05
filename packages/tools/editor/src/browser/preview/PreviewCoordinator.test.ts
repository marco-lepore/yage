import {
  Component,
  Transform,
  Vec2,
  type AssetHandle,
  type AssetManager,
  type Engine,
  type System,
} from "@yagejs/core";
import { defineParams, param } from "@yagejs/level";
import type { LevelCatalog, LevelInstance, PreparedLevel } from "@yagejs/level";
import type {
  LevelDocument,
  LevelPlacement,
  LevelTransform,
} from "@yagejs/level/document";
import { SceneRenderTreeProviderKey, VisualComponent } from "@yagejs/renderer";
import type { LayerDef } from "@yagejs/renderer";
import { ARM_PIXELS } from "./gizmo.js";
import { MARK_OFFSET_PIXELS } from "./marks.js";
import {
  GUIDE_LAYER_NAME,
  GUIDE_LAYER_ORDER,
  OVERLAY_LAYER_NAME,
  OVERLAY_LAYER_ORDER,
} from "./EditPreviewScene.js";
import { describe, expect, it, vi } from "vitest";
import { EditorApiClient } from "../api/index.js";
import {
  DEFAULT_VIEW,
  EditorStore,
  type EditGesture,
  type EditorPoint,
  type EditorViewState,
  type GizmoAnchor,
  type GizmoMode,
  type HandleId,
} from "../store/index.js";
import { DestroyFlushQueue } from "./DestroyFlushQueue.js";
import type { OrientedBox } from "./box.js";
import type { OverlayGizmo } from "./overlay.js";
import {
  PreviewCoordinator,
  scheduleRelease,
  type EditorHarness,
} from "./PreviewCoordinator.js";

/**
 * One ordered log of everything the coordinator's sequencing is about: what it
 * loaded, when it tore the previous level down, and what it let go. The order
 * is the contract, so one log is what the assertions read.
 */
const { events, entities } = vi.hoisted(() => ({
  events: [] as string[],
  /** What a built placement resolves to, for the cases that need an entity. */
  entities: new Map<string, unknown>(),
}));

// The level package is the preview's whole input: preparation, the assets a
// document needs, and the loader. Standing in for it is what lets the
// coordinator's own sequencing be driven without an engine — the parts it
// replaces have their own tests in `packages/level`.
vi.mock("@yagejs/level", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@yagejs/level")>()),
  // A placement whose `params.texture` is not a string fails preparation the
  // way the real one does: a `parameter-invalid` finding at that field, and
  // no prepared placement.
  prepareLevel: (document: LevelDocument): PreparedLevel => ({
    document,
    placements: document.entities
      .filter((placement) => typeof placement.params.texture === "string")
      .map((placement) => ({
        placement,
        entry: {} as PreparedLevel["placements"][number]["entry"],
        assets: [
          {
            type: "texture",
            path: texturePathOf(placement),
          } as AssetHandle<unknown>,
        ],
        references: [],
      })),
    diagnostics: document.entities
      .filter((placement) => typeof placement.params.texture !== "string")
      .map((placement) => ({
        code: "parameter-invalid" as const,
        placementId: placement.id,
        path: ["texture"],
        message: 'Parameter "texture" must be a string.',
      })),
  }),
  levelAssets: (prepared: PreparedLevel) =>
    prepared.placements.flatMap((entry) => entry.assets),
  instantiateLevel: (_scene: unknown, subset: PreparedLevel): LevelInstance =>
    ({
      get: (id: string) => entities.get(id),
      dispose: () =>
        events.push(
          `dispose ${subset.placements
            .map((entry) => entry.placement.id)
            .join(",")}`,
        ),
    }) as unknown as LevelInstance,
}));

/** A placement's texture is its id, so a document names what it needs. */
function texturePathOf(placement: LevelPlacement): string {
  return `${placement.id}.png`;
}

/**
 * The lease, reduced to the one call scheduling makes. What it keeps and what
 * it drops is `assets.test.ts`; what matters here is when it is called.
 */
function createLease(): { release(): void; calls: number } {
  return {
    calls: 0,
    release(): void {
      this.calls += 1;
    },
  };
}

function placement(id: string, texture: unknown = `${id}.png`): LevelPlacement {
  return {
    id,
    type: "game.crate",
    typeVersion: 1,
    active: true,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    params: { texture: texture as string },
    extensions: {},
  };
}

/**
 * Put a document into the store, which the overlay reads for the structure the
 * preview does not hold: `build` projects a document, it does not open one.
 */
function opened(store: EditorStore, level: LevelDocument): void {
  store.dispatch({
    type: "level-opened",
    snapshot: {
      path: "levels/forest.yage-level.json",
      epoch: "e1",
      document: level,
      draftRevision: 1,
      diskRevision: "d1",
      contentHash: "c1",
      savedContentHash: "c1",
      dirty: false,
      history: { undoDepth: 0, redoDepth: 0 },
    },
  });
}

function document(...placements: (string | LevelPlacement)[]): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id: "forest",
    metadata: {},
    entities: placements.map((entry) =>
      typeof entry === "string" ? placement(entry) : entry,
    ),
    extensions: {},
  };
}

/**
 * A catalog answering for the reference parameters each named type declares.
 *
 * That is the only thing the coordinator asks a catalog for: what a placement
 * is made of goes through the stand-in `prepareLevel` above.
 */
function catalogDeclaring(
  references: Readonly<Record<string, readonly string[]>> = {},
): LevelCatalog {
  const entries = Object.entries(references).map(([id, fields]) => ({
    id,
    declaration: {
      id,
      version: 1,
      params: defineParams(
        Object.fromEntries(
          fields.map((field) => [field, param.entityRef({ types: [] })]),
        ),
      ),
    },
  }));
  return {
    get: (typeId: string) => entries.find((entry) => entry.id === typeId),
  } as unknown as LevelCatalog;
}

/** A catalog in which no type declares a reference. */
const NO_REFERENCES = catalogDeclaring();

/**
 * A catalog answering for the place-valued parameters each named type
 * declares, as `[field, relative]` pairs.
 */
function catalogWithPoints(
  points: Readonly<Record<string, readonly (readonly [string, boolean])[]>>,
): LevelCatalog {
  const entries = Object.entries(points).map(([id, fields]) => ({
    id,
    declaration: {
      id,
      version: 1,
      params: defineParams(
        Object.fromEntries(
          fields.map(([field, relative]) => [
            field,
            param.point({ x: 0, y: 0 }, { relative }),
          ]),
        ),
      ),
    },
  }));
  return {
    get: (typeId: string) => entries.find((entry) => entry.id === typeId),
  } as unknown as LevelCatalog;
}

/**
 * The coordinator over a stand-in engine.
 *
 * `start()` uses four things: `use`, `start`, `scenes.push`, and one service
 * resolution. None of them needs a renderer or a canvas, so the sequencing the
 * coordinator owns — load, exchange the scene, then release a frame later —
 * can be driven directly. `tick()` runs the systems the editor's plugin
 * registered, which is what advances the flush queue.
 */
/**
 * A camera the coordinator can convert through.
 *
 * The real one is spawned by `EditPreviewScene.onEnter`, which needs a live
 * scene graph no unit test has. Writing the field the scene's getter reads is
 * what lets a case cover a conversion instead of asserting that it declined to
 * make one.
 */
function cameraStub(view: { width: number; height: number }): {
  position: { x: number; y: number };
  zoom: number;
  screenToWorld(x: number, y: number): { x: number; y: number };
} {
  return {
    position: { x: 0, y: 0 },
    zoom: 1,
    screenToWorld(
      this: { position: { x: number; y: number }; zoom: number },
      x: number,
      y: number,
    ) {
      return {
        x: this.position.x + (x - view.width / 2) / this.zoom,
        y: this.position.y + (y - view.height / 2) / this.zoom,
      };
    },
  };
}

/**
 * The renderer stub with the two things a client point has to pass through:
 * where the canvas sits in the page, and the renderer's own mapping from canvas
 * pixels to virtual ones. Without them {@link PreviewCoordinator.screenToWorld}
 * has nothing to convert and every hit test answers null.
 */
function withPointer(renderer: object): object {
  return {
    ...renderer,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    canvasToVirtual: (x: number, y: number) => ({ x, y }),
  };
}

/**
 * A renderer whose fit draws the 800 by 600 design rectangle into a canvas
 * `scale` times that size, with the pointer mapping the fit's own: a client
 * offset in canvas pixels divided back into virtual ones.
 */
function fitted(scale: number): object {
  return {
    setFit: () => {},
    virtualSize: { width: 800, height: 600 },
    virtualCanvasRect: { x: 0, y: 0, width: 800 * scale, height: 600 * scale },
    canvasSize: { width: 800 * scale, height: 600 * scale },
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    canvasToVirtual: (x: number, y: number) => ({ x: x / scale, y: y / scale }),
  };
}

/**
 * The observer the coordinator watches its canvas host with. Node has none,
 * and the callback is kept so a case can deliver a resize itself.
 */
class ResizeObserverStub {
  static last: ResizeObserverStub | undefined;
  observed = 0;
  disconnected = 0;

  constructor(readonly deliver: () => void) {
    ResizeObserverStub.last = this;
  }

  observe(): void {
    this.observed += 1;
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected += 1;
  }
}

globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

/**
 * Wait a queued rebuild out. Each step spans several turns of the task queue,
 * so this yields rather than draining microtasks alone.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The coordinator and the harness it boots from, unstarted, for the cases
 * about what happens before `start()` resolves.
 */
function createParts(
  renderer?: unknown,
  trees?: unknown,
  camera?: unknown,
): {
  coordinator: PreviewCoordinator;
  store: EditorStore;
  harness: EditorHarness;
  systems: System[];
  host: HTMLElement;
} {
  events.length = 0;
  entities.clear();
  const assets = {
    loadAll: (handles: readonly AssetHandle<unknown>[]) => {
      for (const handle of handles) events.push(`load ${handle.path}`);
      return Promise.resolve();
    },
    unload: (handle: AssetHandle<unknown>) =>
      events.push(`unload ${handle.path}`),
  } as unknown as AssetManager;

  const systems: System[] = [];
  const engine = {
    use(plugin: { registerSystems?: (scheduler: unknown) => void }) {
      plugin.registerSystems?.({
        add: (system: System) => systems.push(system),
      });
      return engine;
    },
    start: () => Promise.resolve(),
    scenes: {
      push: (scene: unknown) => {
        if (camera) (scene as { editorCamera?: unknown }).editorCamera = camera;
        return Promise.resolve();
      },
    },
    context: {
      resolve: () => assets,
      // Keyed rather than "whatever the case passed": the coordinator resolves
      // two services now, and a stub that answers every key with the same
      // object hands one of them the other one.
      tryResolve: (key: unknown) =>
        key === SceneRenderTreeProviderKey ? trees : renderer,
    },
    destroy: () => {},
  } as unknown as Engine;

  const store = new EditorStore({
    api: new EditorApiClient({
      token: "t",
      fetch: () => Promise.reject(new Error("not used")),
    }),
    epoch: "epoch-1",
    projectId: "project-1",
  });
  const host = { appendChild: () => {} } as unknown as HTMLElement;
  const coordinator = new PreviewCoordinator({ host, store });

  return {
    coordinator,
    store,
    harness: { engine: () => engine, plugins: () => [] },
    systems,
    host,
  };
}

async function createHarness(
  renderer?: unknown,
  trees?: unknown,
  camera?: unknown,
): Promise<{
  coordinator: PreviewCoordinator;
  store: EditorStore;
  events: string[];
  build(
    document: LevelDocument,
    layers?: readonly LayerDef[],
    catalog?: LevelCatalog,
  ): Promise<void>;
  tick(frames: number): void;
}> {
  const parts = createParts(renderer, trees, camera);
  await parts.coordinator.start(parts.harness);

  return {
    coordinator: parts.coordinator,
    store: parts.store,
    events,
    async build(
      document: LevelDocument,
      layers: readonly LayerDef[] = [],
      catalog: LevelCatalog = NO_REFERENCES,
    ): Promise<void> {
      parts.coordinator.requestRebuild({ document, catalog, layers });
      await settle();
    },
    tick(frames: number): void {
      for (let i = 0; i < frames; i += 1) {
        for (const system of parts.systems) system.update(1 / 60);
      }
    },
  };
}

describe("PreviewCoordinator", () => {
  it("runs a rebuild as load, then exchange, then release", async () => {
    const harness = await createHarness();
    await harness.build(document("crate"));
    await harness.build(document("barrel"));

    // Loading first is what keeps a texture both documents use from dropping
    // to zero references while the exchange runs. Releasing last, and a frame
    // later, is what keeps the disposed entities — which stay in the scene
    // until the engine's end-of-frame flush — from drawing with a destroyed
    // texture.
    expect(harness.events).toEqual([
      "load crate.png",
      "load barrel.png",
      "dispose crate",
    ]);

    harness.tick(1);
    expect(harness.events).toHaveLength(3);

    harness.tick(1);
    expect(harness.events.at(-1)).toBe("unload crate.png");
  });

  it("builds a level opened before the engine finished booting", async () => {
    const parts = createParts();

    // The shell renders before `start()` resolves, so this is a level picked
    // while the engine is still coming up.
    parts.coordinator.requestRebuild({
      document: document("crate"),
      catalog: NO_REFERENCES,
      layers: [],
    });
    await settle();
    expect(events).toEqual([]);

    await parts.coordinator.start(parts.harness);
    await settle();

    expect(events).toEqual(["load crate.png"]);
  });

  it("puts the camera on the store's view once the engine is up", async () => {
    const camera = cameraStub({ width: 800, height: 600 });
    const parts = createParts(undefined, undefined, camera);
    // What opening a level during the boot does to the view: the level's
    // remembered camera is in the store before there is one to write it to.
    parts.store.dispatch({
      type: "view-changed",
      view: { ...DEFAULT_VIEW, center: { x: 40, y: -20 }, zoom: 2 },
    });

    await parts.coordinator.start(parts.harness);

    expect(camera.position.x).toBe(40);
    expect(camera.position.y).toBe(-20);
    expect(camera.zoom).toBe(2);
  });

  it("keeps an asset the new level still needs", async () => {
    const harness = await createHarness();
    await harness.build(document("crate"));
    await harness.build(document("crate", "barrel"));
    harness.tick(2);

    expect(harness.events.filter((one) => one.startsWith("unload"))).toEqual(
      [],
    );
  });

  it("forwards a preparation finding with its own code and path", async () => {
    const harness = await createHarness();
    await harness.build(document("crate", placement("barrel", 7)));

    // The level package's code and path travel with the diagnostic, stamped
    // with the preview's source and revision. A repair control switches on
    // them; the message is for reading.
    expect(harness.store.getState().diagnostics.get("preview")).toEqual([
      {
        code: "parameter-invalid",
        severity: "error",
        source: "preview",
        message: 'Parameter "texture" must be a string.',
        revision: 1,
        placementId: "barrel",
        path: ["texture"],
      },
    ]);
    // The rest of the level still built.
    expect(harness.events).toContain("load crate.png");
    expect(harness.events).not.toContain("load barrel.png");
  });

  it("takes everything back when the editor closes", async () => {
    const harness = await createHarness();
    await harness.build(document("crate"));
    await harness.coordinator.dispose();

    // Closing does not wait for a frame that will never come: the engine is
    // destroyed in the same call.
    expect(harness.events.filter((one) => one.startsWith("unload"))).toEqual([
      "unload crate.png",
    ]);
  });

  describe("the view", () => {
    /**
     * A renderer reduced to what framing and the overlay read: the canvas, the
     * virtual size, and where that rectangle lands on the canvas. Here all
     * three agree, so one virtual pixel is one screen pixel.
     */
    const renderer = {
      setFit: () => {},
      canvasSize: { width: 800, height: 600 },
      virtualSize: { width: 800, height: 600 },
      virtualCanvasRect: { x: 0, y: 0, width: 800, height: 600 },
    };

    it("frames what the named placements cover", async () => {
      const harness = await createHarness(renderer);
      // Wider than it is tall, and framed in a viewport that is also wider
      // than it is tall, so the two axes cannot be swapped without changing
      // the answer. A square placement would frame identically either way.
      entities.set("crate", entityAt(100, 50, { half: 40, halfY: 10 }));
      await harness.build(document("crate"));

      harness.coordinator.frameSelection(["crate"]);

      const view = harness.store.getState().view;
      expect(view.center).toEqual({ x: 100, y: 50 });
      // Width is the tighter fit: 800 / (80 * 1.2) against 600 / (20 * 1.2).
      expect(view.zoom).toBeCloseTo(800 / (80 * 1.2), 12);
    });

    it("marks every selected placement and draws one gizmo over them", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(100, 50, { half: 25 }));
      entities.set("barrel", entityAt(0, 0, { half: 5 }));
      const level = document("crate", "barrel");
      await harness.build(level);
      opened(harness.store, level);

      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel"],
      });
      const both = harness.coordinator.overlayView();
      expect(both.boxes).toHaveLength(2);
      // One gizmo however many are selected, anchored under the default pivot
      // on the last one added.
      expect(armsOf(both.gizmo)?.anchor.position).toEqual({ x: 0, y: 0 });

      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      const one = harness.coordinator.overlayView();
      expect(one.boxes).toHaveLength(1);
      expect(armsOf(one.gizmo)?.anchor.position).toEqual({ x: 100, y: 50 });
      expect(armsOf(one.gizmo)?.mode).toBe("translate");
    });

    it("marks what a drag of the selection would carry with it", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(100, 50, { half: 25 }));
      entities.set("lantern", entityAt(400, 400, { half: 10 }));
      entities.set("barrel", entityAt(0, 0, { half: 5 }));
      const level = document(
        "crate",
        { ...placement("lantern"), parent: "crate" },
        "barrel",
      );
      await harness.build(level);
      opened(harness.store, level);

      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      // The child moves with its parent even though it is drawn far outside
      // it. The unrelated placement is not marked at all.
      const view = harness.coordinator.overlayView();
      expect(view.boxes).toHaveLength(1);
      expect(view.carried?.boxes).toEqual([
        { minX: 390, minY: 390, maxX: 410, maxY: 410 },
      ]);
    });

    it("marks a selected child once, as selected", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(100, 50, { half: 25 }));
      entities.set("lantern", entityAt(400, 400, { half: 10 }));
      const level = document("crate", {
        ...placement("lantern"),
        parent: "crate",
      });
      await harness.build(level);
      opened(harness.store, level);

      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "lantern"],
      });

      // Both markers on one placement would read as two placements.
      const view = harness.coordinator.overlayView();
      expect(view.boxes).toHaveLength(2);
      expect(view.carried).toEqual({ boxes: [], points: [] });
    });

    it("anchors on the last placement selected, and on the middle when asked", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 50 }));
      entities.set("barrel", entityAt(200, 0, { half: 50 }));
      const level = document("crate", "barrel");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel"],
      });

      // Active: the barrel joined the selection last, so the gizmo sits on it.
      expect(
        armsOf(harness.coordinator.overlayView().gizmo)?.anchor.position,
      ).toEqual({ x: 200, y: 0 });

      harness.store.dispatch({ type: "pivot-changed", pivot: "center" });

      // Center: the middle of what the two cover, which is not either origin.
      expect(
        armsOf(harness.coordinator.overlayView().gizmo)?.anchor.position,
      ).toEqual({ x: 100, y: 0 });
    });

    it("moves along the level's axes or the active placement's", async () => {
      const harness = await createHarness(renderer);
      entities.set(
        "crate",
        entityAt(0, 0, { half: 50, rotation: Math.PI / 2 }),
      );
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      expect(
        armsOf(harness.coordinator.overlayView().gizmo)?.anchor.rotation,
      ).toBeCloseTo(Math.PI / 2, 9);

      harness.store.dispatch({ type: "axes-changed", axes: "world" });

      expect(
        armsOf(harness.coordinator.overlayView().gizmo)?.anchor.rotation,
      ).toBe(0);
    });

    it("boxes a lone turned placement on its own axes, whatever the toggle says", async () => {
      const harness = await createHarness(renderer);
      // 200 by 100, turned a quarter. Upright it would cover 100 by 200; on
      // its own axes it is still 200 by 100, which is the rectangle the
      // handles have to sit on to resize the picture.
      entities.set(
        "crate",
        entityAt(0, 0, { half: 100, halfY: 50, rotation: Math.PI / 2 }),
      );
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      harness.store.dispatch({ type: "axes-changed", axes: "world" });

      const box = boxOf(harness.coordinator.overlayView().gizmo);
      expect(box?.halfX).toBeCloseTo(100, 9);
      expect(box?.halfY).toBeCloseTo(50, 9);
      // The box is the placement's outline, so the marker would draw a second
      // rectangle over it.
      expect(harness.coordinator.overlayView().boxes).toHaveLength(0);
    });

    it("scales along the placement's own axes under the level's", async () => {
      const harness = await createHarness(renderer);
      entities.set(
        "crate",
        entityAt(0, 0, { half: 50, rotation: Math.PI / 2 }),
      );
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch({ type: "axes-changed", axes: "world" });

      // A scale can only grow a placement along its own axes, so an arm drawn
      // along the level's would point where the placement will not grow.
      harness.store.dispatch({ type: "tool-changed", tool: "scale" });
      expect(
        armsOf(harness.coordinator.overlayView().gizmo)?.anchor.rotation,
      ).toBeCloseTo(Math.PI / 2, 9);

      // A turn is about the screen normal: one ring, no axis to choose.
      harness.store.dispatch({ type: "tool-changed", tool: "rotate" });
      expect(
        armsOf(harness.coordinator.overlayView().gizmo)?.anchor.rotation,
      ).toBe(0);
    });

    it("boxes a selection upright, and outlines it under the arms", async () => {
      const harness = await createHarness(renderer);
      entities.set(
        "crate",
        entityAt(0, 0, { half: 50, rotation: Math.PI / 4 }),
      );
      entities.set("lid", entityAt(200, 0, { half: 50 }));
      const level = document("crate", "lid");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "lid"],
      });
      harness.store.dispatch({ type: "axes-changed", axes: "local" });

      // Local names the active placement's axes, and a box round a selection
      // has no business wearing one member's angle.
      const covering = armsOf(
        harness.coordinator.overlayView().gizmo,
      )?.covering;
      expect(covering?.axisX).toEqual({ x: 1, y: 0 });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      expect(boxOf(harness.coordinator.overlayView().gizmo)?.axisX).toEqual({
        x: 1,
        y: 0,
      });
    });

    it("marks every origin, and no pivot, under the each pivot", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 50 }));
      entities.set("lid", entityAt(200, 0, { half: 50 }));
      const level = document("crate", "lid");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "lid"],
      });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      harness.store.dispatch({ type: "pivot-changed", pivot: "individual" });

      const view = harness.coordinator.overlayView();
      // Every placement turns about its own origin, so there is no one point
      // to mark and two to show.
      expect(view.gizmo?.kind === "box" ? view.gizmo.pivot : "no box").toBe(
        undefined,
      );
      expect(view.origins).toEqual([
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ]);
    });

    it("holds a rotate gesture's ring on the point it pressed, whatever the placements do", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 50 }));
      entities.set("lid", entityAt(200, 0, { half: 50 }));
      const level = document("crate", "lid");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "lid"],
      });
      harness.store.dispatch({ type: "pivot-changed", pivot: "center" });

      const before = armsOf(harness.coordinator.overlayView().gizmo)?.anchor;
      expect(before?.position).toEqual({ x: 100, y: 0 });

      // A gesture pivots about the point it froze at the press. The box round
      // a turning arrangement breathes, so a drawn pivot recomputed from the
      // placements would wander off the one in use.
      const elsewhere = { x: -400, y: 250 };
      harness.store.dispatch({
        type: "gesture-started",
        gesture: gestureOf({
          kind: "rotate",
          anchor: { position: elsewhere, rotation: 0 },
          pivot: elsewhere,
          ids: ["crate", "lid"],
        }),
      });
      // Placed so the box they cover is centred somewhere else again: poses
      // whose centre landed back on the pressed point would keep this green
      // however the anchor were derived.
      harness.coordinator.applyPoseDraft([
        { id: "crate", transform: poseAt(-300, 400) },
        { id: "lid", transform: poseAt(-700, 100) },
      ]);

      expect(
        armsOf(harness.coordinator.overlayView().gizmo)?.anchor.position,
      ).toEqual(elsewhere);
    });

    it("carries the gizmo with a translate that started on a handle", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 50 }));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch({
        type: "gesture-started",
        gesture: gestureOf({
          kind: "translate",
          handle: "x",
          anchor: { position: { x: 0, y: 0 }, rotation: 0 },
          ids: ["crate"],
        }),
      });

      // The drag has already moved the placement, so the handles are on it.
      // Which press path started the drag decides nothing about where they go.
      harness.coordinator.applyPoseDraft([
        { id: "crate", transform: poseAt(60, 0) },
      ]);

      expect(armsOf(harness.coordinator.overlayView().gizmo)?.anchor).toEqual({
        position: { x: 60, y: 0 },
        rotation: 0,
      });
    });

    it("keeps the arms on the axis the drag is held to", async () => {
      const harness = await createHarness(renderer);
      const turned = Math.PI / 4;
      entities.set("crate", entityAt(0, 0, { half: 50, rotation: turned }));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch({ type: "axes-changed", axes: "local" });
      harness.store.dispatch({
        type: "gesture-started",
        gesture: gestureOf({
          kind: "translate",
          handle: "x",
          anchor: { position: { x: 0, y: 0 }, rotation: turned },
          ids: ["crate"],
        }),
      });

      // The arms name the axis the move is locked to, and that axis was
      // chosen at the press. A toggle thrown mid-drag must not turn them.
      harness.store.dispatch({ type: "axes-changed", axes: "world" });
      harness.coordinator.applyPoseDraft([
        { id: "crate", transform: poseAt(40, 40, turned) },
      ]);

      expect(armsOf(harness.coordinator.overlayView().gizmo)?.anchor).toEqual({
        position: { x: 40, y: 40 },
        rotation: turned,
      });
    });

    it("moves the box tool's pivot mark with the box it belongs to", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 50 }));
      entities.set("lid", entityAt(200, 0, { half: 50 }));
      const level = document("crate", "lid");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "lid"],
      });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      harness.store.dispatch({ type: "pivot-changed", pivot: "center" });
      harness.store.dispatch({
        type: "gesture-started",
        gesture: gestureOf({
          kind: "translate",
          handle: "body",
          anchor: { position: { x: 100, y: 0 }, rotation: 0 },
          pivot: { x: 100, y: 0 },
          ids: ["crate", "lid"],
        }),
      });
      harness.coordinator.applyPoseDraft([
        { id: "crate", transform: poseAt(60, 0) },
        { id: "lid", transform: poseAt(260, 0) },
      ]);

      // The rectangle is recomputed every redraw, so a mark that stayed put
      // would sit outside the box it claims to be the centre of.
      const gizmo = harness.coordinator.overlayView().gizmo;
      expect(boxOf(gizmo)?.center).toEqual({ x: 160, y: 0 });
      expect(gizmo?.kind === "box" ? gizmo.pivot : "no box").toEqual({
        x: 160,
        y: 0,
      });
    });

    it("marks the pivot through a drag that started on a placement's body", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 50 }));
      entities.set("lid", entityAt(200, 0, { half: 50 }));
      const level = document("crate", "lid");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "lid"],
      });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      harness.store.dispatch({ type: "pivot-changed", pivot: "center" });
      const before = gripsOf(harness.coordinator.overlayView().gizmo);
      expect(before).toHaveLength(8);

      // A press on a placement's body carries neither an anchor nor a pivot.
      // Reading them off the gesture would blank the mark and change which
      // grips are drawn for as long as the drag runs.
      harness.store.dispatch({
        type: "gesture-started",
        gesture: gestureOf({ kind: "translate", ids: ["crate", "lid"] }),
      });
      harness.coordinator.applyPoseDraft([
        { id: "crate", transform: poseAt(60, 0) },
        { id: "lid", transform: poseAt(260, 0) },
      ]);

      const gizmo = harness.coordinator.overlayView().gizmo;
      expect(gizmo?.kind === "box" ? gizmo.pivot : "no box").toEqual({
        x: 160,
        y: 0,
      });
      expect(gripsOf(gizmo)).toEqual(before);
    });

    it("keeps every box grip while a translate carries the box away", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 50 }));
      entities.set("lid", entityAt(200, 0, { half: 50 }));
      const level = document("crate", "lid");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "lid"],
      });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      harness.store.dispatch({ type: "pivot-changed", pivot: "center" });
      const before = gripsOf(harness.coordinator.overlayView().gizmo);
      expect(before).toHaveLength(8);

      harness.store.dispatch({
        type: "gesture-started",
        gesture: gestureOf({
          kind: "translate",
          handle: "body",
          anchor: { position: { x: 100, y: 0 }, rotation: 0 },
          pivot: { x: 100, y: 0 },
          ids: ["crate", "lid"],
        }),
      });
      // Exactly the box's half-width: a grip measures its side from the
      // anchor, so an anchor left behind would put the whole west side on it
      // and drop the three grips that hold it.
      harness.coordinator.applyPoseDraft([
        { id: "crate", transform: poseAt(150, 0) },
        { id: "lid", transform: poseAt(350, 0) },
      ]);

      expect(gripsOf(harness.coordinator.overlayView().gizmo)).toEqual(before);
    });

    it("moves the disc that drags a placement with no rectangle", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      harness.store.dispatch({
        type: "gesture-started",
        gesture: gestureOf({
          kind: "translate",
          handle: "body",
          anchor: { position: { x: 0, y: 0 }, rotation: 0 },
          ids: ["crate"],
        }),
      });
      harness.coordinator.applyPoseDraft([
        { id: "crate", transform: poseAt(0, 75) },
      ]);

      const gizmo = harness.coordinator.overlayView().gizmo;
      expect(gizmo?.kind).toBe("radial");
      expect(
        gizmo?.kind === "radial" ? gizmo.anchor.position : undefined,
      ).toEqual({ x: 0, y: 75 });
    });

    it("anchors on the outermost of a selection, not on a selected child", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 50 }));
      entities.set("lid", entityAt(400, 0, { half: 10 }));
      const level = document("crate", { ...placement("lid"), parent: "crate" });
      await harness.build(level);
      opened(harness.store, level);

      // The child was clicked last, but it travels with its parent and no
      // transform acts on it, so the gizmo falls back to the parent.
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "lid"],
      });

      expect(
        armsOf(harness.coordinator.overlayView().gizmo)?.anchor.position,
      ).toEqual({ x: 0, y: 0 });
    });

    it("draws the placement's own box for the box tool, and no upright one", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(100, 50, { half: 25 }));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      harness.store.dispatch({ type: "tool-changed", tool: "box" });

      const view = harness.coordinator.overlayView();
      // The box outlines the placement along its own axes, so the upright
      // marker would be a second rectangle over the same placement.
      expect(view.boxes).toEqual([]);
      expect(view.gizmo?.kind).toBe("box");
    });

    it("keeps the box grips for a placement scaled to nothing", async () => {
      const harness = await createHarness(renderer);
      // The case this whole rule exists for: a placement animated in from
      // nothing draws no size, and the box round its artwork is what a drag
      // needs to bring it back.
      entities.set(
        "crate",
        entityAt(0, 0, { half: 32, scale: { x: 0, y: 0 } }),
      );
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });

      const view = harness.coordinator.overlayView();
      expect(view.gizmo?.kind).toBe("box");
      expect(gripsOf(view.gizmo)).toHaveLength(8);
    });

    it("drops the grips whose side sits on the origin", async () => {
      const harness = await createHarness(renderer);
      // A sprite whose game passed no anchor draws out from its origin, so its
      // `w` and `n` sides run through the point a scale turns about. No scale
      // moves a side sitting there, so those grips are not offered.
      entities.set("crate", entityAt(0, 0, { half: 32, fromOrigin: true }));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });

      expect(gripsOf(harness.coordinator.overlayView().gizmo)).toEqual([
        "e",
        "se",
        "s",
      ]);
    });

    it("measures an ordinary selection against its own rectangle", async () => {
      // 250 by 50 world units, drawn a world unit to the screen pixel, so it
      // is far above the size the drawn box is held at and the grips divide by
      // exactly what the selection covers.
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        withPointer(renderer),
        undefined,
        camera,
      );
      entities.set("crate", entityAt(-100, 0, { half: 25 }));
      entities.set("barrel", entityAt(100, 0, { half: 25 }));
      const level = document("crate", "barrel");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel"],
      });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      harness.store.dispatch({ type: "pivot-changed", pivot: "center" });

      // The east grip sits 125 out from the box's centre, which the camera
      // draws at the middle of an 800 by 600 canvas.
      const grab = harness.coordinator.gizmoAt({ x: 400 + 125, y: 300 });

      expect(grab?.handle).toBe("e");
      expect(grab?.reference).toEqual({ x: 125, y: 0, kind: "length" });
    });

    it("measures a selection smaller than the drawn box against the drawn box", async () => {
      // Two world units across. The box is drawn and grabbed at the 48-pixel
      // minimum, and measuring against the true half instead turned every
      // pointer pixel into a jump of two thirds of the selection.
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        withPointer(renderer),
        undefined,
        camera,
      );
      entities.set("crate", entityAt(-1, 0, { half: 0.5 }));
      entities.set("barrel", entityAt(1, 0, { half: 0.5 }));
      const level = document("crate", "barrel");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel"],
      });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      harness.store.dispatch({ type: "pivot-changed", pivot: "center" });

      const grab = harness.coordinator.gizmoAt({ x: 400 + 24, y: 300 });

      expect(grab?.handle).toBe("e");
      expect(grab?.reference.x).toBe(24);
    });

    it("keeps every grip for a selection collapsed onto a line", async () => {
      const harness = await createHarness(renderer);
      // Three placements at no size, one above the other: the box round them
      // has height and no width at all, so the grips holding an east or west
      // side had nothing to divide by.
      for (const [id, y] of [
        ["crate", -50],
        ["barrel", 0],
        ["lid", 50],
      ] as const) {
        entities.set(id, entityAt(0, y, { half: 16, scale: { x: 0, y: 0 } }));
      }
      const level = document("crate", "barrel", "lid");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel", "lid"],
      });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });
      harness.store.dispatch({ type: "pivot-changed", pivot: "center" });

      const view = harness.coordinator.overlayView();
      expect(view.gizmo?.kind).toBe("box");
      expect(gripsOf(view.gizmo)).toHaveLength(8);
    });

    it("keeps the grips for a child of a parent flattened to nothing", async () => {
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        withPointer(renderer),
        undefined,
        camera,
      );
      // The parent draws every scale the child could hold at one point, so
      // nothing the drag does is visible — but the local scale it writes is,
      // in the inspector, and the grips are what write it.
      entities.set(
        "crate",
        entityAt(0, 0, { half: 16, scale: { x: 0, y: 0 } }),
      );
      const level = document(
        {
          ...placement("frame"),
          transform: {
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 0, y: 0 },
          },
        },
        { ...placement("crate"), parent: "frame" },
      );
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });

      const view = harness.coordinator.overlayView();
      expect(gripsOf(view.gizmo)).toHaveLength(8);
      // The artwork's own half, because a flattened parent counts as one:
      // half the rectangle's width of pointer travel adds one to the scale.
      const grab = harness.coordinator.gizmoAt({ x: 400 + 24, y: 300 });
      expect(grab?.reference).toEqual({ x: 16, y: 0, kind: "extent" });
    });

    it("carries all three transforms round a placement with no rectangle", async () => {
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        withPointer(renderer),
        undefined,
        camera,
      );
      entities.set("crate", entityAt(0, 0, { half: 0 }));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      harness.store.dispatch({ type: "tool-changed", tool: "box" });

      // The box tool's grammar without a rectangle to hang it on: press the
      // centre to move, a grip to scale, the band outside to turn.
      const at = (
        x: number,
        y: number,
      ): ReturnType<typeof harness.coordinator.gizmoAt> =>
        harness.coordinator.gizmoAt({ x: 400 + x, y: 300 + y });

      expect(at(0, 0)).toMatchObject({ handle: "body", mode: "translate" });
      expect(at(ARM_PIXELS, 0)).toMatchObject({ handle: "x", mode: "scale" });
      expect(at(0, ARM_PIXELS)).toMatchObject({ handle: "y", mode: "scale" });
      expect(at(ARM_PIXELS + 20, 0)).toMatchObject({
        handle: "turn",
        mode: "rotate",
      });
    });

    it("crosses every selected placement's origin under every pivot", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(100, 50, { half: 25 }));
      entities.set("barrel", entityAt(0, 0, { half: 5 }));
      const level = document("crate", "barrel");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel"],
      });

      // The crosshair is what makes a missing grip legible, so it is not
      // conditional on the pivot the way the old dot was.
      for (const pivot of ["active", "center", "individual"] as const) {
        harness.store.dispatch({ type: "pivot-changed", pivot });
        expect(harness.coordinator.overlayView().origins).toEqual([
          { x: 100, y: 50 },
          { x: 0, y: 0 },
        ]);
      }
    });

    it("marks a component nothing on screen stands for", async () => {
      const harness = await createHarness(renderer);
      entities.set("beacon", entityCarrying(40, 10, "LightSource"));
      entities.set("crate", entityAt(0, 0, { half: 25 }));
      const level = document("beacon", "crate");
      await harness.build(level);
      opened(harness.store, level);

      // Nothing is selected: the marks are what makes an invisible placement
      // visible in the first place, so they cannot wait for it to be found.
      expect(harness.coordinator.overlayView().marks).toEqual([
        {
          type: "LightSource",
          kind: "light",
          at: { x: 40, y: 10 - MARK_OFFSET_PIXELS },
        },
      ]);
    });

    it("marks the invisible components of a placement that draws something", async () => {
      const harness = await createHarness(renderer);
      entities.set(
        "brazier",
        entityCarrying(0, 0, "LightSource", "ParticleEmitterComponent"),
      );
      const level = document("brazier");
      await harness.build(level);
      opened(harness.store, level);

      // What the row answers is what is on this entity. A sprite says where
      // the brazier is and says nothing about the fire it will throw.
      expect(
        harness.coordinator.overlayView().marks?.map((mark) => mark.type),
      ).toEqual(["LightSource", "ParticleEmitterComponent"]);
    });

    it("selects the placement a pressed mark belongs to", async () => {
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        withPointer(renderer),
        undefined,
        camera,
      );
      entities.set("beacon", entityCarrying(0, 0, "LightSource"));
      const level = document("beacon");
      await harness.build(level);
      opened(harness.store, level);

      // The placement draws nothing, so its own origin hits nothing and the
      // mark under it is the only thing there is to press.
      expect(harness.coordinator.hitTest({ x: 400, y: 300 })).toBeNull();
      expect(
        harness.coordinator.hitTest({ x: 400, y: 300 - MARK_OFFSET_PIXELS }),
      ).toBe("beacon");
    });

    it("presses a mark before the artwork it is drawn over", async () => {
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        withPointer(renderer),
        undefined,
        camera,
      );
      // Scenery wide enough to cover the beacon's whole row of marks, and
      // added later, so the artwork would win every test that took it first.
      entities.set("beacon", entityCarrying(0, 0, "LightSource"));
      entities.set("floor", entityAt(0, 0, { half: 200 }));
      const level = document("beacon", "floor");
      await harness.build(level);
      opened(harness.store, level);

      expect(
        harness.coordinator.hitTest({ x: 400, y: 300 - MARK_OFFSET_PIXELS }),
      ).toBe("beacon");
      expect(harness.coordinator.hitTest({ x: 400, y: 300 })).toBe("floor");
    });

    it("names the component under the pointer", async () => {
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        withPointer(renderer),
        undefined,
        camera,
      );
      entities.set("chime", entityCarrying(0, 0, "game.Chime"));
      const level = document("chime");
      await harness.build(level);
      opened(harness.store, level);

      // The drawing for a component the editor has never heard of says only
      // that something is there. The name is what says what.
      expect(
        harness.coordinator.markAt({ x: 400, y: 300 - MARK_OFFSET_PIXELS }),
      ).toBe("game.Chime");
      expect(harness.coordinator.markAt({ x: 400, y: 300 })).toBeNull();
    });

    it("goes radial when a placement has no box to draw", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 0 }));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      harness.store.dispatch({ type: "tool-changed", tool: "box" });

      // Nothing drawn means no sides to put handles on, so the box tool puts
      // its three transforms round the origin instead. The origin crosshair
      // still says where the placement is.
      const view = harness.coordinator.overlayView();
      expect(view.gizmo?.kind).toBe("radial");
      expect(view.origins).toHaveLength(1);
    });

    it("keeps one transform per tool for a placement with no box", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 0 }));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      // The radial gizmo is the box tool's fallback. A tool that names one
      // transform still draws that one's arms.
      for (const tool of ["translate", "rotate", "scale"] as const) {
        harness.store.dispatch({ type: "tool-changed", tool });
        const gizmo = harness.coordinator.overlayView().gizmo;
        expect(gizmo?.kind).toBe("arms");
        expect(gizmo?.kind === "arms" ? gizmo.mode : undefined).toBe(tool);
      }
    });

    it("boxes several placements together and keeps every marker", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(100, 50, { half: 25 }));
      entities.set("barrel", entityAt(0, 0, { half: 5 }));
      const level = document("crate", "barrel");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel"],
      });

      harness.store.dispatch({ type: "tool-changed", tool: "box" });

      // The box covers both, from the barrel's near corner to the crate's far
      // one. It stands in for no single placement's outline, so both keep the
      // marker they had.
      const view = harness.coordinator.overlayView();
      const box = boxOf(view.gizmo);
      expect(box?.center).toEqual({ x: 60, y: 35 });
      expect(box?.halfX).toBe(65);
      expect(box?.halfY).toBe(40);
      expect(view.boxes).toHaveLength(2);
    });

    it("follows the tool the shell picked", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 25 }));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      harness.store.dispatch({ type: "tool-changed", tool: "rotate" });

      expect(armsOf(harness.coordinator.overlayView().gizmo)?.mode).toBe(
        "rotate",
      );
    });

    it("sizes the overlay from the zoom", async () => {
      const harness = await createHarness(renderer);
      await harness.build(document());

      harness.store.dispatch({
        type: "view-changed",
        view: {
          center: { x: 0, y: 0 },
          zoom: 4,
          guides: true,
          snap: true,
          step: 32,
        },
      });

      // World units per screen pixel, which is what keeps the gizmo one size
      // on screen.
      expect(harness.coordinator.overlayView().perScreenPixel).toBe(0.25);
    });

    it("puts the fit's scale on the camera and not on the overlay", async () => {
      // A fit drawing an 800-wide virtual viewport into a 500-wide pane. The
      // camera carries the whole of it, so `view.zoom` is canvas pixels per
      // world unit and every screen-pixel size the overlay draws is the same
      // number of world units whatever the pane is.
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(fitted(0.625), undefined, camera);
      await harness.build(document());

      const view = { ...DEFAULT_VIEW, zoom: 2 };
      harness.store.dispatch({ type: "view-changed", view });
      harness.coordinator.applyView(view);

      expect(camera.zoom).toBeCloseTo(2 / 0.625, 12);
      expect(harness.coordinator.overlayView().perScreenPixel).toBe(0.5);
    });

    it("takes the tighter axis when a fit scales them differently", async () => {
      // Under `stretch` the two axes scale apart. Taking the smaller keeps a
      // handle at least its nominal size on both rather than on neither.
      const stretched = {
        setFit: () => {},
        virtualSize: { width: 800, height: 600 },
        virtualCanvasRect: { x: 0, y: 0, width: 800, height: 300 },
      };
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(stretched, undefined, camera);
      await harness.build(document());

      harness.coordinator.applyView({ ...DEFAULT_VIEW, zoom: 1 });

      expect(camera.zoom).toBeCloseTo(1 / (300 / 600), 12);
    });

    it("leaves the camera on the zoom while the canvas has no room", async () => {
      // A pane with no width yet measures zero, and dividing by it would put
      // the camera at infinity.
      const unlaid = {
        setFit: () => {},
        virtualSize: { width: 800, height: 600 },
        virtualCanvasRect: { x: 0, y: 0, width: 0, height: 0 },
      };
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(unlaid, undefined, camera);
      await harness.build(document());

      harness.coordinator.applyView({ ...DEFAULT_VIEW, zoom: 2 });

      expect(camera.zoom).toBe(2);
    });

    it("grabs the same handle whatever the fit scaled the canvas by", async () => {
      // Two world units across, so the box is drawn and grabbed at its
      // 48-pixel minimum and the answer depends on what a screen pixel is
      // worth. A canvas-scale correction left in the overlay would put the
      // east grip 38 world units out in the smaller pane instead of 24.
      const grabbed = async (scale: number): Promise<string | undefined> => {
        const camera = cameraStub({ width: 800, height: 600 });
        const harness = await createHarness(fitted(scale), undefined, camera);
        entities.set("crate", entityAt(-1, 0, { half: 0.5 }));
        entities.set("barrel", entityAt(1, 0, { half: 0.5 }));
        const level = document("crate", "barrel");
        await harness.build(level);
        opened(harness.store, level);
        harness.store.dispatch({
          type: "selection-changed",
          ids: ["crate", "barrel"],
        });
        harness.store.dispatch({ type: "tool-changed", tool: "box" });
        harness.store.dispatch({ type: "pivot-changed", pivot: "center" });

        // 24 canvas pixels east of the middle of the canvas, which is where
        // the selection is drawn.
        return (
          harness.coordinator.gizmoAt({
            x: 800 * scale * 0.5 + 24,
            y: 600 * scale * 0.5,
          })?.handle ?? undefined
        );
      };

      expect(await grabbed(1)).toBe("e");
      expect(await grabbed(0.625)).toBe("e");
    });

    it("frames the selection into the canvas, not into the design rectangle", async () => {
      // The two are stubbed apart on purpose: framing fills the pane the
      // developer has, and the design rectangle says nothing about its size.
      const paned = {
        setFit: () => {},
        virtualSize: { width: 800, height: 600 },
        virtualCanvasRect: { x: 0, y: 0, width: 400, height: 300 },
        canvasSize: { width: 400, height: 300 },
      };
      const harness = await createHarness(paned);
      entities.set("crate", entityAt(100, 50, { half: 40, halfY: 10 }));
      await harness.build(document("crate"));

      harness.coordinator.frameSelection(["crate"]);

      const view = harness.store.getState().view;
      expect(view.center).toEqual({ x: 100, y: 50 });
      expect(view.zoom).toBeCloseTo(400 / (80 * 1.2), 12);
    });

    it("takes the harness's mask off its own viewport", async () => {
      // A harness leaves the fit at its `letterbox` default, which masks the
      // level to the design rectangle and centres it. The editor's viewport is
      // not a game window, so it asks for the same transform without the mask
      // against the element it owns.
      const calls: unknown[] = [];
      const parts = createParts({
        ...fitted(1),
        setFit: (options: unknown) => calls.push(options),
      });

      await parts.coordinator.start(parts.harness);

      expect(calls).toEqual([{ mode: "expand", target: parts.host }]);
    });

    it("holds the world at the viewport's top-left when the pane resizes", async () => {
      const camera = cameraStub({ width: 800, height: 600 });
      const surface = { width: 800, height: 600 };
      const harness = await createHarness(
        {
          ...fitted(1),
          // A fresh object each read, the way the renderer answers it.
          get canvasSize() {
            return { ...surface };
          },
        },
        undefined,
        camera,
      );
      // Distinct views, not notifications: a resize also reports the pane's
      // new size, which the view is not written back for.
      const views: EditorViewState[] = [];
      let last = harness.store.getState().view;
      harness.store.subscribe((state) => {
        if (state.view === last) return;
        last = state.view;
        views.push(state.view);
      });

      // A band opening under the picture: 100 pixels of canvas gone from the
      // bottom, and nothing the developer asked for.
      surface.height = 500;
      ResizeObserverStub.last?.deliver();

      expect(harness.store.getState().view.center).toEqual({ x: 0, y: -50 });
      expect(views).toHaveLength(1);
    });

    it("ignores a pane with no room, and does not measure the next one against it", async () => {
      const camera = cameraStub({ width: 800, height: 600 });
      const surface = { width: 800, height: 600 };
      const harness = await createHarness(
        {
          ...fitted(1),
          // A fresh object each read, the way the renderer answers it.
          get canvasSize() {
            return { ...surface };
          },
        },
        undefined,
        camera,
      );

      // A hidden tab measures zero. Moving the view against it would throw the
      // camera across the level, and remembering it would do the same on the
      // way back.
      surface.height = 0;
      ResizeObserverStub.last?.deliver();
      expect(harness.store.getState().view.center).toEqual({ x: 0, y: 0 });

      surface.height = 500;
      ResizeObserverStub.last?.deliver();
      expect(harness.store.getState().view.center).toEqual({ x: 0, y: -50 });
    });

    it("stops watching the pane when the editor closes", async () => {
      const harness = await createHarness(fitted(1));
      const observer = ResizeObserverStub.last;

      await harness.coordinator.dispose();

      expect(observer?.observed).toBe(1);
      expect(observer?.disconnected).toBe(1);
    });

    it("crosses a selected placement whose visual has no area", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(30, -8, { half: 0 }));
      await harness.build(document("crate"));
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      const view = harness.coordinator.overlayView();

      // A zero-area rectangle strokes to nothing, so it marks the way a
      // placement with no visual at all does: by its origin.
      expect(view.boxes).toEqual([]);
      expect(view.origins).toEqual([{ x: 30, y: -8 }]);
    });

    it("crosses a selected placement this build drew nothing for", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityWithoutVisual(30, -8));
      await harness.build(document("crate"));
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      const view = harness.coordinator.overlayView();

      expect(view.boxes).toEqual([]);
      expect(view.origins).toEqual([{ x: 30, y: -8 }]);
    });

    it("puts the gizmo over the level and the guides under it", async () => {
      const layers: { name: string; order: number }[] = [];
      const added: unknown[] = [];
      const layer = {
        container: { addChild: (child: unknown) => added.push(child) },
      };
      const trees = {
        getTree: () => ({
          getAll: () => [{ order: 0 }, { order: 5 }],
          ensureLayer: (def: { name: string; order: number }) => {
            layers.push(def);
            return layer;
          },
        }),
      };

      await createHarness(renderer, trees);

      expect(layers).toEqual([
        { name: OVERLAY_LAYER_NAME, order: OVERLAY_LAYER_ORDER },
        { name: GUIDE_LAYER_NAME, order: GUIDE_LAYER_ORDER },
      ]);
      // Fixed orders rather than ones derived from what exists at boot:
      // `@yagejs/ui` provisions layers at 1,000 and 1,000,000 the first time a
      // placement mounts a surface, long after this ran.
      expect(OVERLAY_LAYER_ORDER).toBeGreaterThan(1_000_000);
      // Under the render tree's own default layer, which is where a placement
      // lands unless the project put it elsewhere.
      expect(GUIDE_LAYER_ORDER).toBeLessThan(0);
      expect(added).toHaveLength(2);
    });

    it("provisions the open level's layers before it builds the placements", async () => {
      const ensured: string[] = [];
      const sorts: (string | undefined)[] = [];
      const sort = (): number => 0;
      const layer = {
        container: { addChild: () => {} },
        sort: undefined as unknown,
        setSort: (next: unknown) => {
          layer.sort = next;
          sorts.push(next === undefined ? undefined : "sorted");
        },
      };
      const trees = {
        getTree: () => ({
          getAll: () => [],
          ensureLayer: (def: LayerDef) => {
            ensured.push(def.name);
            return layer;
          },
        }),
      };

      const harness = await createHarness(renderer, trees);
      ensured.length = 0;
      await harness.build(document("crate"), [
        { name: "bg", order: -10 },
        { name: "canopy", order: 20, sort },
      ]);

      expect(ensured).toEqual(["bg", "canopy"]);
      // A layer that already exists keeps the configuration it was created
      // with, so a declared sort is written afterwards — and only where the
      // declaration and the live layer disagree.
      expect(sorts).toEqual(["sorted"]);
    });

    it("clears a sort the level opened before it declared", async () => {
      const sort = (): number => 0;
      const layers = new Map<
        string,
        {
          container: { addChild: () => void };
          sort: unknown;
          setSort: (next: unknown) => void;
        }
      >();
      const ensure = (name: string) => {
        const existing = layers.get(name);
        if (existing) return existing;
        const layer = {
          container: { addChild: () => {} },
          sort: undefined as unknown,
          setSort: (next: unknown) => {
            layer.sort = next;
          },
        };
        layers.set(name, layer);
        return layer;
      };
      const trees = {
        getTree: () => ({
          getAll: () => [],
          ensureLayer: (def: LayerDef) => ensure(def.name),
          tryGet: (name: string) => layers.get(name),
        }),
      };

      const harness = await createHarness(renderer, trees);
      await harness.build(document("crate"), [
        { name: "default", order: 0, sort },
      ]);
      expect(layers.get("default")?.sort).toBe(sort);

      // The scene outlives the level, so the next level's set has to undo it.
      await harness.build(document("crate"), [{ name: "bg", order: -10 }]);

      expect(layers.get("default")?.sort).toBeUndefined();
    });

    it("draws the overlay every frame once it has a canvas", async () => {
      const drawn: unknown[] = [];
      const overlay = {
        clear: () => overlay,
        moveTo: () => overlay,
        lineTo: () => overlay,
        rect: (...args: number[]) => {
          drawn.push(args);
          return overlay;
        },
        circle: () => overlay,
        stroke: () => overlay,
        fill: () => overlay,
      };
      const trees = {
        getTree: () => ({
          getAll: () => [],
          ensureLayer: () => ({
            // The coordinator makes the `Graphics` itself, so the stub layer
            // swaps in a recorder the moment it is handed one.
            container: {
              addChild: (child: Record<string, unknown>) => {
                Object.assign(child, overlay);
              },
            },
          }),
        }),
      };
      const harness = await createHarness(renderer, trees);
      entities.set("crate", entityAt(0, 0, { half: 10 }));
      const level = document("crate");
      await harness.build(level);
      opened(harness.store, level);
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      harness.tick(1);

      // The selection marker around the placement — twice, since every stroke
      // carries a casing under it — then the translate gizmo's centre square.
      // Nothing draws until the canvas is mounted, so this is the only case
      // that proves the mount is connected to the frame.
      expect(drawn[0]).toEqual([-10, -10, 20, 20]);
      expect(drawn[1]).toEqual([-10, -10, 20, 20]);
      expect(drawn).toHaveLength(3);
    });

    it("lets go of its canvas when the engine is destroyed", async () => {
      const harness = await createHarness(renderer, {
        getTree: () => ({
          getAll: () => [],
          ensureLayer: () => ({ container: { addChild: () => {} } }),
        }),
      });
      await harness.build(document());
      harness.store.dispatch({ type: "selection-changed", ids: [] });

      await harness.coordinator.dispose();

      // The engine took the layer and its children with it, so holding the
      // `Graphics` afterwards would keep a destroyed object reachable.
      harness.tick(1);
      expect(harness.coordinator.overlayView().boxes).toEqual([]);
      expect(hasOverlay(harness.coordinator)).toBe(false);
    });

    it("offers no handle before there is a camera to convert through", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 25 }));
      await harness.build(document("crate"));
      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });

      // `gizmoAt` goes through `screenToWorld`, which no unit test can give a
      // real camera — the same limit `applyView` has. What it composes is
      // covered either side of the conversion: `handleAt` in `gizmo.test.ts`,
      // and the anchor through `overlayView` above. The composition itself is
      // the end-to-end path's.
      expect(harness.coordinator.gizmoAt({ x: ARM_PIXELS, y: 0 })).toBeNull();
    });

    it("offers a gizmo for any selection but an empty one", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 25 }));
      entities.set("barrel", entityAt(80, 0, { half: 25 }));
      const level = document("crate", "barrel");
      await harness.build(level);
      opened(harness.store, level);

      // Read through `overlayView` rather than `gizmoAt`: this harness has no
      // camera, so `gizmoAt` answers null whatever the selection is, and a
      // test asserting that could not fail.
      harness.store.dispatch({ type: "selection-changed", ids: [] });
      expect(harness.coordinator.overlayView().gizmo).toBeUndefined();

      harness.store.dispatch({
        type: "selection-changed",
        ids: ["crate", "barrel"],
      });
      expect(harness.coordinator.overlayView().gizmo).toBeDefined();

      harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
      expect(harness.coordinator.overlayView().gizmo).toBeDefined();
    });

    it("leaves the view alone for an empty selection", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(100, 50, { half: 25 }));
      await harness.build(document("crate"));
      const before = harness.store.getState().view;

      harness.coordinator.frameSelection([]);

      expect(harness.store.getState().view).toBe(before);
    });

    it("leaves the view alone for a placement this build left out", async () => {
      const harness = await createHarness(renderer);
      await harness.build(document("crate"));
      const before = harness.store.getState().view;

      // Nothing was registered for it, so the build drew no entity: framing
      // it would move the view onto empty world.
      harness.coordinator.frameSelection(["crate"]);

      expect(harness.store.getState().view).toBe(before);
    });

    it("frames nothing before the engine has a renderer", async () => {
      const harness = await createHarness();
      entities.set("crate", entityAt(100, 50, { half: 25 }));
      await harness.build(document("crate"));
      const before = harness.store.getState().view;

      harness.coordinator.frameSelection(["crate"]);

      expect(harness.store.getState().view).toBe(before);
    });

    it("covers the whole canvas with the grid and the design size with the box", async () => {
      // A letterboxed canvas: the fit draws the 800-wide virtual viewport into
      // a pane that is wider still, so world the camera can see reaches past
      // the design size. `visibleCanvasRect` is the only rectangle that says
      // so, which is what makes this fail against `virtualCanvasRect`.
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        {
          ...renderer,
          visibleCanvasRect: { x: -100, y: 0, width: 1000, height: 600 },
        },
        undefined,
        camera,
      );

      const view = harness.coordinator.guideView();

      expect(view?.world).toEqual({
        minX: -500,
        minY: -300,
        maxX: 500,
        maxY: 300,
      });
      // The design size, not what the pane happens to show of it: the
      // rectangle says what the project renders.
      expect(view?.viewport).toEqual({ width: 800, height: 600 });
    });

    it("follows the camera, so the grid fills a moved view", async () => {
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        {
          ...renderer,
          visibleCanvasRect: { x: 0, y: 0, width: 800, height: 600 },
        },
        undefined,
        camera,
      );

      // The camera is written by `applyView`, which is what `connectPreview`
      // calls when the store's view changes. The store is moved with it so the
      // spacing is chosen for the same zoom the rectangle was measured at.
      const view = {
        center: { x: 1000, y: 500 },
        zoom: 2,
        guides: true,
        snap: true,
        step: 32,
      };
      harness.store.dispatch({ type: "view-changed", view });
      harness.coordinator.applyView(view);

      expect(harness.coordinator.guideView()?.world).toEqual({
        minX: 800,
        minY: 350,
        maxX: 1200,
        maxY: 650,
      });
    });

    it("shows nothing while the guides are switched off", async () => {
      const camera = cameraStub({ width: 800, height: 600 });
      const harness = await createHarness(
        {
          ...renderer,
          visibleCanvasRect: { x: 0, y: 0, width: 800, height: 600 },
        },
        undefined,
        camera,
      );
      expect(harness.coordinator.guideView()).toBeDefined();

      harness.store.dispatch({ type: "guides-toggled" });

      expect(harness.coordinator.guideView()).toBeUndefined();
    });

    it("draws no guides before there is a camera to convert through", async () => {
      const harness = await createHarness(renderer);

      expect(harness.coordinator.guideView()).toBeUndefined();
    });

    it("writes no command and no document when the guides are switched", async () => {
      const harness = await createHarness(renderer);
      await harness.build(document());
      const before = harness.store.getState().document;

      harness.store.dispatch({ type: "guides-toggled" });

      const state = harness.store.getState();
      expect(state.document).toBe(before);
      expect(state.pending).toEqual([]);
      expect(state.view.guides).toBe(false);
    });

    it("selects what a rectangle covers, and not what it clips", async () => {
      const harness = await createHarness(renderer);
      entities.set("inside", entityAt(0, 0, { half: 10 }));
      entities.set("clipped", entityAt(95, 0, { half: 10 }));
      entities.set("outside", entityAt(400, 0, { half: 10 }));
      await harness.build(document("inside", "clipped", "outside"));

      // `clipped` reaches from 85 to 105, so the rectangle cuts it. Taking it
      // would pick up scenery behind whatever the developer was aiming at.
      expect(
        harness.coordinator.placementsWithin(
          { x: -100, y: -100 },
          { x: 100, y: 100 },
        ),
      ).toEqual(["inside"]);
    });

    it("reads a rectangle dragged in any direction the same way", async () => {
      const harness = await createHarness(renderer);
      entities.set("inside", entityAt(0, 0, { half: 10 }));
      await harness.build(document("inside"));

      expect(
        harness.coordinator.placementsWithin(
          { x: 50, y: 50 },
          { x: -50, y: -50 },
        ),
      ).toEqual(["inside"]);
    });

    it("covers a placement that draws nothing by its position", async () => {
      const harness = await createHarness(renderer);
      entities.set("marker", entityAt(20, 20));
      await harness.build(document("marker"));

      // It draws nothing, so its origin is all there is of it to cover.
      expect(
        harness.coordinator.placementsWithin({ x: 0, y: 0 }, { x: 50, y: 50 }),
      ).toEqual(["marker"]);
      expect(
        harness.coordinator.placementsWithin({ x: 0, y: 0 }, { x: 10, y: 10 }),
      ).toEqual([]);
    });

    it("steps a new placement aside when one is already there", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 10 }));
      await harness.build(document("crate"));

      // Snapping is on, so the step is one visible grid cell: at zoom 1 on an
      // unscaled canvas the default 32-unit lattice is what the grid draws.
      expect(harness.coordinator.freeSpotNear({ x: 0, y: 0 })).toEqual({
        x: 32,
        y: 32,
      });
    });

    it("steps aside from a placement the lattice rounded away from", async () => {
      const harness = await createHarness(renderer);
      // Off the 32-unit lattice: a duplicate of it probes from (0, 32), which
      // is 15 world units away — closer than the sprite is wide.
      entities.set("crate", entityAt(14, 26, { half: 16 }));
      await harness.build(document("crate"));

      expect(harness.coordinator.freeSpotNear({ x: 0, y: 32 })).toEqual({
        x: 32,
        y: 64,
      });
    });

    it("steps by screen pixels when nothing is snapping", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(0, 0, { half: 10 }));
      await harness.build(document("crate"));
      harness.store.dispatch({ type: "snap-toggled" });

      // At zoom 1 on an unscaled canvas a screen pixel is a world unit, so the
      // step is the 24 the cascade is written in.
      expect(harness.coordinator.freeSpotNear({ x: 0, y: 0 })).toEqual({
        x: 24,
        y: 24,
      });
    });

    it("leaves a new placement where it was asked for when nothing is there", async () => {
      const harness = await createHarness(renderer);
      entities.set("crate", entityAt(500, 500, { half: 10 }));
      await harness.build(document("crate"));

      expect(harness.coordinator.freeSpotNear({ x: 0, y: 0 })).toEqual({
        x: 0,
        y: 0,
      });
    });

    it("keeps stepping past a row of placements", async () => {
      const harness = await createHarness(renderer);
      entities.set("first", entityAt(0, 0, { half: 10 }));
      entities.set("second", entityAt(32, 32, { half: 10 }));
      await harness.build(document("first", "second"));

      expect(harness.coordinator.freeSpotNear({ x: 0, y: 0 })).toEqual({
        x: 64,
        y: 64,
      });
    });

    it("writes no camera before there is one", async () => {
      const harness = await createHarness(renderer);

      expect(() => {
        harness.coordinator.applyView({
          center: { x: 5, y: 5 },
          zoom: 2,
          guides: true,
          snap: true,
          step: 32,
        });
      }).not.toThrow();
    });
  });
});

describe("a reference field waiting for a target", () => {
  const renderer = {
    setFit: () => {},
    virtualSize: { width: 800, height: 600 },
    virtualCanvasRect: { x: 0, y: 0, width: 800, height: 600 },
  };

  /** A placement of a named type, optionally authored under another. */
  function typed(id: string, type: string, parent?: string): LevelPlacement {
    return {
      ...placement(id),
      type,
      ...(parent === undefined ? {} : { parent }),
    };
  }

  function waitFor(store: EditorStore, types: readonly string[]): void {
    store.dispatch({
      type: "pick-started",
      pick: { placementId: "switch", field: "door", types },
    });
  }

  /**
   * The coordinator over a level whose entities `place` fills in. The callback
   * runs after the harness is built, which is what clears the entity map.
   */
  async function pointing(
    level: LevelDocument,
    place: () => void,
  ): Promise<{ coordinator: PreviewCoordinator; store: EditorStore }> {
    const harness = await createHarness(
      withPointer(renderer),
      undefined,
      cameraStub({ width: 800, height: 600 }),
    );
    place();
    await harness.build(level);
    opened(harness.store, level);
    return { coordinator: harness.coordinator, store: harness.store };
  }

  it("chooses the placement under the point, and the one above a child", async () => {
    const level = document(
      typed("door", "game.door"),
      typed("handle", "game.handle", "door"),
      typed("switch", "game.switch"),
    );
    const { coordinator, store } = await pointing(level, () => {
      entities.set("door", entityAt(0, 0, { half: 25 }));
      entities.set("handle", entityAt(100, 0, { half: 10 }));
      entities.set("switch", entityAt(-200, 0, { half: 10 }));
    });

    // Nothing is waiting yet, so nothing can be chosen.
    expect(coordinator.pickAt({ x: 400, y: 300 })).toBeNull();

    waitFor(store, ["game.door"]);
    expect(coordinator.pickAt({ x: 400, y: 300 })).toBe("door");
    // The handle is part of the door however the door is built.
    expect(coordinator.pickAt({ x: 500, y: 300 })).toBe("door");
    // The switch is of no accepted type, and empty space is empty space.
    expect(coordinator.pickAt({ x: 200, y: 300 })).toBeNull();
    expect(coordinator.pickAt({ x: 700, y: 500 })).toBeNull();
  });

  it("reaches a target drawn underneath something it cannot choose", async () => {
    const level = document(
      typed("door", "game.door"),
      typed("fog", "game.fog"),
    );
    const { coordinator, store } = await pointing(level, () => {
      entities.set("door", entityAt(0, 0, { half: 25 }));
      // Added later and wide enough to cover the door, so an unfiltered press
      // would land on it.
      entities.set("fog", entityAt(0, 0, { half: 200 }));
    });

    expect(coordinator.hitTest({ x: 400, y: 300 })).toBe("fog");

    waitFor(store, ["game.door"]);
    expect(coordinator.pickAt({ x: 400, y: 300 })).toBe("door");
  });

  it("puts the gizmo away and marks the selection with its own box", async () => {
    const level = document(typed("switch", "game.switch"));
    const { coordinator, store } = await pointing(level, () => {
      entities.set("switch", entityAt(0, 0, { half: 25 }));
    });
    store.dispatch({ type: "selection-changed", ids: ["switch"] });
    store.dispatch({ type: "tool-changed", tool: "box" });

    // The box gizmo outlines the placement in place of its own marker, so the
    // marker has to come back when the gizmo goes.
    expect(coordinator.overlayView().gizmo?.kind).toBe("box");
    expect(coordinator.overlayView().boxes).toHaveLength(0);

    waitFor(store, ["game.door"]);
    const view = coordinator.overlayView();
    expect(view.gizmo).toBeUndefined();
    expect(view.boxes).toHaveLength(1);
  });

  it("draws no marks for a placement no press can choose", async () => {
    const level = document(
      typed("chime", "game.chime"),
      typed("bell", "game.bell"),
    );
    const { coordinator, store } = await pointing(level, () => {
      entities.set("chime", entityCarrying(0, 0, "game.Chime"));
      entities.set("bell", entityCarrying(80, 0, "game.Bell"));
    });

    expect(coordinator.overlayView().marks).toHaveLength(2);

    waitFor(store, ["game.bell"]);
    expect(coordinator.overlayView().marks?.map((mark) => mark.type)).toEqual([
      "game.Bell",
    ]);
  });
});

describe("what the selection points at", () => {
  const renderer = {
    setFit: () => {},
    virtualSize: { width: 800, height: 600 },
    virtualCanvasRect: { x: 0, y: 0, width: 800, height: 600 },
  };

  /** `game.switch` declares one reference parameter; nothing else does. */
  const CATALOG = catalogDeclaring({ "game.switch": ["door"] });

  /** A switch holding the id its `door` parameter names, or nothing. */
  function pointing(id: string, at: string | null): LevelPlacement {
    const one = placement(id);
    return { ...one, type: "game.switch", params: { ...one.params, door: at } };
  }

  /**
   * The coordinator over a level whose entities `place` fills in, with the
   * document in the store: a link is read off the document and drawn between
   * two built entities, so both halves have to be there.
   */
  async function linking(
    level: LevelDocument,
    place: () => void,
  ): Promise<{ coordinator: PreviewCoordinator; store: EditorStore }> {
    const harness = await createHarness(renderer);
    place();
    await harness.build(level, [], CATALOG);
    opened(harness.store, level);
    return { coordinator: harness.coordinator, store: harness.store };
  }

  /** A switch at the origin pointing at a crate 200 units to the right. */
  function pair(): LevelDocument {
    return document(pointing("switch", "crate"), placement("crate"));
  }

  function place(): void {
    entities.set("switch", entityAt(0, 0, { half: 10 }));
    entities.set("crate", entityAt(200, 0, { half: 25 }));
  }

  const BETWEEN = [{ from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }];

  it("draws a line from a selected placement to what it points at", async () => {
    const { coordinator, store } = await linking(pair(), place);
    store.dispatch({ type: "selection-changed", ids: ["switch"] });

    expect(coordinator.overlayView().links).toEqual(BETWEEN);
  });

  it("draws a line into the selection from what points at it", async () => {
    const { coordinator, store } = await linking(pair(), place);
    // Selecting the target answers the other half of the question: what is
    // this connected to includes what reaches it.
    store.dispatch({ type: "selection-changed", ids: ["crate"] });

    expect(coordinator.overlayView().links).toEqual(BETWEEN);
  });

  it("draws one line when both of its ends are selected", async () => {
    const { coordinator, store } = await linking(pair(), place);
    store.dispatch({ type: "selection-changed", ids: ["switch", "crate"] });

    expect(coordinator.overlayView().links).toEqual(BETWEEN);
  });

  it("draws nothing for an id no placement has", async () => {
    const level = document(pointing("switch", "gone"), placement("crate"));
    const { coordinator, store } = await linking(level, place);
    store.dispatch({ type: "selection-changed", ids: ["switch"] });

    // A stale id is reported under the field in the inspector; a line to
    // nowhere cannot be drawn and would say less.
    expect(coordinator.overlayView().links).toEqual([]);
  });

  it("draws nothing for a placement pointing at itself", async () => {
    const level = document(pointing("switch", "switch"), placement("crate"));
    const { coordinator, store } = await linking(level, place);
    store.dispatch({ type: "selection-changed", ids: ["switch"] });

    // Both ends are one point, so there is no line and no direction to head.
    expect(coordinator.overlayView().links).toEqual([]);
  });

  it("draws nothing while nothing is selected", async () => {
    const { coordinator } = await linking(pair(), place);

    expect(coordinator.overlayView().links).toEqual([]);
  });

  it("drops a line to an end the fade took away", async () => {
    const { coordinator, store } = await linking(pair(), place);
    store.dispatch({ type: "selection-changed", ids: ["switch"] });
    store.dispatch({
      type: "pick-started",
      pick: { placementId: "switch", field: "door", types: ["game.crate"] },
    });

    // The crate is a candidate, so it stays lit and the line still reaches it.
    expect(coordinator.overlayView().links).toEqual(BETWEEN);

    store.dispatch({
      type: "pick-started",
      pick: { placementId: "switch", field: "door", types: ["game.door"] },
    });

    expect(coordinator.overlayView().links).toEqual([]);
  });
});

/**
 * An entity drawing one square of `half` units around a world position.
 *
 * The visual is given `VisualComponent`'s prototype rather than constructed:
 * a real one builds a Pixi object, and what the bounds walk needs from it is
 * the `instanceof` test, one rectangle, the pivot the bounds walk subtracts,
 * and the fields the dormant pass writes each frame.
 */
/** Whether the coordinator is still holding a canvas to draw the overlay on. */
function hasOverlay(coordinator: PreviewCoordinator): boolean {
  return (coordinator as unknown as { overlay: unknown }).overlay !== undefined;
}

/** A placement the build produced but that draws nothing. */
function entityWithoutVisual(x: number, y: number): unknown {
  const transform = new Transform({ position: new Vec2(x, y) });
  return {
    get: () => transform,
    getAll: () => [transform],
    parent: null,
  };
}

/**
 * An entity carrying components the preview draws nothing for, named the way
 * the engine's own invisible components are.
 *
 * A class expression under a computed key takes the key as its name, which is
 * what the marks read.
 */
function entityCarrying(x: number, y: number, ...types: string[]): unknown {
  const transform = new Transform({ position: new Vec2(x, y) });
  const carried = types.map((type) => {
    const Made = { [type]: class extends Component {} }[type];
    if (!Made) throw new Error(`no class for ${type}`);
    return new Made();
  });
  return {
    get: () => transform,
    getAll: () => [transform, ...carried],
    parent: null,
  };
}

/** An entity at a point. With no options it draws nothing at all. */
function entityAt(
  x: number,
  y: number,
  options?: {
    half: number;
    halfY?: number;
    rotation?: number;
    /** The placement's own scale, for a case about a scale of zero. */
    scale?: { x: number; y: number };
    /** Draw the rectangle out from the origin, the way an unanchored sprite does. */
    fromOrigin?: boolean;
  },
): unknown {
  const transform = new Transform({
    position: new Vec2(x, y),
    ...(options?.rotation === undefined ? {} : { rotation: options.rotation }),
    ...(options?.scale === undefined
      ? {}
      : { scale: new Vec2(options.scale.x, options.scale.y) }),
  });
  if (!options) {
    return { get: () => transform, getAll: () => [transform], parent: null };
  }
  const halfY = options.halfY ?? options.half;
  const corner = options.fromOrigin
    ? { x: 0, y: 0 }
    : { x: -options.half, y: -halfY };
  const visual = {
    renderObject: {
      getLocalBounds: () => ({
        x: corner.x,
        y: corner.y,
        width: options.half * 2,
        height: halfY * 2,
      }),
      pivot: { x: 0, y: 0 },
      // The render-phase dormant pass writes these every frame, so a case
      // that ticks the systems needs them present.
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      visible: true,
    },
    // The pass reads both off the component before it writes a visibility.
    // They are own properties, set before the prototype is, so they stand in
    // for the accessors a real component has.
    enabled: true,
    visible: true,
  };
  Object.setPrototypeOf(visual, VisualComponent.prototype);
  return {
    get: () => transform,
    getAll: () => [transform, visual],
    parent: null,
  };
}

describe("placements put out of the way", () => {
  const renderer = {
    setFit: () => {},
    virtualSize: { width: 800, height: 600 },
    virtualCanvasRect: { x: 0, y: 0, width: 800, height: 600 },
    canvasSize: { width: 800, height: 600 },
  };

  /** A placement of the default type, optionally authored under another. */
  function under(id: string, parent?: string): LevelPlacement {
    return {
      ...placement(id),
      ...(parent === undefined ? {} : { parent }),
    };
  }

  function hide(store: EditorStore, ...ids: string[]): void {
    store.dispatch({ type: "hidden-toggled", ids });
  }

  it("draws nothing for a hidden placement or anything under it", async () => {
    const harness = await createHarness(renderer);
    const parent = entityAt(0, 0, { half: 25 });
    const child = entityAt(80, 0, { half: 25 });
    entities.set("parent", parent);
    entities.set("child", child);
    const level = document(under("parent"), under("child", "parent"));
    await harness.build(level);
    opened(harness.store, level);

    harness.tick(1);
    expect(visibilityOf(child)).toBe(true);

    // The child's own id is not in the store's set: the closure is what the
    // dormant pass is handed, so hiding a parent takes its children with it.
    hide(harness.store, "parent");
    harness.tick(1);
    expect(visibilityOf(parent)).toBe(false);
    expect(visibilityOf(child)).toBe(false);

    hide(harness.store, "parent");
    harness.tick(1);
    expect(visibilityOf(child)).toBe(true);
  });

  it("lets a press reach what a hidden placement was covering", async () => {
    const harness = await createHarness(
      withPointer(renderer),
      undefined,
      cameraStub({ width: 800, height: 600 }),
    );
    entities.set("floor", entityAt(0, 0, { half: 200 }));
    entities.set("crate", entityAt(0, 0, { half: 25 }));
    const level = document("floor", "crate");
    await harness.build(level);
    opened(harness.store, level);

    expect(harness.coordinator.hitTest({ x: 400, y: 300 })).toBe("crate");

    hide(harness.store, "crate");
    expect(harness.coordinator.hitTest({ x: 400, y: 300 })).toBe("floor");
  });

  it("lets a press through the mark of a hidden placement", async () => {
    // A placement that draws nothing is pressed through its mark, and the mark
    // is tested before the artwork; hidden, it must give way like the artwork.
    const harness = await createHarness(
      withPointer(renderer),
      undefined,
      cameraStub({ width: 800, height: 600 }),
    );
    entities.set("floor", entityAt(0, 0, { half: 200 }));
    entities.set("beacon", entityCarrying(0, 0, "LightSource"));
    const level = document("floor", "beacon");
    await harness.build(level);
    opened(harness.store, level);
    const onMark = { x: 400, y: 300 - MARK_OFFSET_PIXELS };

    expect(harness.coordinator.hitTest(onMark)).toBe("beacon");

    hide(harness.store, "beacon");
    expect(harness.coordinator.hitTest(onMark)).toBe("floor");
  });

  it("keeps a reference line whose hidden end is the selected one", async () => {
    const harness = await createHarness(renderer);
    entities.set("switch", entityCarrying(0, 0, "game.Switch"));
    entities.set("crate", entityCarrying(80, 0, "game.Crate"));
    const level = document(
      {
        ...placement("switch"),
        type: "game.switch",
        params: { door: "crate" },
      },
      under("crate"),
    );
    await harness.build(
      level,
      [],
      catalogDeclaring({ "game.switch": ["door"] }),
    );
    opened(harness.store, level);
    harness.store.dispatch({ type: "selection-changed", ids: ["switch"] });

    // The selection's own marker still shows where the switch is, so the line
    // from it still has a first point to draw from.
    hide(harness.store, "switch");
    expect(harness.coordinator.overlayView().links).toHaveLength(1);
  });

  it("leaves a hidden placement out of a marquee", async () => {
    const harness = await createHarness(renderer);
    entities.set("crate", entityAt(0, 0, { half: 10 }));
    entities.set("barrel", entityAt(40, 0, { half: 10 }));
    const level = document("crate", "barrel");
    await harness.build(level);
    opened(harness.store, level);

    hide(harness.store, "crate");

    expect(
      harness.coordinator.placementsWithin(
        { x: -100, y: -100 },
        { x: 100, y: 100 },
      ),
    ).toEqual(["barrel"]);
  });

  it("frames what is left of the selection, and nothing when none is", async () => {
    const harness = await createHarness(renderer);
    entities.set("crate", entityAt(100, 50, { half: 40, halfY: 10 }));
    entities.set("barrel", entityAt(-400, 0, { half: 10 }));
    const level = document("crate", "barrel");
    await harness.build(level);
    opened(harness.store, level);

    hide(harness.store, "barrel");
    harness.coordinator.frameSelection(["crate", "barrel"]);

    // The barrel is 400 units away: framing both would put the view between
    // them, on nothing the developer can see.
    expect(harness.store.getState().view.center).toEqual({ x: 100, y: 50 });

    const framed = harness.store.getState().view;
    harness.coordinator.frameSelection(["barrel"]);
    expect(harness.store.getState().view).toBe(framed);
  });

  it("draws no marks and no reference lines for a hidden placement", async () => {
    const harness = await createHarness(renderer);
    entities.set("switch", entityCarrying(0, 0, "game.Switch"));
    entities.set("crate", entityCarrying(80, 0, "game.Crate"));
    const level = document(
      {
        ...placement("switch"),
        type: "game.switch",
        params: { door: "crate" },
      },
      under("crate"),
    );
    await harness.build(
      level,
      [],
      catalogDeclaring({ "game.switch": ["door"] }),
    );
    opened(harness.store, level);
    harness.store.dispatch({ type: "selection-changed", ids: ["switch"] });

    expect(harness.coordinator.overlayView().marks).toHaveLength(2);
    expect(harness.coordinator.overlayView().links).toHaveLength(1);

    hide(harness.store, "crate");
    const view = harness.coordinator.overlayView();
    expect(view.marks?.map((mark) => mark.type)).toEqual(["game.Switch"]);
    expect(view.links).toEqual([]);
  });

  it("never offers a hidden placement as a reference target", async () => {
    const harness = await createHarness(
      withPointer(renderer),
      undefined,
      cameraStub({ width: 800, height: 600 }),
    );
    entities.set("crate", entityAt(0, 0, { half: 25 }));
    const level = document(
      { ...placement("switch"), type: "game.switch" },
      under("crate"),
    );
    await harness.build(level);
    opened(harness.store, level);
    harness.store.dispatch({
      type: "pick-started",
      pick: { placementId: "switch", field: "door", types: ["game.crate"] },
    });

    expect(harness.coordinator.pickAt({ x: 400, y: 300 })).toBe("crate");

    hide(harness.store, "crate");
    expect(harness.coordinator.pickAt({ x: 400, y: 300 })).toBeNull();
  });

  it("still draws the editor's own marker over a hidden selection", async () => {
    const harness = await createHarness(renderer);
    entities.set("crate", entityAt(0, 0, { half: 10 }));
    const level = document("crate");
    await harness.build(level);
    opened(harness.store, level);
    harness.store.dispatch({ type: "selection-changed", ids: ["crate"] });
    harness.store.dispatch({ type: "tool-changed", tool: "select" });

    hide(harness.store, "crate");

    // The box and the origin crosshair are not part of the placement's
    // picture: they are what says where the thing you hid is.
    const view = harness.coordinator.overlayView();
    expect(view.boxes).toHaveLength(1);
    expect(view.origins).toEqual([{ x: 0, y: 0 }]);
  });
});

/** What the dormant pass last wrote onto an entity stub's only visual. */
function visibilityOf(entity: unknown): unknown {
  const visual = (
    entity as { getAll(): { renderObject?: { visible: boolean } }[] }
  )
    .getAll()
    .find((component) => component.renderObject !== undefined);
  return visual?.renderObject?.visible;
}

describe("a parameter you can drag", () => {
  const renderer = {
    setFit: () => {},
    virtualSize: { width: 800, height: 600 },
    virtualCanvasRect: { x: 0, y: 0, width: 800, height: 600 },
  };

  /** `game.slime` declares one relative point and one world point. */
  const CATALOG = catalogWithPoints({
    "game.slime": [
      ["patrolEnd", true],
      ["home", false],
    ],
  });

  /** A slime with both points authored, at a transform of the caller's choice. */
  function slime(
    id: string,
    transform: LevelTransform = poseAt(0, 0),
  ): LevelPlacement {
    return {
      ...placement(id),
      type: "game.slime",
      transform,
      // The texture is what the stand-in preparation projects a placement by.
      params: {
        texture: `${id}.png`,
        patrolEnd: { x: 120, y: 0 },
        home: { x: -80, y: 40 },
      },
    };
  }

  /**
   * The coordinator over a level holding one slime, with the document in the
   * store: a handle is read off the document and the catalog, and the
   * placement has to be built for the level to project.
   */
  async function dragging(
    level: LevelDocument,
    camera?: unknown,
  ): Promise<{ coordinator: PreviewCoordinator; store: EditorStore }> {
    const harness = await createHarness(
      camera ? withPointer(renderer) : renderer,
      undefined,
      camera,
    );
    for (const one of level.entities) {
      entities.set(one.id, entityAt(0, 0, { half: 10 }));
    }
    await harness.build(level, [], CATALOG);
    opened(harness.store, level);
    // Off unless a case asks for it, so a handle lands where the pointer left
    // it rather than where a lattice rounded it.
    harness.store.dispatch({ type: "snap-toggled" });
    return { coordinator: harness.coordinator, store: harness.store };
  }

  it("puts a relative handle through the placement's own frame", async () => {
    const level = document(
      slime("s1", {
        position: { x: 50, y: 20 },
        rotation: 0,
        scale: { x: 2, y: 1 },
      }),
    );
    const { coordinator, store } = await dragging(level);
    store.dispatch({ type: "selection-changed", ids: ["s1"] });

    // 120 along the placement's own x, doubled by its scale, from (50, 20).
    expect(coordinator.overlayView().handles).toEqual([
      {
        kind: "point",
        id: "s1",
        field: "patrolEnd",
        at: { x: 290, y: 20 },
        from: { x: 50, y: 20 },
      },
      { kind: "point", id: "s1", field: "home", at: { x: -80, y: 40 } },
    ]);
  });

  it("draws no handle for a placement that is not selected", async () => {
    const { coordinator } = await dragging(document(slime("s1")));

    expect(coordinator.overlayView().handles).toEqual([]);
  });

  it("draws no handle for several placements at once", async () => {
    const level = document(slime("s1"), slime("s2"));
    const { coordinator, store } = await dragging(level);
    store.dispatch({ type: "selection-changed", ids: ["s1", "s2"] });

    // A handle names a field of one placement, and two selected placements
    // have no one field between them.
    expect(coordinator.overlayView().handles).toEqual([]);
  });

  it("grabs the handle rather than the gizmo's centre", async () => {
    // The relative point is authored at the origin, which is exactly where the
    // translate gizmo's centre grip sits.
    const level = document({
      ...slime("s1"),
      params: {
        texture: "s1.png",
        patrolEnd: { x: 0, y: 0 },
        home: { x: -80, y: 40 },
      },
    });
    const camera = cameraStub({ width: 800, height: 600 });
    const { coordinator, store } = await dragging(level, camera);
    store.dispatch({ type: "selection-changed", ids: ["s1"] });
    store.dispatch({ type: "tool-changed", tool: "translate" });

    expect(coordinator.gizmoAt({ x: 400, y: 300 })?.handle).toBe("xy");
    expect(coordinator.paramHandleAt({ x: 400, y: 300 })).toEqual({
      id: "s1",
      field: "patrolEnd",
      grip: "body",
    });
  });

  it("draws the handle where a drag has taken it", async () => {
    const level = document(slime("s1"));
    const { coordinator, store } = await dragging(level);
    store.dispatch({ type: "selection-changed", ids: ["s1"] });
    store.dispatch({
      type: "param-drag-started",
      drag: {
        id: "s1",
        field: "patrolEnd",
        kind: "point",
        grip: "body",
        relative: true,
        from: { x: 120, y: 0 },
        origin: { x: 120, y: 0 },
        current: { x: 120, y: 0 },
        constrained: false,
        suspended: false,
      },
    });
    store.dispatch({
      type: "param-drag-moved",
      current: { x: 150, y: 30 },
      constrained: false,
      suspended: false,
    });

    expect(coordinator.overlayView().handles?.[0]?.at).toEqual({
      x: 150,
      y: 30,
    });
  });
});

describe("scheduleRelease", () => {
  it("releases nothing in the frame the build finished in", () => {
    const flushes = new DestroyFlushQueue();
    const lease = createLease();
    scheduleRelease(flushes, lease, 1, () => 1);

    // The build's `entity.destroy()` calls are queued and flush at the end of
    // this frame, so its render objects are still parented and still drawn.
    flushes.update();

    expect(lease.calls).toBe(0);
  });

  it("releases once that frame's destroys have been flushed", () => {
    const flushes = new DestroyFlushQueue();
    const lease = createLease();
    scheduleRelease(flushes, lease, 1, () => 1);

    flushes.update();
    flushes.update();

    expect(lease.calls).toBe(1);
  });

  it("skips a release a newer build has overtaken", () => {
    const flushes = new DestroyFlushQueue();
    const lease = createLease();
    let revision = 1;
    scheduleRelease(flushes, lease, 1, () => revision);

    // Build 2 runs before build 1's release comes due. It tore build 1's
    // entities down, and those are parented until the end of the frame that
    // runs next — so build 1's release would drop what they draw with. The
    // lease keeps what build 2 acquired, which is why the stale release is
    // dangerous rather than merely pointless.
    revision = 2;
    flushes.update();
    flushes.update();

    expect(lease.calls).toBe(0);
  });

  it("lets the newest build's own release through", () => {
    const flushes = new DestroyFlushQueue();
    const lease = createLease();
    let revision = 1;
    scheduleRelease(flushes, lease, 1, () => revision);
    revision = 2;
    scheduleRelease(flushes, lease, 2, () => revision);

    flushes.update();
    flushes.update();
    flushes.update();

    // Exactly one: the overtaken build's release is skipped and the newest
    // one keeps the same set, so nothing is left held.
    expect(lease.calls).toBe(1);
  });
});

/** The arms gizmo, or undefined when the overlay is showing something else. */
function armsOf(
  gizmo: OverlayGizmo | undefined,
): Extract<OverlayGizmo, { kind: "arms" }> | undefined {
  return gizmo?.kind === "arms" ? gizmo : undefined;
}

function boxOf(gizmo: OverlayGizmo | undefined): OrientedBox | undefined {
  return gizmo?.kind === "box" ? gizmo.box : undefined;
}

function gripsOf(gizmo: OverlayGizmo | undefined): readonly HandleId[] {
  return gizmo?.kind === "box" ? gizmo.grips : [];
}

/**
 * A gesture in progress. The fields these cases do not read carry what a
 * press that has not moved yet holds.
 */
function gestureOf(parts: {
  readonly kind: GizmoMode;
  readonly ids: readonly string[];
  readonly handle?: HandleId;
  readonly anchor?: GizmoAnchor;
  readonly pivot?: EditorPoint;
}): EditGesture {
  return {
    kind: parts.kind,
    ids: parts.ids,
    ...(parts.handle === undefined ? {} : { handle: parts.handle }),
    ...(parts.anchor === undefined ? {} : { anchor: parts.anchor }),
    ...(parts.pivot === undefined ? {} : { pivot: parts.pivot }),
    spin: 0,
    reference: { x: 1, y: 1, kind: "length" },
    constrained: false,
    suspended: false,
    snapFrom: parts.anchor ?? { position: { x: 0, y: 0 }, rotation: 0 },
    origin: { x: 0, y: 0 },
    current: { x: 0, y: 0 },
    base: new Map(),
  };
}

/** The transform a drag's redraw writes: a point, and nothing else changed. */
function poseAt(x: number, y: number, rotation = 0): LevelTransform {
  return { position: { x, y }, rotation, scale: { x: 1, y: 1 } };
}
