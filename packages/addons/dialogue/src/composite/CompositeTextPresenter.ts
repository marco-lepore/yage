/**
 * Routes each line to one of two text presenters by its `view` hint and whether
 * it has a speaker — e.g. a narrator's speakerless line types in the bottom box
 * while NPC `view:"bubble"` lines float over their heads, all in one
 * conversation. The inactive presenter is cleared so only one shows at a time.
 * Reveal state + skip/fast-forward proxy to whichever is active; both are ticked
 * each frame.
 */

import type { Scene } from "@yagejs/core";
import type { PresentedLine } from "../core/session.js";
import type { TextPresenter } from "../chrome/DialogueUiAdapter.js";
import { defaultCompositeRoute, lineRoutesToBubble, type CompositeRoute } from "./route.js";

export class CompositeTextPresenter implements TextPresenter {
  private active?: TextPresenter | undefined;
  private revealListener?: (() => void) | undefined;
  /** Master visibility gate from the Session's setVisible. */
  private visible = false;

  constructor(
    private readonly box: TextPresenter,
    private readonly bubble: TextPresenter,
    private readonly route: CompositeRoute = defaultCompositeRoute,
  ) {
    // Each sub-view's reveal forwards to the Session's listener ONLY when that
    // sub-view is the active one (the F34 composite wrinkle): the inactive view
    // can't fire a stale reveal-completed for a line it isn't showing.
    this.box.setRevealListener(() => this.fireReveal(this.box));
    this.bubble.setRevealListener(() => this.fireReveal(this.bubble));
  }

  /** Register the Session's reveal-completed listener (D4). */
  setRevealListener(listener: (() => void) | undefined): void {
    this.revealListener = listener;
  }

  private fireReveal(view: TextPresenter): void {
    if (this.active === view) this.revealListener?.();
  }

  setDiagnostics(warn: (message: string) => void): void {
    this.box.setDiagnostics?.(warn);
    this.bubble.setDiagnostics?.(warn);
  }

  mount(scene: Scene): void {
    this.box.mount(scene);
    this.bubble.mount(scene);
  }

  present(line: PresentedLine): void {
    const target = lineRoutesToBubble(this.route, line) ? this.bubble : this.box;
    const other = target === this.box ? this.bubble : this.box;
    other.clear();
    this.active = target;
    target.present(line);
    target.setVisible(this.visible); // reflect the master gate immediately
  }

  /** Show/hide the body text (D1) — forwarded to both views (the inactive one is
   *  cleared, so its setVisible is a no-op); state-preserving on the active. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.box.setVisible(visible);
    this.bubble.setVisible(visible);
  }

  completeReveal(): void {
    this.active?.completeReveal();
  }

  isRevealComplete(): boolean {
    return this.active ? this.active.isRevealComplete() : true;
  }

  isRevealing(): boolean {
    return this.active ? this.active.isRevealing() : false;
  }

  setSpeedMultiplier(multiplier: number): void {
    // Both, not just the active view: the inactive one would keep a stale
    // multiplier into its next line (both setters are trivially cheap).
    this.box.setSpeedMultiplier(multiplier);
    this.bubble.setSpeedMultiplier(multiplier);
  }

  update(dt: number): void {
    this.box.update(dt);
    this.bubble.update(dt);
  }

  clear(): void {
    this.box.clear();
    this.bubble.clear();
    this.active = undefined;
  }

  dispose(): void {
    this.box.dispose();
    this.bubble.dispose();
  }
}
