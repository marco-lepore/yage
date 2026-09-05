import {
  AssetManagerKey,
  Transform,
  Vec2,
  type Engine,
  type Entity,
  type Plugin,
} from "@yagejs/core";
import {
  instantiateLevel,
  levelAssets,
  LevelLoadError,
  prepareLevel,
  type LevelCatalog,
  type LevelDiagnostic,
  type LevelInstance,
  type PreparedLevel,
} from "@yagejs/level";
import type { LevelDocument, LevelPlacement } from "@yagejs/level/document";
import { Graphics } from "pixi.js";
import { RendererKey, SceneRenderTreeProviderKey } from "@yagejs/renderer";
import type { LayerDef, RendererPlugin } from "@yagejs/renderer";
import type { PoseEdit } from "../../shared/commands/index.js";
import type { EditorDiagnostic } from "../../shared/diagnostics/index.js";
import type {
  EditorPoint,
  EditorState,
  EditorStore,
  EditorViewState,
  GizmoAnchor,
  GizmoMode,
  GizmoReference,
  HandleId,
  ParamDrag,
  PivotMode,
} from "../store/index.js";
import { viewAfterResize } from "../store/index.js";
import { PreviewAssetLease, placementsMissingAssets } from "./assets.js";
import {
  draggedValue,
  hiddenClosure,
  parentWorld,
  pointFields,
  pointHandles,
  referenceFieldNames,
  referenceTargets,
  referenceUses,
  selectionRoots,
  type PointField,
  type ReferenceUse,
  withDescendants,
} from "../commands/index.js";
import { armLength, handleAt, handleDirection, nearGizmo } from "./gizmo.js";
import { nearRadial, radialHandleAt } from "./radial.js";
import {
  SUBSTITUTE_BOX,
  boxAround,
  boxHandleAt,
  boxHandleDirection,
  boxReferences,
  coveringBox,
  inflated,
  nearBox,
  orientedBoxOf,
  type OrientedBox,
  type UnscaledSides,
} from "./box.js";
import {
  drawOverlay,
  paramHandleAt,
  type OverlayGizmo,
  type OverlayLink,
  type OverlayMarks,
  type OverlayView,
  type ParamHandle,
} from "./overlay.js";
import {
  marksOf,
  placedMarks,
  pressesMark,
  type ComponentMark,
  type PlacedMark,
} from "./marks.js";
import { drawGuides, gridSteps, type GuideView } from "./guides.js";
import {
  containsPoint,
  framedView,
  localBoxOf,
  unionBounds,
  worldBoundsOf,
  type WorldBounds,
} from "./bounds.js";
import { DestroyFlushQueue } from "./DestroyFlushQueue.js";
import type { DormantPlacement } from "./dormant.js";
import {
  EditPreviewScene,
  EditorPreviewPlugin,
  GUIDE_LAYER_NAME,
  GUIDE_LAYER_ORDER,
  OVERLAY_LAYER_NAME,
  OVERLAY_LAYER_ORDER,
} from "./EditPreviewScene.js";
import { buildBestEffort, type ProjectionOutcome } from "./projection.js";
import { RebuildQueue } from "./RebuildQueue.js";

/**
 * The project's engine and plugin factory, in the shape a lab harness has, so
 * a project that already has `lab/harness.ts` edits against the same engine
 * its scenarios run in.
 */
export interface EditorHarness {
  engine(): Engine;
  plugins(context: { container: HTMLElement }): Plugin[];
}

/**
 * A project's harness default export, checked. `undefined` when it is not one,
 * so each caller can say in its own words what it wanted it for.
 */
export function asHarness(value: unknown): EditorHarness | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<EditorHarness>;
  return typeof candidate.engine === "function" &&
    typeof candidate.plugins === "function"
    ? (candidate as EditorHarness)
    : undefined;
}

/** One document to project, and the catalog it means something against. */
export interface PreviewRequest {
  readonly document: LevelDocument;
  readonly catalog: LevelCatalog;
  /**
   * The layers the open level is authored against. Provisioned before the
   * placements are built, so a visual naming one lands there rather than
   * falling back to `default` and flattening the level.
   */
  readonly layers: readonly LayerDef[];
}

export interface PreviewCoordinatorOptions {
  /** The element the renderer mounts into. The shell places it; this owns it. */
  readonly host: HTMLElement;
  readonly store: EditorStore;
}

/**
 * The only owner of the YAGE engine.
 *
 * It boots the project's own harness, builds a best-effort projection of the
 * document being edited, and moves placements while a drag is running. What it
 * draws is inactive: no game logic runs in the editor, so nothing the preview
 * shows can change the document behind the developer's back. Failures become
 * diagnostics in the store rather than exceptions, because a document being
 * edited is broken most of the time.
 */
export class PreviewCoordinator {
  private readonly host: HTMLElement;
  private readonly store: EditorStore;
  private readonly queue = new RebuildQueue();
  private engine: Engine | undefined;
  private scene: EditPreviewScene | undefined;
  private lease: PreviewAssetLease | undefined;
  private instance: LevelInstance | undefined;
  private placements: readonly DormantPlacement[] = [];
  private byPlacementId = new Map<string, Entity>();
  /**
   * The placements carrying a component the preview draws nothing for, in
   * document order.
   *
   * Read once per build rather than once per frame: an entity's components are
   * fixed for the life of a projection, and the overlay redraws every frame.
   */
  private marked: readonly MarkedPlacement[] = [];
  /**
   * Every reference the open document holds, in document order.
   *
   * Read from the document and the catalog once per build, like the marks: a
   * reference changes only when one of those does, and the overlay asks which
   * of them touch the selection every frame.
   */
  private links: readonly ReferenceUse[] = [];
  /**
   * The place-valued parameters each placed type declares, by type id.
   *
   * Read from the catalog once per build, like the references: a declaration
   * changes only when the catalog does, and the overlay asks what the
   * selection holds every frame.
   */
  private pointFieldsByType: ReadonlyMap<string, readonly PointField[]> =
    new Map();
  private overlay: Graphics | undefined;
  private guides: Graphics | undefined;
  /**
   * The layers this coordinator gave a `sort` to for the level that is open.
   *
   * The scene outlives every level opened in it, so a sort written for one
   * level's set has to be cleared when the next level's set does not declare
   * it.
   */
  private provisionedSorts: ReadonlySet<string> = new Set();
  private readonly flushes = new DestroyFlushQueue();
  /** Rises on every request, and names the namespace each build's keys take. */
  private revision = 0;
  /**
   * A build asked for before the engine was up, kept for `start()` to run.
   *
   * The shell renders and the picker is live while `start()` boots the
   * renderer, so a level opened inside that window asks for a projection when
   * there is no scene to put one in. Held rather than dropped: nothing asks
   * again on its own, and the developer would be left naming a level over an
   * empty viewport.
   */
  private held: PreviewRequest | undefined;
  /**
   * The canvas size the view was last measured against, or nothing while the
   * canvas has no room to be measured in.
   */
  private canvas: CanvasSize | undefined;
  private resize: ResizeObserver | undefined;

  constructor(options: PreviewCoordinatorOptions) {
    this.host = options.host;
    this.store = options.store;
  }

  /** Boot the project's engine with the editor's own render pass added. */
  async start(harness: EditorHarness): Promise<void> {
    const engine = harness.engine();
    for (const plugin of harness.plugins({ container: this.host })) {
      engine.use(plugin);
    }
    engine.use(
      new EditorPreviewPlugin(
        () => this.placements,
        () => this.dimmed(),
        () => this.hiddenClosed(),
        this.flushes,
        () => {
          this.draw();
        },
      ),
    );
    await engine.start();

    // The editor's viewport is not a game window. A harness leaves the fit at
    // its `letterbox` default, which centres the level inside the canvas and
    // masks everything outside the design rectangle — so a band opening under
    // the canvas rescales the picture or slides it, and the grid stops at an
    // invisible edge. `expand` is the same transform without the mask; the
    // scale it applies is taken back out in `applyView`, which leaves
    // `view.zoom` the only thing deciding how large the level is drawn. The
    // target is passed rather than left to the renderer's fallback, because a
    // harness may build its renderer around a canvas of its own.
    const renderer = engine.context.tryResolve(RendererKey);
    renderer?.setFit({ mode: "expand", target: this.host });

    const scene = new EditPreviewScene();
    await engine.scenes.push(scene);
    this.engine = engine;
    this.scene = scene;
    this.overlay = this.mountLayer(
      engine,
      scene,
      OVERLAY_LAYER_NAME,
      OVERLAY_LAYER_ORDER,
    );
    this.guides = this.mountLayer(
      engine,
      scene,
      GUIDE_LAYER_NAME,
      GUIDE_LAYER_ORDER,
    );
    this.lease = new PreviewAssetLease(engine.context.resolve(AssetManagerKey));

    const held = this.held;
    this.held = undefined;
    if (held) this.requestRebuild(held);
    // The camera is set from the store rather than from a second held value:
    // the store is where the current view is, whether it moved during the boot
    // or not.
    this.applyView(this.store.getState().view);

    // Constructed after `engine.start()` returned, so the renderer's own fit
    // observer — which watches the same element — is delivered first within a
    // cycle and the sizes read below are already the new ones.
    this.canvas = measured(renderer);
    this.reportViewport(renderer);
    this.resize = new ResizeObserver(() => {
      this.hostResized();
    });
    this.resize.observe(this.host);
  }

  /**
   * Tell the store how large the pane and the game's own picture are, which is
   * what a level with nothing remembered for it opens zoomed to.
   */
  private reportViewport(renderer: RendererPlugin | undefined): void {
    const pane = measured(renderer);
    if (!pane || !renderer) return;
    this.store.dispatch({
      type: "viewport-measured",
      viewport: { pane, design: renderer.virtualSize },
    });
  }

  /**
   * Hold the world under the viewport's top-left corner where it is, whatever
   * the pane's new size.
   *
   * A panel opening under the canvas is not a request to look somewhere else,
   * so what changes is how much of the level is on screen and never how large
   * it is drawn or where it sits under the pointer.
   */
  private hostResized(): void {
    const renderer = this.engine?.context.tryResolve(RendererKey);
    const to = measured(renderer);
    // A pane collapsed to nothing, or a hidden tab, measures zero. Neither is
    // a size the view should be moved against, and neither may become the
    // size the next real one is compared with.
    if (!to) return;
    const from = this.canvas;
    this.canvas = to;
    const before = this.store.getState().view;
    this.reportViewport(renderer);
    const view = this.store.getState().view;
    // The measurement framed an opening view to the pane it now has, which is
    // already the answer for this size. Shifting it as well would move it
    // twice; the redraw comes from the view the store just changed.
    if (view !== before) return;
    const next = from ? viewAfterResize(view, from, to) : view;
    // The fit's scale may have changed even where the view did not, so the
    // camera is written either way — through the store when the view moved, so
    // the persisted view and the camera never disagree.
    if (next === view) this.applyView(view);
    else this.store.dispatch({ type: "view-changed", view: next });
  }

  /**
   * Project a document. The newest request wins: rebuilding takes longer than
   * a developer takes to ask again, and an older build finishing last would
   * leave the preview showing a document nobody is editing.
   */
  requestRebuild(request: PreviewRequest): void {
    if (!this.scene || !this.lease) {
      this.held = request;
      return;
    }
    void this.queue
      .schedule(() => this.rebuild(request))
      .catch((error: unknown) => {
        // A failure the projection could not pin on one placement — the scene,
        // the engine, or the batch itself. Without this it would be an unhandled
        // rejection and the viewport would go quiet with nothing to read.
        this.store.dispatch({
          type: "diagnostics-replaced",
          source: "preview",
          diagnostics: [
            {
              code: "preview-failed",
              severity: "error",
              source: "preview",
              message: `The preview could not be built: ${describe(error)}`,
              revision: this.revision,
            },
          ],
        });
      });
  }

  /**
   * Move placements without rebuilding. A drag calls this on every pointer
   * move, and the render pass picks the new pose up on the next frame.
   */
  applyPoseDraft(poses: readonly PoseEdit[]): void {
    for (const pose of poses) {
      const entity = this.byPlacementId.get(pose.id);
      if (!entity) continue;
      const transform = entity.get(Transform);
      transform.position = new Vec2(
        pose.transform.position.x,
        pose.transform.position.y,
      );
      transform.rotation = pose.transform.rotation;
      transform.scale = new Vec2(
        pose.transform.scale.x,
        pose.transform.scale.y,
      );
    }
  }

  /**
   * Where a point on the canvas is in the world.
   *
   * The editor camera is preview-owned, so this is the one place that knows
   * the conversion. A drag needs it: the pointer moves in canvas pixels and
   * the document stores world units.
   */
  screenToWorld(clientPoint: {
    x: number;
    y: number;
  }): { x: number; y: number } | undefined {
    const camera = this.scene?.camera;
    const renderer = this.engine?.context.tryResolve(RendererKey);
    if (!camera || !renderer) return undefined;
    // Three spaces, not two. A pointer arrives in client pixels, the canvas
    // sits somewhere in the page, and the camera works in the renderer's
    // virtual pixels — which are the canvas's only when nothing is scaled.
    // `canvasToVirtual` is the renderer's own mapping and covers every fit
    // mode; the input plugin routes pointers through the same call.
    const rect = renderer.canvas.getBoundingClientRect();
    const virtual = renderer.canvasToVirtual(
      clientPoint.x - rect.left,
      clientPoint.y - rect.top,
    );
    const world = camera.screenToWorld(virtual.x, virtual.y);
    return { x: world.x, y: world.y };
  }

  /**
   * The middle of the drawing surface, in world space.
   *
   * Creating a placement lands it here, so it is never put outside what the
   * developer can see. It goes through {@link screenToWorld} rather than
   * reading the camera, so the canvas's own size and fit are accounted for the
   * same way a drag accounts for them.
   */
  viewportCenter(): { x: number; y: number } | undefined {
    const renderer = this.engine?.context.tryResolve(RendererKey);
    if (!renderer) return undefined;
    const rect = renderer.canvas.getBoundingClientRect();
    return this.screenToWorld({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }

  /**
   * Put the editor camera where the store's view says.
   *
   * The view is browser state and this is the only module that writes it onto
   * a camera, which is what keeps every screen-to-world conversion reading the
   * same view the developer changed.
   */
  applyView(view: EditorViewState): void {
    const camera = this.scene?.camera;
    if (!camera) return;
    camera.position = new Vec2(view.center.x, view.center.y);
    // Divided by the fit's scale, so `view.zoom` is CSS pixels of canvas per
    // world unit: the same picture in a 500-pixel pane and a 1500-pixel one,
    // with the wider pane showing more level rather than a larger one.
    camera.zoom = view.zoom / this.canvasScale();
  }

  /**
   * Move the view onto the named placements: the camera on the rectangle their
   * visuals cover, zoomed so all of it fits.
   *
   * Nothing happens when none of them is drawn — an empty selection, one
   * holding only placements this build left out, and one holding only hidden
   * ones. Framing a placement that is not on screen would move the view to
   * empty space.
   */
  frameSelection(ids: readonly string[]): void {
    const renderer = this.engine?.context.tryResolve(RendererKey);
    if (!renderer) return;
    const hidden = this.hiddenClosed();
    const bounds = this.boundsOf(ids.filter((id) => !hidden.has(id)));
    if (!bounds) return;
    this.store.dispatch({
      type: "view-changed",
      // The canvas, not the design rectangle: framing fills the pane the
      // developer actually has.
      view: framedView(this.store.getState().view, bounds, renderer.canvasSize),
    });
  }

  /**
   * The placement under a point, or null. Later placements win, because they
   * are the ones drawn on top. The point is in client pixels, the same ones a
   * pointer event carries.
   */
  hitTest(clientPoint: { x: number; y: number }): string | null {
    const world = this.screenToWorld(clientPoint);
    if (!world) return null;
    return this.hitAmong(world);
  }

  /**
   * The reference target a press at this point would choose, or `null` — for a
   * point on nothing, on a placement no press can choose, and for a point read
   * while no field is waiting.
   *
   * It skips everything the fade dimmed, so a candidate drawn under a
   * non-candidate is still reachable: what is lit is what can be pressed.
   */
  pickAt(clientPoint: { x: number; y: number }): string | null {
    const pick = this.store.getState().pick;
    if (!pick) return null;
    const world = this.screenToWorld(clientPoint);
    if (!world) return null;
    const targets = this.targets(pick.types);
    const hit = this.hitAmong(world, new Set(targets.keys()));
    return hit === null ? null : (targets.get(hit) ?? null);
  }

  /**
   * The placement at a world point, or null. Later placements win, because
   * they are the ones drawn on top. `among` narrows what can be hit at all, so
   * a press passes through a placement no press can choose, and `hidden` is
   * what the developer has taken off the screen — a press reaches whatever was
   * behind it.
   *
   * A mark is tested before the artwork: it is drawn over everything the level
   * draws, and for a placement that draws nothing it is the only thing there
   * is to press.
   */
  private hitAmong(
    world: EditorPoint,
    among?: ReadonlySet<string>,
  ): string | null {
    const hidden = this.hiddenClosed();
    const marked = this.markAtWorld(world, among, hidden);
    if (marked) return marked.id;
    for (let i = this.placements.length - 1; i >= 0; i -= 1) {
      const placement = this.placements[i];
      if (!placement) continue;
      if (among && !among.has(placement.id)) continue;
      if (hidden.has(placement.id)) continue;
      if (containsPoint(placement.entity, world)) return placement.id;
    }
    return null;
  }

  /**
   * The placements no press can choose while a reference field is waiting.
   * Empty whenever nothing is.
   */
  private dimmed(): ReadonlySet<string> {
    const state = this.store.getState();
    const pick = state.pick;
    if (!pick) return NO_PLACEMENTS;
    const targets = this.targets(pick.types);
    const dimmed = new Set<string>();
    for (const placement of state.document.entities) {
      if (!targets.has(placement.id)) dimmed.add(placement.id);
    }
    return dimmed;
  }

  /**
   * The placements the developer has put out of the way, and everything
   * authored under one — the set every consumer works from, so a hidden parent
   * takes its children with it without their ids being in the store.
   *
   * Empty whenever nothing is hidden, which is the case that runs every frame.
   */
  private hiddenClosed(): ReadonlySet<string> {
    const state = this.store.getState();
    return hiddenClosure(state.document, state.hidden);
  }

  /** What a press can choose, over the document the store holds now. */
  private targets(types: readonly string[]): ReadonlyMap<string, string> {
    return referenceTargets(this.store.getState().document.entities, types);
  }

  /**
   * What the mark under a client point stands for: the component's class
   * name, or `null` when no mark is there.
   *
   * A drawing can say a component is a light; only the name says which light.
   * The shell shows it while the pointer rests on a mark, which is the whole
   * of what a mark for a component the editor has no drawing for can offer.
   */
  markAt(clientPoint: { x: number; y: number }): string | null {
    const world = this.screenToWorld(clientPoint);
    if (!world) return null;
    return (
      this.markAtWorld(world, undefined, this.hiddenClosed())?.mark.type ?? null
    );
  }

  /**
   * Which placements a world rectangle covers entirely, in document order.
   *
   * Covers rather than touches: a marquee that took everything it clipped
   * would pick up the scenery behind the one thing the developer was aiming
   * at. A placement that draws nothing is covered when its origin is inside,
   * since that point is all there is of it.
   *
   * The corners arrive in either order, so a rectangle dragged up and to the
   * left means the same as one dragged down and to the right.
   *
   * A hidden placement is not covered by anything: a marquee takes what the
   * developer can see.
   */
  placementsWithin(from: EditorPoint, to: EditorPoint): readonly string[] {
    const area = {
      minX: Math.min(from.x, to.x),
      minY: Math.min(from.y, to.y),
      maxX: Math.max(from.x, to.x),
      maxY: Math.max(from.y, to.y),
    };
    const hidden = this.hiddenClosed();
    const covered: string[] = [];
    for (const placement of this.placements) {
      const id = this.idOf(placement.entity);
      if (id === undefined || hidden.has(id)) continue;
      const bounds = worldBoundsOf(placement.entity);
      const inside = bounds
        ? bounds.minX >= area.minX &&
          bounds.minY >= area.minY &&
          bounds.maxX <= area.maxX &&
          bounds.maxY <= area.maxY
        : within(area, originOf(placement.entity));
      if (inside) covered.push(id);
    }
    return covered;
  }

  /** Stop the engine and release every asset the open level held. */
  async dispose(): Promise<void> {
    this.resize?.disconnect();
    this.resize = undefined;
    this.canvas = undefined;
    await this.queue.idle;
    this.instance?.dispose();
    this.instance = undefined;
    this.placements = [];
    this.byPlacementId = new Map();
    this.marked = [];
    this.links = [];
    this.pointFieldsByType = new Map();
    this.lease?.releaseAll();
    this.engine?.destroy();
    this.engine = undefined;
    this.scene = undefined;
    this.held = undefined;
    this.overlay = undefined;
    this.guides = undefined;
  }

  private async rebuild(request: PreviewRequest): Promise<void> {
    const scene = this.scene;
    const lease = this.lease;
    if (!scene || !lease) return;
    this.revision += 1;
    const revision = this.revision;

    this.provisionLayers(scene, request.layers);
    this.links = referenceUses(request.document.entities, (type) =>
      referenceFieldNames(request.catalog, type),
    );
    this.pointFieldsByType = new Map(
      [...new Set(request.document.entities.map((one) => one.type))].map(
        (type) => [type, pointFields(request.catalog, type)],
      ),
    );
    const prepared = prepareLevel(request.document, request.catalog);

    // Everything the new level needs is loaded before the old level's entities
    // are torn down: a texture both documents use must never drop to zero
    // references in between.
    await lease.acquire(levelAssets(prepared));
    const { blocked, projection } = this.replaceScene(
      scene,
      prepared,
      lease,
      revision,
    );

    if (projection.built) {
      this.instance = projection.built;
      this.adoptPlacements(projection.built, request.document);
    }
    this.publish(prepared.diagnostics, blocked, projection.excluded, revision);

    scheduleRelease(this.flushes, lease, revision, () => this.revision);
  }

  /**
   * Drop what the scene holds and build the largest part of `prepared` that
   * loads. Runs inside the lease's swap, between acquiring and releasing.
   */
  private replaceScene(
    scene: EditPreviewScene,
    prepared: PreparedLevel,
    lease: PreviewAssetLease,
    revision: number,
  ): {
    blocked: ReadonlyMap<string, string>;
    projection: ProjectionOutcome<LevelInstance>;
  } {
    const blocked = placementsMissingAssets(prepared, lease.failures);
    this.instance?.dispose();
    this.instance = undefined;
    this.placements = [];
    this.byPlacementId = new Map();
    this.marked = [];

    const projection = buildBestEffort(
      prepared,
      [
        ...prepared.diagnostics.map((diagnostic) => diagnostic.placementId),
        ...blocked.keys(),
      ],
      (subset) =>
        instantiateLevel(scene, subset, {
          // A fresh namespace per build: the previous instance's entities
          // leave the scene at the end of the frame, and two entities cannot
          // hold one scene key in the meantime.
          namespace: `preview-${String(revision)}`,
          activation: "deferred",
        }),
      describeFailure,
    );
    return { blocked, projection };
  }

  private adoptPlacements(
    instance: LevelInstance,
    document: LevelDocument,
  ): void {
    const placements: DormantPlacement[] = [];
    const byId = new Map<string, Entity>();
    const marked: MarkedPlacement[] = [];
    for (const placement of document.entities) {
      const entity = instance.get(placement.id);
      if (!entity) continue;
      byId.set(placement.id, entity);
      placements.push({
        id: placement.id,
        entity,
        authoredActive: placement.active,
      });
      const marks = marksOf(entity);
      if (marks.length > 0) marked.push({ id: placement.id, entity, marks });
    }
    this.placements = placements;
    this.byPlacementId = byId;
    this.marked = marked;
  }

  /**
   * Give the scene the layers the open level is authored against.
   *
   * The preview scene is pushed once, before any level is open, so it cannot
   * declare them the way a game's scene does. `ensureLayer` is the renderer's
   * own mechanism for provisioning a layer a scene did not declare, and a
   * `sort` is applied afterwards because a layer that already exists — the
   * auto-created `default`, or one left over from the level edited before —
   * keeps the configuration it was created with.
   *
   * A sort this method wrote for the level opened before is cleared when the
   * set now open does not declare one for that name.
   *
   * A layer's order and space are fixed at creation. Switching between two
   * levels whose sets give one name two different orders shows the first
   * level's order until the page is reloaded.
   */
  private provisionLayers(
    scene: EditPreviewScene,
    layers: readonly LayerDef[],
  ): void {
    const trees = this.engine?.context.tryResolve(SceneRenderTreeProviderKey);
    const tree = trees?.getTree(scene);
    if (!tree) return;
    const sorted = new Set<string>();
    for (const def of layers) {
      const layer = tree.ensureLayer(def);
      if (layer.sort !== def.sort) layer.setSort(def.sort);
      if (def.sort !== undefined) sorted.add(def.name);
    }
    for (const name of this.provisionedSorts) {
      if (sorted.has(name)) continue;
      tree.tryGet(name)?.setSort(undefined);
    }
    this.provisionedSorts = sorted;
  }

  /**
   * Put a canvas the editor draws on onto its own layer.
   *
   * Two of them, at opposite ends of the order: the gizmo has to be reachable
   * over anything a level draws, and the guides have to sit under it.
   *
   * A renderer the harness did not install leaves the editor without these and
   * without anything else either, so there is nothing to report here that the
   * missing picture does not already say.
   */
  private mountLayer(
    engine: Engine,
    scene: EditPreviewScene,
    name: string,
    order: number,
  ): Graphics | undefined {
    const trees = engine.context.tryResolve(SceneRenderTreeProviderKey);
    const tree = trees?.getTree(scene);
    if (!tree) return undefined;
    const canvas = new Graphics();
    tree.ensureLayer({ name, order }).container.addChild(canvas);
    return canvas;
  }

  /**
   * Redraw the guides, the selection marker, and the gizmo. Called once per
   * frame, after the placements have been positioned.
   */
  private draw(): void {
    const overlay = this.overlay;
    if (overlay) drawOverlay(overlay, this.overlayView());
    const guides = this.guides;
    if (guides) {
      const view = this.guideView();
      if (view) drawGuides(guides, view);
      else guides.clear();
    }
  }

  /**
   * What the overlay shows: a marker for everything selected, a quieter one
   * for everything a drag of it would carry, and the gizmo.
   */
  overlayView(): OverlayView {
    const state = this.store.getState();
    // A press on a handle does nothing while a field is waiting for a target,
    // and the gizmo draws what a press on it does.
    const gizmo = state.pick ? undefined : this.gizmoOf(state);
    // The box gizmo already outlines a lone placement, along the placement's
    // own axes. The marker would draw a second, upright rectangle over it.
    const outlined = outlinedBy(gizmo);
    const selected = this.marksFor(state.selection, outlined);
    // A drag of the selection moves everything authored under it, so what it
    // carries is marked too. The selection itself is taken back out: a
    // selected child of a selected parent is marked once, as selected.
    const carried = this.marksFor(
      withDescendants(state.document.entities, [...state.selection]).filter(
        (id) => !state.selection.has(id),
      ),
    );
    const marquee = state.marquee;
    return {
      // Only the rectangles: every selected placement gets a crosshair on its
      // origin below, and for one that draws nothing that is the same mark at
      // the same point.
      boxes: selected.boxes,
      carried,
      gizmo: shownAsOverlay(gizmo),
      origins: this.originsOf(state),
      marks: this.marksShown(state),
      links: this.linksShown(state),
      handles: this.handlesShown(state),
      ...(marquee === undefined
        ? {}
        : {
            marquee: {
              minX: Math.min(marquee.from.x, marquee.to.x),
              minY: Math.min(marquee.from.y, marquee.to.y),
              maxX: Math.max(marquee.from.x, marquee.to.x),
              maxY: Math.max(marquee.from.y, marquee.to.y),
            },
          }),
      perScreenPixel: this.perScreenPixel(state),
    };
  }

  /**
   * Where every selected placement's origin sits.
   *
   * It is the point a scale turns about and the point a box grip is missing
   * from when its side runs through it, so a developer who cannot find the
   * grip they expected can see why. It is also what a placement with no
   * picture is marked by, and what the `individual` pivot points at.
   */
  private originsOf(state: EditorState): readonly EditorPoint[] {
    return [...state.selection]
      .map((id) => this.byPlacementId.get(id))
      .filter((entity) => entity !== undefined)
      .map((entity) => originOf(entity));
  }

  /**
   * Every mark on screen: a row over the origin of each placement carrying a
   * component the preview draws nothing for.
   *
   * Shown for every placement rather than for the selection alone. A placement
   * whose only components are a light or a panel draws nothing at all, so the
   * marks are what says it is there and what can be pressed to select it — and
   * a placement that does draw something can still carry an emitter nobody
   * would otherwise see.
   */
  private marksShown(state: EditorState): readonly PlacedMark[] {
    const perScreenPixel = this.perScreenPixel(state);
    // A placement whose only components are a light or a panel draws no
    // artwork, so an alpha says nothing about it. Dropping its marks is what
    // fades it, and dropping them is also the whole of what hiding one means.
    const dimmed = this.dimmed();
    const hidden = this.hiddenClosed();
    const shown: PlacedMark[] = [];
    for (const placement of this.marked) {
      if (dimmed.has(placement.id) || hidden.has(placement.id)) continue;
      shown.push(
        ...placedMarks(
          placement.marks,
          originOf(placement.entity),
          perScreenPixel,
        ),
      );
    }
    return shown;
  }

  /**
   * The references the selection is an end of, as the two points a line runs
   * between: what the selection points at, and what points at it.
   *
   * A reference whose two ends are both selected yields one line rather than
   * two, because the list is walked once per reference and not once per
   * selected placement.
   */
  private linksShown(state: EditorState): readonly OverlayLink[] {
    if (state.selection.size === 0) return [];
    const dimmed = this.dimmed();
    const hidden = this.hiddenClosed();
    const shown: OverlayLink[] = [];
    for (const use of this.links) {
      // A placement pointing at itself has one point and no direction.
      if (use.placementId === use.targetId) continue;
      const holds = state.selection.has(use.placementId);
      const named = state.selection.has(use.targetId);
      if (!holds && !named) continue;
      // An end that is out of the picture — hidden, or faded while a field
      // waits for a target — is not somewhere to draw to, unless it is the
      // selected one: the selection's own marker still shows where it is.
      if (
        !holds &&
        (hidden.has(use.placementId) || dimmed.has(use.placementId))
      )
        continue;
      if (!named && (hidden.has(use.targetId) || dimmed.has(use.targetId)))
        continue;
      // An id no placement has has no second point to draw to. The inspector
      // reports it under the field, which is where a broken slot belongs.
      const from = this.byPlacementId.get(use.placementId);
      const to = this.byPlacementId.get(use.targetId);
      if (!from || !to) continue;
      shown.push({ from: originOf(from), to: originOf(to) });
    }
    return shown;
  }

  /**
   * The point handles on screen: one per place-valued parameter of the
   * selected placement.
   *
   * The selection alone, the way the gizmo is, and one placement alone: a
   * handle names a field of one placement, and several placements selected
   * have no one field between them. While a field is waiting for a reference
   * target a press does nothing but choose, so nothing draggable is drawn.
   *
   * A drag in progress draws its handle where the pointer has taken it, from
   * the same arithmetic the release will write.
   */
  private handlesShown(state: EditorState): readonly ParamHandle[] {
    if (state.pick || state.selection.size !== 1) return [];
    const [id] = state.selection;
    if (id === undefined) return [];
    const placement = state.document.entities.find((one) => one.id === id);
    if (!placement) return [];
    const drag = state.paramDrag;
    return pointHandles(
      state.document,
      dragged(state, placement, drag),
      this.pointFieldsByType.get(placement.type) ?? [],
    ).map((handle) => ({
      kind: "point" as const,
      id,
      field: handle.field,
      at: handle.at,
      ...(handle.from === undefined ? {} : { from: handle.from }),
    }));
  }

  /**
   * Which parameter handle a client point grabs, and everything a drag of it
   * needs. `null` for a point on none of them, and for one read while nothing
   * is drawn.
   */
  paramHandleAt(clientPoint: { x: number; y: number }): ParamGrab | null {
    const state = this.store.getState();
    const handles = this.handlesShown(state);
    if (handles.length === 0) return null;
    const world = this.screenToWorld(clientPoint);
    if (!world) return null;
    const grabbed = paramHandleAt(handles, this.perScreenPixel(state), world);
    if (!grabbed) return null;
    // A point is one handle with no parts, so the whole of it is its body.
    return { id: grabbed.id, field: grabbed.field, grip: "body" };
  }

  /**
   * The mark a world point presses, or nothing. Later placements win, the same
   * way they do for the artwork, because they are the ones drawn on top.
   */
  private markAtWorld(
    world: EditorPoint,
    among: ReadonlySet<string> | undefined,
    hidden: ReadonlySet<string>,
  ): { readonly id: string; readonly mark: PlacedMark } | undefined {
    const perScreenPixel = this.perScreenPixel(this.store.getState());
    for (let i = this.marked.length - 1; i >= 0; i -= 1) {
      const placement = this.marked[i];
      if (!placement) continue;
      if (among && !among.has(placement.id)) continue;
      if (hidden.has(placement.id)) continue;
      const origin = originOf(placement.entity);
      for (const mark of placedMarks(placement.marks, origin, perScreenPixel)) {
        if (pressesMark(mark.at, world, perScreenPixel)) {
          return { id: placement.id, mark };
        }
      }
    }
    return undefined;
  }

  /**
   * How the named placements are marked: a rectangle for each the preview drew
   * with area, a point for each that draws nothing.
   *
   * A visual with no area — an empty `Graphics`, a sprite with no texture yet
   * — leaves a rectangle that strokes to nothing, so it marks the same way a
   * placement with no visual at all does.
   */
  private marksFor(
    ids: Iterable<string>,
    skip?: string | undefined,
  ): OverlayMarks {
    const boxes: WorldBounds[] = [];
    const points: EditorPoint[] = [];
    for (const id of ids) {
      if (id === skip) continue;
      const entity = this.byPlacementId.get(id);
      if (!entity) continue;
      const bounds = worldBoundsOf(entity);
      if (bounds && hasArea(bounds)) boxes.push(bounds);
      else points.push(originOf(entity));
    }
    return { boxes, points };
  }

  /**
   * The point asked for, or the first step away from it that no placement is
   * already sitting on.
   *
   * Ten clicks in the Actors panel would otherwise stack ten placements on the
   * middle of the view, each hiding the last. Stepping down and to the right is
   * the cascade a repeated paste gets in every editor, and paste uses this too.
   *
   * Measured against what the preview drew rather than what the document holds
   * — a placement the projection left out is not in the way of anything.
   *
   * The step is one visible grid cell while snapping is on, so a cascade from
   * a point on the lattice stays on it; a step of screen pixels would take the
   * first copy off the grid and rounding it back would return it to the
   * occupied point. With snapping off it is a screen-pixel distance, so the
   * gap looks the same however far the view is zoomed.
   *
   * What counts as in the way is never narrower than half that step, so
   * rounding the point asked for cannot carry it out of the box that would
   * have made it step aside: the source of a duplicate sits up to half a cell
   * from the lattice point its copy lands on. With snapping off the two
   * measures already agree.
   */
  freeSpotNear(point: EditorPoint): EditorPoint {
    const state = this.store.getState();
    const perScreenPixel = this.perScreenPixel(state);
    const step = state.view.snap
      ? gridSteps(perScreenPixel, state.view.step).fine
      : CASCADE_PIXELS * perScreenPixel;
    const near = Math.max(OCCUPIED_PIXELS * perScreenPixel, step / 2);
    const origins = [...this.byPlacementId.values()].map(originOf);
    let at = point;
    for (let tries = 0; tries < CASCADE_LIMIT; tries += 1) {
      const taken = origins.some(
        (origin) =>
          Math.abs(origin.x - at.x) < near && Math.abs(origin.y - at.y) < near,
      );
      if (!taken) return at;
      at = { x: at.x + step, y: at.y + step };
    }
    return at;
  }

  /**
   * What the guides show, or nothing when they are switched off.
   *
   * The world rectangle comes from the camera's own mapping of the two canvas
   * corners rather than from the zoom and the canvas size, so the grid covers
   * exactly what is drawn — including the letterbox bars, which a fit fills
   * with world the camera can see.
   */
  guideView(): GuideView | undefined {
    const state = this.store.getState();
    if (!state.view.guides) return undefined;
    const camera = this.scene?.camera;
    const renderer = this.engine?.context.tryResolve(RendererKey);
    if (!camera || !renderer) return undefined;
    const canvas = renderer.visibleCanvasRect;
    const min = camera.screenToWorld(canvas.x, canvas.y);
    const max = camera.screenToWorld(
      canvas.x + canvas.width,
      canvas.y + canvas.height,
    );
    return {
      world: { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y },
      // The design size, not what is on screen: the rectangle says what the
      // project renders, and `visibleVirtualRect` would say how wide the
      // developer left the viewport panel.
      viewport: renderer.virtualSize,
      perScreenPixel: this.perScreenPixel(state),
      step: state.view.step,
    };
  }

  /**
   * Which gizmo handle a client point grabs: everything a gesture needs to
   * start, and the direction the handle works along so the shell can show it.
   * The handles are drawn by the renderer, so this is the only way the shell
   * can know one is under the pointer.
   */
  gizmoAt(clientPoint: { x: number; y: number }): GizmoGrab | null {
    const state = this.store.getState();
    const gizmo = this.gizmoOf(state);
    if (!gizmo) return null;
    const world = this.screenToWorld(clientPoint);
    if (!world) return null;
    const perScreenPixel = this.perScreenPixel(state);
    if (gizmo.kind === "box") {
      const box = inflated(gizmo.box, perScreenPixel);
      const handle = boxHandleAt(
        box,
        gizmo.references.keys(),
        perScreenPixel,
        world,
      );
      if (!handle) return null;
      return {
        mode: modeOfBoxHandle(handle),
        anchor: gizmo.anchor,
        handle,
        // What the grip measures against was settled with the grip itself, over
        // the same box this hit test uses, so what is drawn, what is grabbable,
        // and what a drag divides by are one rectangle.
        reference: gizmo.references.get(handle) ?? NO_REFERENCE,
        along: boxHandleDirection(box, handle),
        pivot: gizmo.pivot,
      };
    }
    const arm = armLength(perScreenPixel);
    if (gizmo.kind === "radial") {
      const handle = radialHandleAt(gizmo.anchor, perScreenPixel, world);
      if (!handle) return null;
      // The handle says which transform, exactly as it does for the box: this
      // gizmo carries all three, and its grips are the box's own names.
      const mode = modeOfBoxHandle(handle);
      return {
        mode,
        anchor: gizmo.anchor,
        handle,
        reference: { x: arm, y: arm, kind: "length" },
        along: handleDirection(mode, gizmo.anchor.rotation, handle),
        pivot: gizmo.pivot,
      };
    }
    const handle = handleAt(gizmo.mode, gizmo.anchor, perScreenPixel, world);
    if (!handle) return null;
    return {
      mode: gizmo.mode,
      anchor: gizmo.anchor,
      handle,
      reference: { x: arm, y: arm, kind: "length" },
      along: handleDirection(gizmo.mode, gizmo.anchor.rotation, handle),
      pivot: gizmo.pivot,
    };
  }

  /**
   * Whether a client point is near enough to the gizmo that a press there
   * reads as a missed grab. The viewport asks before clearing the selection:
   * a press that nearly hit a handle must not take the gizmo away.
   */
  gizmoNear(clientPoint: { x: number; y: number }): boolean {
    const state = this.store.getState();
    const gizmo = this.gizmoOf(state);
    if (!gizmo) return false;
    const world = this.screenToWorld(clientPoint);
    if (!world) return false;
    const perScreenPixel = this.perScreenPixel(state);
    if (gizmo.kind === "box") {
      return nearBox(
        inflated(gizmo.box, perScreenPixel),
        perScreenPixel,
        world,
      );
    }
    return gizmo.kind === "radial"
      ? nearRadial(gizmo.anchor, perScreenPixel, world)
      : nearGizmo(gizmo.mode, gizmo.anchor, perScreenPixel, world);
  }

  /**
   * World units per screen pixel: how much world one CSS pixel of pointer
   * travel on the canvas covers.
   *
   * The zoom answers it directly, because {@link applyView} already took the
   * fit's scale out of the camera. The overlay and the hit test both measure
   * in this, so a handle is the same size to the eye and to the pointer
   * whatever the pane is.
   */
  private perScreenPixel(state: EditorState): number {
    return 1 / state.view.zoom;
  }

  /**
   * CSS pixels per virtual pixel, or 1 while there is no canvas to measure.
   *
   * The tighter of the two axes under a fit that scales them differently, so
   * nothing the camera draws runs off the pane on either.
   */
  private canvasScale(): number {
    const renderer = this.engine?.context.tryResolve(RendererKey);
    if (!renderer) return 1;
    const rect = renderer.virtualCanvasRect;
    const virtual = renderer.virtualSize;
    const scale = Math.min(
      rect.width / virtual.width,
      rect.height / virtual.height,
    );
    // A canvas in a pane with no room yet measures zero, which would divide
    // the view's zoom into infinity and put the camera there.
    return scale > 0 && Number.isFinite(scale) ? scale : 1;
  }

  /**
   * What the viewport draws over the selection, and hit-tests against.
   *
   * One gizmo however many placements are selected. It acts on the outermost
   * of them: a selected child of a selected parent travels with its parent,
   * and transforming it again would apply the change twice.
   *
   * Where it sits and which way it points come from the pivot and axis modes.
   * The three single-transform tools draw arms or a ring there. The box tool
   * draws the rectangle covering the selection along those same axes, and when
   * no grip of that rectangle can move anything it arranges the same three
   * transforms round the anchor instead. Select draws nothing.
   */
  private gizmoOf(state: EditorState): GizmoShown | undefined {
    // Select draws no handles. Its markers still show what is chosen, but a
    // gizmo would make it Transform with a marquee attached.
    if (state.tool === "select") return undefined;
    const ids = selectionRoots(state.document, state.selection);
    const active = this.activeOf(state, ids);
    if (!active) return undefined;
    const entities = ids
      .map((id) => this.byPlacementId.get(id))
      .filter((entity) => entity !== undefined);
    if (entities.length === 0) return undefined;
    const own = active.entity.get(Transform).worldRotation;
    const rotation = anchorRotation(state, ids.length, own);
    // A lone placement's box is its own outline, whatever the axes toggle
    // says: the handles have to sit on the picture they resize. A selection's
    // box is a shape of its own, drawn over markers that stay.
    const alone = ids.length === 1;
    const covering = alone
      ? orientedBoxOf(active.entity)
      : coveringBox(entities.map(boxAround), 0);
    // Where the handles sit if nothing holds them: the point the placements
    // have reached this redraw.
    const live: EditorPoint =
      state.pivot === "center" && covering
        ? covering.center
        : originOf(active.entity);
    const gesture = state.gesture;
    // A rotate or a scale about a shared point keeps the anchor and the pivot
    // it pressed on, and orbits every placement about that point for as long
    // as it runs. Recomputing them would draw a ring wandering off the point
    // the rotation is about, because the box round a turning arrangement
    // breathes as it turns.
    //
    // A translate turns and stretches nothing: the box travels with the
    // placements, so the handles and the pivot mark travel with it — where a
    // drag that started on a placement's body has always drawn them. The
    // condition is the one `posed` splits on, so what is drawn and what moves
    // agree: a gesture with no anchor moves what it holds whatever its kind
    // says.
    const frozen =
      gesture !== undefined &&
      gesture.anchor !== undefined &&
      gesture.kind !== "translate"
        ? { anchor: gesture.anchor, pivot: gesture.pivot }
        : undefined;
    const anchor: GizmoAnchor =
      frozen !== undefined
        ? frozen.anchor
        : {
            position: live,
            // Held at the press while the position travels: it names the axis
            // the drag is locked to, which `posed` reads from the gesture and
            // not from here.
            rotation: gesture?.anchor?.rotation ?? rotation,
          };
    const pivot =
      frozen !== undefined
        ? frozen.pivot
        : pivotOf(state.pivot, ids.length, anchor.position);
    // A box handle over one placement scaling about its own origin sets that
    // placement's scale, so it divides by the artwork rather than by the box
    // as drawn — which is what gives a placement at zero a side to drag.
    const sides =
      alone && pivot === undefined
        ? this.unscaledSides(state, active)
        : undefined;
    // Grown to the size it is drawn and grabbed at, because that is the frame a
    // grip without artwork sides changes the size of. Measured against the true
    // rectangle instead, a selection a couple of world units across is dragged
    // by a fraction of nothing and jumps a long way per pointer pixel, and one
    // collapsed onto a line or a point has no divisor at all. Above the
    // 48-pixel minimum this is the same rectangle, so an ordinary placement
    // measures exactly what it did. The artwork sides ignore the box entirely.
    const references = covering
      ? boxReferences(
          inflated(covering, this.perScreenPixel(state)),
          anchor,
          sides,
        )
      : undefined;
    // The box tool needs a grip that can move something. A selection whose
    // every side runs through the point it scales about has none, and the arms
    // are what is left.
    if (state.tool === "box" && covering && references && references.size > 0) {
      return {
        kind: "box",
        box: covering,
        references,
        anchor,
        pivot,
        outlines: alone ? active.id : undefined,
      };
    }
    // What `center` is the centre of. A lone placement already has its own
    // marker, so the outline would be a second rectangle over the first.
    const summary = alone || !covering ? {} : { covering };
    if (state.tool === "box") {
      // The box tool never drops to one transform. With no rectangle to put
      // grips on, the same three go round the placement's origin instead: a
      // disc that moves it, arms that scale it, and a band outside that turns
      // it.
      return { kind: "radial", anchor, pivot, ...summary };
    }
    return { kind: "arms", mode: state.tool, anchor, pivot, ...summary };
  }

  /**
   * Where one placement's own rectangle puts each side of its box at a scale
   * of one, measured from its origin.
   *
   * The rectangle is the artwork's, before the placement's own scale, so
   * multiplying by a scale gives that side's position for any scale — zero
   * included, which is the whole point. The frame above the placement is in
   * it, because the scale a drag writes is the local one the file holds, and a
   * parent flattened to zero on an axis counts as one there.
   *
   * A placement that draws nothing has {@link SUBSTITUTE_BOX} instead of a
   * rectangle, so a calculation that needs a size always has one.
   */
  private unscaledSides(
    state: EditorState,
    active: { readonly id: string; readonly entity: Entity },
  ): UnscaledSides {
    const local = localBoxOf(active.entity) ?? SUBSTITUTE_BOX;
    const world = active.entity.get(Transform).worldScale;
    const parent = parentWorld(
      state.document,
      state.document.entities.find((one) => one.id === active.id)?.parent,
    ).scale;
    // Which local side is drawn at the box's higher coordinate flips with the
    // mirror, and the box takes the magnitude of the scale, so the sides do
    // the same swap the drawn rectangle does.
    const along = (
      which: "x" | "y",
    ): { readonly least: number; readonly most: number } => {
      const least = which === "x" ? local.minX : local.minY;
      const most = which === "x" ? local.maxX : local.maxY;
      const mirrored = world[which] < 0;
      // A parent flattened on this axis counts as one, the rule `toLocal` and
      // `worldDeltaToLocal` already take on the same degeneracy. The child
      // cannot show the change — its parent draws every scale at the same point
      // — but the grips stay, and a half of the artwork's own width still adds
      // one to the local scale the file holds and the control bar shows.
      const carried = parent[which] === 0 ? 1 : parent[which];
      return {
        least: (mirrored ? most : least) * carried,
        most: (mirrored ? least : most) * carried,
      };
    };
    const x = along("x");
    const y = along("y");
    return {
      least: { x: x.least, y: y.least },
      most: { x: x.most, y: y.most },
    };
  }

  /**
   * The placement the gizmo anchors on under the `active` pivot: the last one
   * added to the selection that a transform acts on.
   *
   * Last, because the selection is held in the order placements joined it, so
   * for a click that is the one clicked. A click that lands on a child of
   * something already selected adds a placement no transform acts on, and the
   * anchor falls back to the outermost one before it.
   */
  private activeOf(
    state: EditorState,
    ids: readonly string[],
  ): { readonly id: string; readonly entity: Entity } | undefined {
    const roots = new Set(ids);
    for (const id of [...state.selection].reverse()) {
      const entity = roots.has(id) ? this.byPlacementId.get(id) : undefined;
      if (entity) return { id, entity };
    }
    return undefined;
  }

  /** The world rectangle the named placements cover, as far as they are drawn. */
  private boundsOf(ids: readonly string[]): WorldBounds | undefined {
    const each: WorldBounds[] = [];
    for (const id of ids) {
      const entity = this.byPlacementId.get(id);
      const bounds = entity ? worldBoundsOf(entity) : undefined;
      if (bounds) each.push(bounds);
    }
    return unionBounds(each);
  }

  private idOf(entity: Entity): string | undefined {
    for (const [id, candidate] of this.byPlacementId) {
      if (candidate === entity) return id;
    }
    return undefined;
  }

  /**
   * What this build could not show, as one diagnostic per reason.
   *
   * A finding preparation made keeps its own code and path — a repair control
   * switches on those, never on the message. What the preview itself refused
   * (an asset that failed to load, a `setup()` that threw) has no level code
   * and is reported as `placement-excluded`.
   */
  private publish(
    diagnostics: readonly LevelDiagnostic[],
    blocked: ReadonlyMap<string, string>,
    excluded: ReadonlySet<string>,
    revision: number,
  ): void {
    const reported: EditorDiagnostic[] = diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: "error",
      source: "preview",
      message: diagnostic.message,
      revision,
      placementId: diagnostic.placementId,
      path: diagnostic.path,
    }));
    const explained = new Set(diagnostics.map((one) => one.placementId));
    for (const id of excluded) {
      if (explained.has(id)) continue;
      reported.push({
        code: "placement-excluded",
        severity: "error",
        source: "preview",
        message:
          blocked.get(id) ??
          `Placement "${id}" could not be built and is not shown.`,
        revision,
        placementId: id,
      });
    }
    this.store.dispatch({
      type: "diagnostics-replaced",
      source: "preview",
      diagnostics: reported,
    });
  }
}

/**
 * Queue the release of what the build at `revision` stopped needing.
 *
 * Two rules, and each removes a way to destroy an asset something still draws
 * with.
 *
 * The wait is what {@link DestroyFlushQueue} provides: the build tore its
 * predecessor's entities down with `entity.destroy()`, which marks them and
 * leaves their render objects parented until the engine's end-of-frame flush,
 * so a release in the same frame unloads a texture a live render object is
 * still drawing with.
 *
 * The revision check is what covers a build that arrived in the meantime.
 * `PreviewAssetLease.release()` keeps what the newest `acquire()` asked for, so
 * an older build's release run after a newer one has torn down its own
 * predecessor would drop exactly the keys that predecessor is still drawing
 * with — the same defect one frame further along. A skipped release loses
 * nothing: the newer build queued its own, which keeps the same set.
 */
export function scheduleRelease(
  flushes: DestroyFlushQueue,
  lease: Pick<PreviewAssetLease, "release">,
  revision: number,
  currentRevision: () => number,
): void {
  flushes.add(() => {
    if (currentRevision() !== revision) return;
    lease.release();
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a strict load says about which placement stopped it. */
function describeFailure(
  error: unknown,
): { placementId?: string | undefined; message: string } | undefined {
  if (!(error instanceof LevelLoadError)) return undefined;
  return { placementId: error.placementId, message: error.message };
}

/**
 * A gizmo handle under the pointer: what a gesture on it needs, and what the
 * pointer should look like over it.
 */
export interface GizmoGrab {
  /**
   * Which transform this press performs. It comes from the handle rather than
   * from the tool: the box gizmo's handles carry all three between them.
   */
  readonly mode: GizmoMode;
  readonly anchor: GizmoAnchor;
  readonly handle: HandleId;
  /** What a scale measures against on each axis, in world units. */
  readonly reference: GizmoReference;
  /**
   * The unit world direction a drag of this handle grows the placement along,
   * for a scale handle. Absent for the rest, which change nothing that points
   * anywhere: a move goes wherever the pointer does and a turn goes round.
   */
  readonly along?: EditorPoint | undefined;
  /**
   * The world point the placements turn and scale about. Absent means each
   * about its own origin, which is the `individual` pivot and also a single
   * placement under `active`.
   */
  readonly pivot?: EditorPoint | undefined;
}

/** A parameter handle under the pointer: what a drag of it needs to start. */
export interface ParamGrab {
  /** The placement holding the parameter. */
  readonly id: string;
  /** The parameter's name. */
  readonly field: string;
  /** Which part of the handle the press landed on. A point answers `body`. */
  readonly grip: HandleId;
}

/**
 * The placement with the value a drag has reached written into it, so the
 * handle is drawn from the drag rather than from the document.
 *
 * Nothing else in the preview shows the value: `setup()` runs again on release,
 * through the rebuild the edit asks for.
 */
function dragged(
  state: EditorState,
  placement: LevelPlacement,
  drag: ParamDrag | undefined,
): LevelPlacement {
  if (!drag || drag.id !== placement.id) return placement;
  return {
    ...placement,
    params: { ...placement.params, [drag.field]: draggedValue(state, drag) },
  };
}

/** Whether a point is inside a rectangle. */
function within(area: WorldBounds, point: EditorPoint): boolean {
  return (
    point.x >= area.minX &&
    point.x <= area.maxX &&
    point.y >= area.minY &&
    point.y <= area.maxY
  );
}

/** Whether a rectangle covers anything a stroke would show. */
function hasArea(bounds: WorldBounds): boolean {
  return bounds.maxX > bounds.minX || bounds.maxY > bounds.minY;
}

/** An entity's world position — where its gizmo sits and what it turns around. */
function originOf(entity: Entity): EditorPoint {
  const position = entity.get(Transform).worldPosition;
  return { x: position.x, y: position.y };
}

/** A placement carrying components the preview draws nothing for. */
interface MarkedPlacement {
  readonly id: string;
  readonly entity: Entity;
  readonly marks: readonly ComponentMark[];
}

/** What the viewport is drawing over the selection. */
type GizmoShown = {
  readonly anchor: GizmoAnchor;
  /** What the placements turn and scale about; see {@link GizmoGrab.pivot}. */
  readonly pivot?: EditorPoint | undefined;
} & (
  | {
      readonly kind: "arms";
      readonly mode: GizmoMode;
      /** The box round a whole selection, drawn without handles. */
      readonly covering?: OrientedBox | undefined;
    }
  | {
      /** The box tool over a placement with no rectangle; see {@link radialHandleAt}. */
      readonly kind: "radial";
      readonly covering?: OrientedBox | undefined;
    }
  | {
      readonly kind: "box";
      readonly box: OrientedBox;
      /**
       * What each grip measures against. A grip the box cannot move with a
       * scale is absent, so this is also the set of grips drawn and grabbed.
       */
      readonly references: ReadonlyMap<HandleId, GizmoReference>;
      /** The one placement whose own outline this box stands in for. */
      readonly outlines?: string | undefined;
    }
);

/**
 * Which axes the gizmo lies along.
 *
 * Only Move reads the axes toggle. Rotate has one ring and no axis to choose.
 * Scale has to lie along the placement's own axes because that is the only
 * direction it can grow: a factor measured on a foreign axis still lands on
 * `scale.x` and `scale.y`, and a turned placement stretched along a foreign
 * axis is a shear, which a level transform cannot hold. A selection of more
 * than one has no shared local axis, so it is upright.
 */
function anchorRotation(
  state: EditorState,
  roots: number,
  own: number,
): number {
  if (roots > 1) return 0;
  if (state.tool === "rotate") return 0;
  if (state.tool === "translate") return state.axes === "local" ? own : 0;
  return own;
}

/**
 * What the placements turn and scale about, or `undefined` for each about its
 * own origin.
 *
 * A single placement under `active` is the second case: the anchor already
 * sits on that placement's origin, so naming it here would send the pose out
 * through world space and back for no change but a rounding.
 */
function pivotOf(
  mode: PivotMode,
  roots: number,
  anchor: EditorPoint,
): EditorPoint | undefined {
  if (mode === "individual") return undefined;
  if (mode === "active" && roots === 1) return undefined;
  return anchor;
}

/** Which transform each part of the box gizmo performs. */
function modeOfBoxHandle(handle: HandleId): GizmoMode {
  if (handle === "body") return "translate";
  return handle === "turn" ? "rotate" : "scale";
}

/**
 * What a handle that holds no side measures against. The interior moves the
 * placement and the band outside turns it, and neither divides by anything.
 */
const NO_REFERENCE: GizmoReference = { x: 1, y: 1, kind: "length" };

/** How near a placement has to be, in screen pixels, to count as in the way. */
const OCCUPIED_PIXELS = 12;

/** How far a blocked placement steps to try again, in screen pixels. */
const CASCADE_PIXELS = 24;

/**
 * How many steps the cascade takes before it gives up and stacks.
 *
 * A crowded level can fill a diagonal, and walking it forever would hang the
 * editor on an Actors click. Sixteen steps is far enough to clear any ordinary
 * pile and short enough that the search is never noticed.
 */
const CASCADE_LIMIT = 16;

/** The drawing surface's size in CSS pixels. */
interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The canvas's size, or nothing while it has no room to be measured in.
 *
 * A pane collapsed to nothing and a hidden tab both measure zero, and a size
 * that cannot be measured is not one the view can be moved against.
 */
function measured(
  renderer: RendererPlugin | undefined,
): CanvasSize | undefined {
  const size = renderer?.canvasSize;
  if (!size) return undefined;
  return size.width > 0 && size.height > 0 ? size : undefined;
}

/** The answer whenever nothing is faded and whenever nothing is hidden. */
const NO_PLACEMENTS: ReadonlySet<string> = new Set<string>();

/** What the overlay draws for the gizmo the viewport is showing. */
function shownAsOverlay(
  gizmo: GizmoShown | undefined,
): OverlayGizmo | undefined {
  if (!gizmo) return undefined;
  if (gizmo.kind === "box") {
    return {
      kind: "box",
      box: gizmo.box,
      grips: [...gizmo.references.keys()],
      // Absent under `individual`, where there is no one point to draw.
      ...(gizmo.pivot === undefined ? {} : { pivot: gizmo.pivot }),
    };
  }
  const summary =
    gizmo.covering === undefined ? {} : { covering: gizmo.covering };
  if (gizmo.kind === "radial") {
    return { kind: "radial", anchor: gizmo.anchor, ...summary };
  }
  return { kind: "arms", mode: gizmo.mode, anchor: gizmo.anchor, ...summary };
}

/** The placement the box gizmo outlines in place of its own marker, if one. */
function outlinedBy(gizmo: GizmoShown | undefined): string | undefined {
  return gizmo?.kind === "box" ? gizmo.outlines : undefined;
}
