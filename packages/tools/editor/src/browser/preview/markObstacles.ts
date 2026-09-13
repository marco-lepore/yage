import type { WorldBounds } from "../commands/index.js";
import type { EditorPoint } from "../store/index.js";
import { BAND_MISS_PIXELS, cornerAt, inflated } from "./box.js";
import { ARM_PIXELS, MISS_PIXELS, RING_PIXELS } from "./gizmo.js";
import {
  PARAM_GRAB_PIXELS,
  PARAM_HANDLE_PIXELS,
  type OverlayGizmo,
  type ParamHandle,
} from "./overlay.js";

/** Reserve control hit areas too: the shell tests controls before entity marks. */
export function markObstacles(
  gizmo: OverlayGizmo | undefined,
  handles: readonly ParamHandle[],
  perScreenPixel: number,
): readonly WorldBounds[] {
  const around = (at: EditorPoint, radius: number): WorldBounds => ({
    minX: at.x - radius,
    minY: at.y - radius,
    maxX: at.x + radius,
    maxY: at.y + radius,
  });
  const obstacles = handles.map((handle) =>
    around(
      handle.at,
      (PARAM_HANDLE_PIXELS + PARAM_GRAB_PIXELS) * perScreenPixel,
    ),
  );
  if (!gizmo) return obstacles;
  if (gizmo.kind === "box") {
    const box = inflated(gizmo.box, perScreenPixel);
    const corners = [
      cornerAt(box, { x: -1, y: -1 }),
      cornerAt(box, { x: 1, y: -1 }),
      cornerAt(box, { x: 1, y: 1 }),
      cornerAt(box, { x: -1, y: 1 }),
    ];
    const margin = BAND_MISS_PIXELS * perScreenPixel;
    obstacles.push({
      minX: Math.min(...corners.map((point) => point.x)) - margin,
      minY: Math.min(...corners.map((point) => point.y)) - margin,
      maxX: Math.max(...corners.map((point) => point.x)) + margin,
      maxY: Math.max(...corners.map((point) => point.y)) + margin,
    });
  } else {
    const reach =
      gizmo.kind === "radial"
        ? ARM_PIXELS + BAND_MISS_PIXELS
        : (gizmo.mode === "rotate" ? RING_PIXELS : ARM_PIXELS) + MISS_PIXELS;
    obstacles.push(around(gizmo.anchor.position, reach * perScreenPixel));
  }
  return obstacles;
}
