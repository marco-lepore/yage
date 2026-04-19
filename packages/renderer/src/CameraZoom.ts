import { Component } from "@yagejs/core";
import type { EasingFunction } from "@yagejs/core";
import { CameraComponent } from "./CameraComponent.js";

/**
 * Camera zoom animation behavior. Smoothly interpolates
 * `CameraComponent.zoom` toward a target value over a duration.
 */
export class CameraZoom extends Component {
  private readonly cam = this.sibling(CameraComponent);
  private zoomFrom = 1;
  private zoomTarget = 1;
  private duration = 0;
  private elapsed = 0;
  private easing: EasingFunction = (t) => t;
  private zooming = false;

  /** Start a zoom animation. */
  start(target: number, duration: number, easing?: EasingFunction): void {
    this.zoomFrom = this.cam.zoom;
    this.zoomTarget = target;
    this.duration = duration;
    this.elapsed = 0;
    this.easing = easing ?? ((t) => t);
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
}
