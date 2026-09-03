import {
  Phase,
  Scene,
  System,
  type Plugin,
  type SystemScheduler,
} from "@yagejs/core";
import { CameraEntity } from "@yagejs/renderer";
import type { DestroyFlushQueue } from "./DestroyFlushQueue.js";
import { synchronizeDormantVisuals, type DormantPlacement } from "./dormant.js";

/** Where the editor's own scene keys live, kept clear of a game's. */
export const PREVIEW_SCENE_NAME = "yage-editor/preview";

/**
 * The layer the selection marker and the gizmo draw on.
 *
 * The harness belongs to the project, so the editor cannot require a layer to
 * be declared; `SceneRenderTree.ensureLayer` is the renderer's mechanism for a
 * plugin to provision one, and this orders above everything the project
 * declared.
 */
export const OVERLAY_LAYER_NAME = "yage-editor/overlay";

/**
 * Where the overlay layer sorts.
 *
 * A fixed order rather than one above whatever exists when the editor starts:
 * layers are provisioned lazily, and `@yagejs/ui` claims 1,000 and 1,000,000
 * the first time a level's placement mounts a surface, which is long after
 * the editor booted. This sits above both.
 */
export const OVERLAY_LAYER_ORDER = 10_000_000;

/** The layer the grid, the world axes, and the viewport rectangle draw on. */
export const GUIDE_LAYER_NAME = "yage-editor/guides";

/**
 * Where the guide layer sorts: below the render tree's own default layer at
 * zero, which is where a placement lands unless the project put it elsewhere.
 * A reference grid drawn over the level would be read through rather than
 * looked at.
 */
export const GUIDE_LAYER_ORDER = -10_000_000;

/**
 * The scene the editor draws into.
 *
 * It holds the authored placements — inactive, so nothing in them runs — and
 * the editor's own camera, which is active. The camera belongs to the editor
 * rather than to the level: a game's camera is an authored entity like any
 * other, and the view a developer is editing from is not part of the document.
 */
export class EditPreviewScene extends Scene {
  readonly name = PREVIEW_SCENE_NAME;
  private editorCamera: CameraEntity | undefined;

  onEnter(): void {
    this.editorCamera = this.spawn(CameraEntity, { priority: 0 });
  }

  /** The camera every screen-to-world conversion goes through. */
  get camera(): CameraEntity | undefined {
    return this.editorCamera;
  }
}

/**
 * Draws the dormant placements once per frame.
 *
 * It runs after the renderer's own pass, which skips dormant entities
 * entirely, so these writes are the last word on where an authored placement
 * appears.
 */
class DormantVisualSystem extends System {
  readonly phase = Phase.Render;
  readonly priority = 100;

  constructor(
    private readonly placements: () => readonly DormantPlacement[],
    private readonly dimmed: () => ReadonlySet<string>,
  ) {
    super();
  }

  update(): void {
    synchronizeDormantVisuals(this.placements(), this.dimmed());
  }
}

/**
 * Redraws what the editor draws over and under the level, after the placements
 * have been positioned.
 *
 * It runs every frame rather than on a change because everything it draws is
 * sized in screen pixels: a camera that zooms changes what those pixels are
 * worth without changing anything the editor would otherwise react to.
 */
class OverlaySystem extends System {
  readonly phase = Phase.Render;
  readonly priority = 110;

  constructor(private readonly draw: () => void) {
    super();
  }

  update(): void {
    this.draw();
  }
}

/**
 * The editor's own plugin, installed alongside the project's.
 *
 * It adds nothing a game can see: a render-phase system that draws what the
 * engine deliberately leaves alone, and one that runs the coordinator's
 * teardown work on a frame boundary.
 */
export class EditorPreviewPlugin implements Plugin {
  readonly name = "yage-editor-preview";
  readonly version = "0.0.0";
  private readonly visuals: DormantVisualSystem;
  private readonly overlay: OverlaySystem;

  constructor(
    placements: () => readonly DormantPlacement[],
    dimmed: () => ReadonlySet<string>,
    private readonly flushes: DestroyFlushQueue,
    draw: () => void,
  ) {
    this.visuals = new DormantVisualSystem(placements, dimmed);
    this.overlay = new OverlaySystem(draw);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(this.visuals);
    scheduler.add(this.overlay);
    scheduler.add(this.flushes);
  }
}
