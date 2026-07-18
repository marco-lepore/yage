import { System, Phase, QueryCacheKey, Transform } from "@yagejs/core";
import type { EngineContext, QueryResult } from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import { Direction } from "yoga-layout";
import { Anchor } from "./types.js";
import { UISurface } from "./UISurface.js";
import { setViewport } from "./yoga-helpers.js";

/**
 * Resolves anchor positions and runs Yoga layout for all UISurface components.
 * Runs in LateUpdate (after game logic, before render).
 */
export class UILayoutSystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 200;

  private surfaceQuery!: QueryResult;
  private virtualWidth = 0;
  private virtualHeight = 0;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.surfaceQuery = queryCache.register([UISurface]);

    const renderer = context.resolve(RendererKey);
    const size = renderer.virtualSize;
    this.virtualWidth = size.width;
    this.virtualHeight = size.height;

    setViewport(this.virtualWidth, this.virtualHeight);
  }

  update(): void {
    for (const entity of this.surfaceQuery) {
      const surface = entity.get(UISurface);
      if (!surface.enabled || !surface.visible) continue;

      const node = surface.root;

      // 1. Run Yoga layout (NaN = shrink-to-content; explicit sizes still work)
      node.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);

      // 2. Apply computed positions to Pixi display objects
      node.applyLayout();

      // 3. Read computed size
      const pw = node.yogaNode.getComputedWidth();
      const ph = node.yogaNode.getComputedHeight();

      // 4. Position the root container. Two modes:
      //    - "anchor" (default) resolves `anchor` against the viewport.
      //    - "transform" reads `entity.get(Transform).worldPosition` in
      //      the layer's local coord space and uses `anchor` as a pivot
      //      on the panel itself.
      //    The layer's `space` is independent: a `"transform"`-positioned
      //    panel on a world-space layer pins to world coords (diegetic UI
      //    that scales with the camera); on a screen-space layer it pins
      //    to screen coords (pair with a `ScreenFollow` component that
      //    writes projected coords each frame for constant-size
      //    billboards).
      const anchor = surface._anchor;

      if (surface._positioning === "transform") {
        const source = entity.get(Transform).worldPosition;
        if (anchor !== undefined) {
          const pivot = pivotOffsetFromAnchor(anchor, pw, ph);
          surface.container.position.set(
            source.x + pivot.x + surface._offset.x,
            source.y + pivot.y + surface._offset.y,
          );
        } else {
          surface.container.position.set(
            source.x + surface._offset.x,
            source.y + surface._offset.y,
          );
        }
      } else if (anchor !== undefined) {
        const pos = resolveAnchor(
          anchor,
          this.virtualWidth,
          this.virtualHeight,
          pw,
          ph,
        );
        surface.container.position.set(
          pos.x + surface._offset.x,
          pos.y + surface._offset.y,
        );
      } else {
        surface.container.position.set(surface._offset.x, surface._offset.y);
      }
    }
  }
}

/**
 * Screen-space anchor resolution: compute the top-left position for a panel
 * of size (`pw`, `ph`) within a viewport of size (`vw`, `vh`) such that the
 * named corner of the panel aligns with the named corner of the viewport.
 */
export function resolveAnchor(
  anchor: Anchor,
  vw: number,
  vh: number,
  pw: number,
  ph: number,
): { x: number; y: number } {
  let x = 0;
  let y = 0;

  // Horizontal
  switch (anchor) {
    case Anchor.TopLeft:
    case Anchor.CenterLeft:
    case Anchor.BottomLeft:
      x = 0;
      break;
    case Anchor.TopCenter:
    case Anchor.Center:
    case Anchor.BottomCenter:
      x = (vw - pw) / 2;
      break;
    case Anchor.TopRight:
    case Anchor.CenterRight:
    case Anchor.BottomRight:
      x = vw - pw;
      break;
  }

  // Vertical
  switch (anchor) {
    case Anchor.TopLeft:
    case Anchor.TopCenter:
    case Anchor.TopRight:
      y = 0;
      break;
    case Anchor.CenterLeft:
    case Anchor.Center:
    case Anchor.CenterRight:
      y = (vh - ph) / 2;
      break;
    case Anchor.BottomLeft:
    case Anchor.BottomCenter:
    case Anchor.BottomRight:
      y = vh - ph;
      break;
  }

  return { x, y };
}

/**
 * World-space pivot offset: compute the offset to add to a Transform
 * position so that the named corner of the panel sits at the Transform.
 *
 * `Anchor.Center` returns `(-pw/2, -ph/2)` (panel center at Transform).
 * `Anchor.BottomCenter` returns `(-pw/2, -ph)` (panel's bottom-center at
 * Transform — the natural "hovers above this entity" primitive for
 * health bars / nameplates).
 */
export function pivotOffsetFromAnchor(
  anchor: Anchor,
  pw: number,
  ph: number,
): { x: number; y: number } {
  let x = 0;
  let y = 0;

  switch (anchor) {
    case Anchor.TopLeft:
    case Anchor.CenterLeft:
    case Anchor.BottomLeft:
      x = 0;
      break;
    case Anchor.TopCenter:
    case Anchor.Center:
    case Anchor.BottomCenter:
      x = -pw / 2;
      break;
    case Anchor.TopRight:
    case Anchor.CenterRight:
    case Anchor.BottomRight:
      x = -pw;
      break;
  }

  switch (anchor) {
    case Anchor.TopLeft:
    case Anchor.TopCenter:
    case Anchor.TopRight:
      y = 0;
      break;
    case Anchor.CenterLeft:
    case Anchor.Center:
    case Anchor.CenterRight:
      y = -ph / 2;
      break;
    case Anchor.BottomLeft:
    case Anchor.BottomCenter:
    case Anchor.BottomRight:
      y = -ph;
      break;
  }

  return { x, y };
}
