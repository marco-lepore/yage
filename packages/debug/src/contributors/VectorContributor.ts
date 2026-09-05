import { Transform } from "@yagejs/core";
import type { ErrorBoundary, Vec2Like } from "@yagejs/core";
import type {
  DebugContributor,
  DebugGraphics,
  WorldDebugApi,
} from "../types.js";
import type { VectorDrawStore, VectorEntry } from "../VectorDrawStore.js";

/** Arrowhead width as a fraction of its length. */
const HEAD_WIDTH_RATIO = 0.75;

/**
 * Draws every arrow registered through `DebugRegistry.drawVector`. Providers
 * are read here and nowhere else, so they stay uncalled while the overlay is
 * off or the `arrows` flag is disabled.
 */
export class VectorContributor implements DebugContributor {
  readonly name = "vectors";
  readonly flags = ["arrows"] as const;

  constructor(
    private readonly store: VectorDrawStore,
    private readonly boundary: ErrorBoundary,
  ) {}

  drawWorld(api: WorldDebugApi): void {
    if (this.store.size === 0 || !api.isFlagEnabled("arrows")) return;

    // A zoomed-in camera scales world-space strokes up with everything else;
    // dividing by the zoom keeps shaft and head at their configured size on
    // screen while the arrow's length stays in world pixels.

    for (const entry of this.store) {
      const entity = entry.entity;
      // A registration belongs to one life of one entity. Destruction and an
      // EntityPool release both end a life; `generation` covers either, and
      // the destroyed check covers the window before a destroy is flushed.
      if (entity.isDestroyed || entity.generation !== entry.generation) {
        this.store.remove(entity.id, entry);
        continue;
      }
      // A dormant entity keeps its registration — it draws again when it
      // comes back — but draws nothing while it is off.
      if (!entity.isActive) continue;
      const target = api.forScene(entry.scene);
      if (!target) continue;
      const zoom = target.cameraZoom;

      const transform = entity.tryGet(Transform);
      if (!transform) continue;

      const v = this.readVector(entry);
      if (!v) continue;

      const length = Math.hypot(v.x, v.y);
      if (length === 0 || length < entry.minLength) continue;

      // Measure the drawn arrow before taking a pool slot, so a scale that
      // collapses it to nothing doesn't spend one on an invisible arrow.
      const tipX = v.x * entry.scale;
      const tipY = v.y * entry.scale;
      const drawnLength = Math.hypot(tipX, tipY);
      if (drawnLength === 0) continue;

      const g = target.acquireGraphics();
      if (!g) return; // pool exhausted — skip the remaining arrows this frame

      // worldPosition walks the parent chain, so a child entity's arrow sits
      // where the entity is drawn, not where its local offset would put it.
      const origin = transform.worldPosition;
      g.position.x = origin.x + entry.originX;
      g.position.y = origin.y + entry.originY;

      drawArrow(g, tipX, tipY, drawnLength, entry, zoom);
    }
  }

  /**
   * The provider is game code the engine calls on its own, so a throw is
   * attributed to it rather than to whichever system was on the stack.
   * `wrapCallback` records and logs, then rethrows — nothing is muted.
   */
  private readVector(entry: VectorEntry): Vec2Like | null | undefined {
    let v: Vec2Like | null | undefined;
    this.boundary.wrapCallback(
      () => {
        v = entry.vector();
      },
      { kind: "drawVector provider", entity: entry.entity.name },
    );
    return v;
  }
}

/** Shaft plus a filled head, from the graphics node's origin to (tipX, tipY). */
function drawArrow(
  g: DebugGraphics,
  tipX: number,
  tipY: number,
  length: number,
  entry: VectorEntry,
  zoom: number,
): void {
  const dirX = tipX / length;
  const dirY = tipY / length;
  const style = { color: entry.color, alpha: entry.alpha };

  // Clamping the head to the arrow's own length keeps a short arrow from
  // growing a head that points past its own origin.
  const head = Math.min(entry.headSize / zoom, length);
  const baseX = tipX - dirX * head;
  const baseY = tipY - dirY * head;

  if (length > head) {
    g.moveTo(0, 0)
      .lineTo(baseX, baseY)
      .stroke({ ...style, width: entry.width / zoom });
  }

  const halfWidth = (head * HEAD_WIDTH_RATIO) / 2;
  const perpX = -dirY;
  const perpY = dirX;
  g.moveTo(tipX, tipY)
    .lineTo(baseX + perpX * halfWidth, baseY + perpY * halfWidth)
    .lineTo(baseX - perpX * halfWidth, baseY - perpY * halfWidth)
    .fill(style);
}
