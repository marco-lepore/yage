import { Component, Vec2, serializable } from "@yagejs/core";
import { CameraComponent } from "./CameraComponent.js";
import type { CameraBounds } from "./CameraComponent.js";

export interface CameraBoundsComponentData {
  bounds?: CameraBounds;
}

/**
 * Camera bounds clamping. Restricts `CameraComponent.position`
 * to a bounding rectangle each frame. Add order matters: runs
 * after `CameraFollow` so the follow position is clamped.
 */
@serializable
export class CameraBoundsComponent extends Component {
  private readonly cam = this.sibling(CameraComponent);

  bounds: CameraBounds | undefined;

  update(): void {
    if (!this.bounds) return;

    const halfViewW = this.cam.viewportWidth / (2 * this.cam.zoom);
    const halfViewH = this.cam.viewportHeight / (2 * this.cam.zoom);

    const minCamX = this.bounds.minX + halfViewW;
    const maxCamX = this.bounds.maxX - halfViewW;
    const minCamY = this.bounds.minY + halfViewH;
    const maxCamY = this.bounds.maxY - halfViewH;

    const clampedX =
      minCamX > maxCamX
        ? (this.bounds.minX + this.bounds.maxX) / 2
        : Math.max(minCamX, Math.min(maxCamX, this.cam.position.x));
    const clampedY =
      minCamY > maxCamY
        ? (this.bounds.minY + this.bounds.maxY) / 2
        : Math.max(minCamY, Math.min(maxCamY, this.cam.position.y));
    this.cam.position = new Vec2(clampedX, clampedY);
  }

  serialize(): CameraBoundsComponentData {
    const data: CameraBoundsComponentData = {};
    if (this.bounds) {
      data.bounds = { ...this.bounds };
    }
    return data;
  }

  static fromSnapshot(data: CameraBoundsComponentData): CameraBoundsComponent {
    const bounds = new CameraBoundsComponent();
    if (data.bounds) {
      bounds.bounds = { ...data.bounds };
    }
    return bounds;
  }
}
