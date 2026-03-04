import { System, Phase, QueryCacheKey } from "@yage/core";
import type { EngineContext, QueryResult } from "@yage/core";
import { RendererKey } from "@yage/renderer";
import { Direction } from "yoga-layout";
import { Anchor } from "./types.js";
import { UIPanel } from "./UIPanel.js";
import { setViewport } from "./yoga-helpers.js";

/**
 * Resolves anchor positions and runs Yoga layout for all UIPanel components.
 * Runs in LateUpdate (after game logic, before render).
 */
export class UILayoutSystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 200;

  private panelQuery!: QueryResult;
  private virtualWidth = 0;
  private virtualHeight = 0;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.panelQuery = queryCache.register([UIPanel]);

    const renderer = context.resolve(RendererKey);
    const size = renderer.virtualSize;
    this.virtualWidth = size.width;
    this.virtualHeight = size.height;

    setViewport(this.virtualWidth, this.virtualHeight);
  }

  update(): void {
    for (const entity of this.panelQuery) {
      const panel = entity.get(UIPanel);
      if (!panel.enabled || !panel.visible) continue;

      const node = panel._node;

      // 1. Run Yoga layout (NaN = shrink-to-content; explicit sizes still work)
      node.yogaNode.calculateLayout(undefined, undefined, Direction.LTR);

      // 2. Apply computed positions to Pixi display objects
      node.applyLayout();

      // 3. Read computed size for anchor resolution
      const pw = node.yogaNode.getComputedWidth();
      const ph = node.yogaNode.getComputedHeight();

      // 4. Resolve anchor position
      const anchor = panel._anchor;
      if (anchor !== undefined) {
        const pos = resolveAnchor(
          anchor,
          this.virtualWidth,
          this.virtualHeight,
          pw,
          ph,
        );
        panel.container.position.set(
          pos.x + panel._offset.x,
          pos.y + panel._offset.y,
        );
      } else {
        panel.container.position.set(panel._offset.x, panel._offset.y);
      }
    }
  }
}

/** Compute the top-left position for a panel of given size at the specified anchor. */
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
