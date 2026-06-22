/**
 * Chrome counterpart to {@link CompositeTextPresenter}: shows the box frame for
 * box lines and the bubble for bubble lines, hiding the other. The Session
 * calls `setNameplate`/`setContinueVisible` *before* `present`, so those are
 * buffered and applied to whichever variant `present` then selects.
 *
 * Visibility is owned by the Session: it calls `setVisible(bool)`
 * after each transition, and this composite restores **only the active variant**
 * on show. `active` is therefore RETAINED across a hide (a cutscene
 * mid-bubble-line shows the bubble again, not an empty box).
 */

import type { Scene } from "@yagejs/core";
import type { PresentedLine } from "../core/session.js";
import type { ChromePresenter } from "../chrome/DialogueUiAdapter.js";
import { makeDefaultRoute, lineRoutesToBubble, type MountRoute } from "./route.js";

export class CompositeChrome implements ChromePresenter {
  private active?: ChromePresenter | undefined;
  private pendingName: { name?: string | undefined; color?: number | undefined } = {};
  private pendingContinue = false;
  /** Master gate from the Session's setVisible — composed with the active
   *  variant's own content state. Hidden at mount. */
  private visible = false;

  constructor(
    private readonly box: ChromePresenter,
    private readonly bubble: ChromePresenter,
    private readonly routing: MountRoute = makeDefaultRoute(),
  ) {}

  mount(scene: Scene): void {
    this.routing.bind(scene); // resolve the default route's actor lookup
    this.box.mount(scene);
    this.bubble.mount(scene);
    this.box.setVisible(false);
    this.bubble.setVisible(false);
  }

  setDiagnostics(warn: (message: string) => void): void {
    this.box.setDiagnostics?.(warn);
    this.bubble.setDiagnostics?.(warn);
  }

  setNameplate(name: string | undefined, color?: number): void {
    // Buffer for whichever variant `present` selects, and forward to the active
    // one. `undefined` means "no name" — NOT a hide-all (that overload died).
    this.pendingName = { name, color };
    this.active?.setNameplate(name, color);
  }

  setContinueVisible(visible: boolean): void {
    // Remember the latest caret intent so a hide/show round-trip can re-apply it
    // to the restored variant (the buffered-caret path), and forward it now.
    this.pendingContinue = visible;
    this.active?.setContinueVisible(visible);
  }

  present(line: PresentedLine | undefined): void {
    if (line === undefined) {
      // "No line" — clear the active variant's content; the Session hides via
      // setVisible. Keep `active` so a later show restores the right variant.
      this.active?.present?.(undefined);
      return;
    }
    const target = lineRoutesToBubble(this.routing.route, line) ? this.bubble : this.box;
    const other = target === this.box ? this.bubble : this.box;
    other.setVisible(false);

    this.active = target;
    target.setNameplate(this.pendingName.name, this.pendingName.color);
    target.setContinueVisible(this.pendingContinue);
    target.present?.(line);
    // Reflect the current master gate immediately (the Session also calls
    // setVisible right after — idempotent).
    target.setVisible(this.visible);
  }

  /** Show/hide the chrome. On show, restore ONLY the active variant
   *  and re-apply the buffered caret; the other stays hidden. On hide, hide both
   *  but RETAIN `active` so the next show brings back the right one. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      if (this.active) {
        const other = this.active === this.box ? this.bubble : this.box;
        other.setVisible(false);
        this.active.setContinueVisible(this.pendingContinue);
        this.active.setVisible(true);
      }
    } else {
      this.box.setVisible(false);
      this.bubble.setVisible(false);
    }
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
