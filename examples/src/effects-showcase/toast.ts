import { Component } from "@yagejs/core";
import type { TextComponent } from "@yagejs/renderer";

/**
 * In-canvas toast: a scene-owned component that reveals its text and hides it
 * after a delay counted in scene time (so it respects pause), instead of a
 * wall-clock setTimeout. It is destroyed with the scene, so no stale timer can
 * fire against a torn-down component.
 */
export class Toast extends Component {
  private remaining = 0;

  constructor(private readonly text: TextComponent) {
    super();
  }

  show(msg: string, seconds = 1.5): void {
    this.text.setText(msg);
    this.text.visible = true;
    this.remaining = seconds;
  }

  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= dt;
    if (this.remaining <= 0) this.text.visible = false;
  }
}

let toast: Toast | undefined;

/** Point showToast at the scene's toast component. Called once from the scene. */
export function bindToast(t: Toast): void {
  toast = t;
}

/** Flash a transient message, hidden again after 1.5s of scene time. */
export function showToast(msg: string): void {
  toast?.show(msg);
}
