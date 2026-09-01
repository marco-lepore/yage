import {
  Component,
  Transform,
  Vec2,
  type AssetHandle,
  type AssetManager,
  type Engine,
  type System,
} from "@yagejs/core";
import type { LevelCatalog, LevelInstance, PreparedLevel } from "@yagejs/level";
import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { SceneRenderTreeProviderKey, VisualComponent } from "@yagejs/renderer";
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
import { DEFAULT_VIEW, EditorStore, type HandleId } from "../store/index.js";
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
  const coordinator = new PreviewCoordinator({
    host: { appendChild: () => {} } as unknown as HTMLElement,
    store,
  });

  return {
    coordinator,
    store,
    harness: { engine: () => engine, plugins: () => [] },
    systems,
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
  build(document: LevelDocument): Promise<void>;
  tick(frames: number): void;
}> {
  const parts = createParts(renderer, trees, camera);
  await parts.coordinator.start(parts.harness);

  return {
    coordinator: parts.coordinator,
    store: parts.store,
    events,
    async build(document: LevelDocument): Promise<void> {
      parts.coordinator.requestRebuild({
        document,
        catalog: {} as LevelCatalog,
      });
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
      catalog: {} as LevelCatalog,
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
     * A renderer reduced to what framing and the overlay read: the virtual
     * size, and where that rectangle lands on the canvas. Here they are the
     * same, so one virtual pixel is one screen pixel.
     */
    const renderer = {
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

    it("holds the drawn pivot still while a gesture runs", async () => {
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
        gesture: {
          kind: "rotate",
          anchor: { position: elsewhere, rotation: 0 },
          pivot: elsewhere,
          spin: 0,
          reference: { x: 1, y: 1, kind: "length" },
          constrained: false,
          suspended: false,
          snapFrom: { position: elsewhere, rotation: 0 },
          ids: ["crate", "lid"],
          origin: { x: 0, y: 0 },
          current: { x: 0, y: 0 },
          base: new Map(),
        },
      });

      expect(
        armsOf(harness.coordinator.overlayView().gizmo)?.anchor.position,
      ).toEqual(elsewhere);
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

    it("sizes the overlay from the canvas scale as well as the zoom", async () => {
      // A fit drawing an 800-wide virtual viewport into a 500-wide pane. Every
      // gizmo size is a screen-pixel count, so it has to grow in world units by
      // as much as the canvas shrank, or the handles shrink with the pane.
      const scaled = {
        virtualSize: { width: 800, height: 600 },
        virtualCanvasRect: { x: 0, y: 0, width: 500, height: 375 },
      };
      const harness = await createHarness(scaled);
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

      expect(harness.coordinator.overlayView().perScreenPixel).toBeCloseTo(
        0.25 / (500 / 800),
        12,
      );
    });

    it("takes the tighter axis when a fit scales them differently", async () => {
      // Under `stretch` the two axes scale apart. Taking the smaller keeps a
      // handle at least its nominal size on both rather than on neither.
      const stretched = {
        virtualSize: { width: 800, height: 600 },
        virtualCanvasRect: { x: 0, y: 0, width: 800, height: 300 },
      };
      const harness = await createHarness(stretched);
      await harness.build(document());

      expect(harness.coordinator.overlayView().perScreenPixel).toBeCloseTo(
        1 / (300 / 600),
        12,
      );
    });

    it("falls back to one while the canvas has no room", async () => {
      // A pane with no width yet measures zero, and dividing by it would make
      // every point in the world one screen pixel from a handle.
      const unlaid = {
        virtualSize: { width: 800, height: 600 },
        virtualCanvasRect: { x: 0, y: 0, width: 0, height: 0 },
      };
      const harness = await createHarness(unlaid);
      await harness.build(document());

      expect(harness.coordinator.overlayView().perScreenPixel).toBe(1);
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
  };
  Object.setPrototypeOf(visual, VisualComponent.prototype);
  return {
    get: () => transform,
    getAll: () => [transform, visual],
    parent: null,
  };
}

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
