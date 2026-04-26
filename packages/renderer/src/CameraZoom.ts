import { Component, serializable } from "@yagejs/core";
import type { EasingFunction } from "@yagejs/core";
import { CameraComponent } from "./CameraComponent.js";

export interface CameraZoomData {
  zoomFrom: number;
  zoomTarget: number;
  duration: number;
  elapsed: number;
  zooming: boolean;
}

const LINEAR_EASING: EasingFunction = (t) => t;

/**
 * Camera zoom animation behavior. Smoothly interpolates
 * `CameraComponent.zoom` toward a target value over a duration.
 */
@serializable
export class CameraZoom extends Component {
  private readonly cam = this.sibling(CameraComponent);
  private zoomFrom = 1;
  private zoomTarget = 1;
  private duration = 0;
  private elapsed = 0;
  private easing: EasingFunction = LINEAR_EASING;
  private zooming = false;

  /** Start a zoom animation. */
  start(target: number, duration: number, easing?: EasingFunction): void {
    this.zoomFrom = this.cam.zoom;
    this.zoomTarget = target;
    this.duration = duration;
    this.elapsed = 0;
    this.easing = easing ?? LINEAR_EASING;
    this.zooming = true;
  }

  update(dt: number): void {
    if (!this.zooming) return;

    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.cam.zoom = this.zoomTarget;
      this.zooming = false;
      return;
    }

    const rawT = this.elapsed / this.duration;
    const easedT = this.easing(rawT);
    this.cam.zoom = this.zoomFrom + (this.zoomTarget - this.zoomFrom) * easedT;
  }

  serialize(): CameraZoomData | null {
    if (this.zooming && this.easing !== LINEAR_EASING) {
      return null;
    }
    return {
      zoomFrom: this.zoomFrom,
      zoomTarget: this.zoomTarget,
      duration: this.duration,
      elapsed: this.elapsed,
      zooming: this.zooming,
    };
  }

  static fromSnapshot(data: CameraZoomData): CameraZoom {
    const zoom = new CameraZoom();
    zoom.zoomFrom = data.zoomFrom;
    zoom.zoomTarget = data.zoomTarget;
    zoom.duration = data.duration;
    zoom.elapsed = data.elapsed;
    zoom.zooming = data.zooming;
    zoom.easing = LINEAR_EASING;
    return zoom;
  }
}
