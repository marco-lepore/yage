/**
 * Routes each line to one of two text presenters by its `view` hint — e.g. a
 * narrator's `view:"box"` types in the bottom box while NPC lines (`"bubble"`)
 * float over their heads, all in one conversation. The inactive presenter is
 * cleared so only one shows at a time. Reveal state + skip/fast-forward proxy
 * to whichever is active; both are ticked each frame.
 */

import type { Scene } from "@yagejs/core";
import type { PresentedLine } from "../core/session.js";
import type { TextPresenter } from "../chrome/DialogueUiAdapter.js";

export class CompositeTextPresenter implements TextPresenter {
  private active?: TextPresenter | undefined;
  onRevealComplete?: () => void;

  /** `route(view)` picks a presenter; default routes "bubble" → bubble, else box. */
  constructor(
    private readonly box: TextPresenter,
    private readonly bubble: TextPresenter,
    private readonly route: (view: string | undefined) => "box" | "bubble" = (v) =>
      v === "bubble" ? "bubble" : "box",
  ) {
    this.box.onRevealComplete = () => this.onRevealComplete?.();
    this.bubble.onRevealComplete = () => this.onRevealComplete?.();
  }

  mount(scene: Scene): void {
    this.box.mount(scene);
    this.bubble.mount(scene);
  }

  present(line: PresentedLine): void {
    const target = this.route(line.view) === "bubble" ? this.bubble : this.box;
    const other = target === this.box ? this.bubble : this.box;
    other.clear();
    this.active = target;
    target.present(line);
  }

  // ── glossary-term seam: forward to whichever sub-view is active, so a box
  //    term works while a box line shows and a bubble term while a bubble shows.
  get pointerSpace(): "screen" | "world" {
    return this.active?.pointerSpace ?? "screen";
  }
  termAtPoint(x: number, y: number): string | undefined {
    return this.active?.termAtPoint?.(x, y);
  }
  setHoveredTerm(id: string | undefined): void {
    this.active?.setHoveredTerm?.(id);
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
    this.active?.setSpeedMultiplier(multiplier);
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
