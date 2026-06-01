/**
 * Chrome counterpart to {@link CompositeTextPresenter}: shows the box frame for
 * box lines and the bubble for bubble lines, hiding the other. The Session
 * calls `setNameplate`/`setContinueVisible` *before* `present`, so those are
 * buffered and applied to whichever variant `present` then selects.
 */

import type { Scene } from "@yagejs/core";
import type { PresentedLine } from "../core/session.js";
import type { ChromePresenter } from "../chrome/DialogueUiAdapter.js";

export class CompositeChrome implements ChromePresenter {
  private active?: ChromePresenter | undefined;
  private pendingName: { name?: string | undefined; color?: number | undefined } = {};
  private pendingContinue = false;

  constructor(
    private readonly box: ChromePresenter,
    private readonly bubble: ChromePresenter,
    private readonly route: (view: string | undefined) => "box" | "bubble" = (v) =>
      v === "bubble" ? "bubble" : "box",
  ) {}

  mount(scene: Scene): void {
    this.box.mount(scene);
    this.bubble.mount(scene);
    this.box.setVisible(false);
    this.bubble.setVisible(false);
  }

  setNameplate(name: string | undefined, color?: number): void {
    this.pendingName = { name, color };
    if (name === undefined) {
      // Conversation end / no speaker → hide everything.
      this.box.setVisible(false);
      this.bubble.setVisible(false);
      this.active = undefined;
    }
  }

  setContinueVisible(visible: boolean): void {
    if (this.active) this.active.setContinueVisible(visible);
    else this.pendingContinue = visible;
  }

  present(line: PresentedLine | undefined): void {
    const target = this.route(line?.view) === "bubble" ? this.bubble : this.box;
    const other = target === this.box ? this.bubble : this.box;
    other.setVisible(false);

    this.active = target;
    target.setVisible(true);
    target.setNameplate(this.pendingName.name, this.pendingName.color);
    target.setContinueVisible(this.pendingContinue);
    target.present?.(line);
    this.pendingContinue = false;
  }

  setVisible(visible: boolean): void {
    this.box.setVisible(visible);
    this.bubble.setVisible(visible);
    if (!visible) this.active = undefined;
  }

  update(dt: number): void {
    this.box.update(dt);
    this.bubble.update(dt);
  }

  dispose(): void {
    this.box.dispose();
    this.bubble.dispose();
  }
}
