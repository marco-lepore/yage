import { Transform } from "@yagejs/core";
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

  constructor(private readonly store: VectorDrawStore) {}

  drawWorld(api: WorldDebugApi): void {
    if (this.store.size === 0 || !api.isFlagEnabled("arrows")) return;

    // A zoomed-in camera scales world-space strokes up with everything else;
    // dividing by the zoom keeps shaft and head at their configured size on
    // screen while the arrow's length stays in world pixels.
    const zoom = api.cameraZoom || 1;

    for (const entry of this.store) {
      const entity = entry.entity;
      if (entity.isDestroyed) {
        // The bus event normally gets here first; this covers a registry
        // driven without one (tests, a host that skips the plugin wiring).
        this.store.dropEntity(entity.id);
        continue;
      }
      // A dormant entity keeps its registration — it draws again when it
      // comes back — but draws nothing while it is off.
      if (!entity.isActive) continue;

      const transform = entity.tryGet(Transform);
      if (!transform) continue;

      const v = entry.vector();
      if (!v) continue;

      const length = Math.hypot(v.x, v.y);
      if (length === 0 || length < entry.minLength) continue;

      const g = api.acquireGraphics();
      if (!g) return; // pool exhausted — skip the remaining arrows this frame

      // worldPosition walks the parent chain, so a child entity's arrow sits
      // where the entity is drawn, not where its local offset would put it.
      const origin = transform.worldPosition;
      g.position.x = origin.x + entry.originX;
      g.position.y = origin.y + entry.originY;

      drawArrow(g, v.x * entry.scale, v.y * entry.scale, entry, zoom);
    }
  }
}

/** Shaft plus a filled head, from the graphics node's origin to (tipX, tipY). */
function drawArrow(
  g: DebugGraphics,
  tipX: number,
  tipY: number,
  entry: VectorEntry,
  zoom: number,
): void {
  const length = Math.hypot(tipX, tipY);
  if (length === 0) return;

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
