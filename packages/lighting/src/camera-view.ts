import { Vec2Buffer } from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";
import type { LightingRenderFrame } from "./types.js";

/**
 * @internal The camera transform a lighting renderer draws world-space geometry
 * under.
 *
 * Shadow geometry is world-space. Put under this transform it follows the
 * camera the way the scene does, so it is rebuilt only when a light or an
 * occluder moves rather than on every pan.
 */
export class CameraView {
  private readonly scratch = new Vec2Buffer();
  private x = 0;
  private y = 0;
  private zoom = 1;
  private offsetX = 0;
  private offsetY = 0;
  /** How far the camera turns the world, in radians. */
  turn = 0;

  /** Read the frame's camera. Returns whether the view moved. */
  read(frame: LightingRenderFrame): boolean {
    const camera = frame.camera;
    let x = 0;
    let y = 0;
    let turn = 0;
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    if (camera) {
      const position = camera.getEffectivePositionInto(this.scratch);
      x = position.x;
      y = position.y;
      turn = camera.effectiveRotation;
      zoom = camera.effectiveZoom;
      offsetX = camera.viewportWidth / 2;
      offsetY = camera.viewportHeight / 2;
    }
    if (
      x === this.x &&
      y === this.y &&
      turn === this.turn &&
      zoom === this.zoom &&
      offsetX === this.offsetX &&
      offsetY === this.offsetY
    ) {
      return false;
    }
    this.x = x;
    this.y = y;
    this.turn = turn;
    this.zoom = zoom;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    return true;
  }

  /** Put a container holding world-space geometry under this camera. */
  applyTo(container: DisplayContainer): void {
    container.pivot.set(this.x, this.y);
    container.scale.set(this.zoom);
    container.rotation = -this.turn;
    container.position.set(this.offsetX, this.offsetY);
  }
}
