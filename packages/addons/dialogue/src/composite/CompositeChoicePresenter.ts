/**
 * Routes a choice list to the box list or a bubble panel by its
 * `context.view` — the choice counterpart to {@link CompositeTextPresenter} /
 * {@link CompositeChrome}. A box choice keeps the framed bottom list; a
 * `view:"bubble"` choice gets its own panel over the actor (so it never relies
 * on the box frame, which the composite chrome hides for bubble lines).
 */

import type { Scene } from "@yagejs/core";
import type { ChoiceContext, PresentedChoice } from "../core/session.js";
import type { ChoicePresenter } from "../chrome/DialogueUiAdapter.js";
import { choiceRoutesToBubble, defaultCompositeRoute, type CompositeRoute } from "./route.js";

export class CompositeChoicePresenter implements ChoicePresenter {
  private active?: ChoicePresenter | undefined;
  /** Master visibility gate from the Session's setVisible. */
  private visible = false;

  onChoiceChosen?: (position: number) => void;

  constructor(
    private readonly box: ChoicePresenter,
    private readonly bubble: ChoicePresenter,
    private readonly route: CompositeRoute = defaultCompositeRoute,
  ) {
    this.box.onChoiceChosen = (p) => this.onChoiceChosen?.(p);
    this.bubble.onChoiceChosen = (p) => this.onChoiceChosen?.(p);
  }

  /** The active list's pointer space (so the binding hit-tests correctly). */
  get pointerSpace(): "screen" | "world" {
    return this.active?.pointerSpace ?? "screen";
  }

  setDiagnostics(warn: (message: string) => void): void {
    this.box.setDiagnostics?.(warn);
    this.bubble.setDiagnostics?.(warn);
  }

  /** Routes to the variant this choice will use, so the Session knows whether
   *  to suppress its chrome/body prompt before `present` picks the active one. */
  ownsPrompt(context?: ChoiceContext): boolean {
    const target = choiceRoutesToBubble(this.route, context) ? this.bubble : this.box;
    return target.ownsPrompt?.(context) ?? false;
  }

  mount(scene: Scene): void {
    this.box.mount(scene);
    this.bubble.mount(scene);
  }

  present(choices: readonly PresentedChoice[], context?: ChoiceContext): void {
    const target = choiceRoutesToBubble(this.route, context) ? this.bubble : this.box;
    const other = target === this.box ? this.bubble : this.box;
    other.clear();
    this.active = target;
    target.present(choices, context);
    target.setVisible(this.visible); // reflect the master gate immediately
  }

  /** Show/hide the choices — forwarded to both (the inactive one is
   *  cleared, so its setVisible is a no-op); state-preserving on the active. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.box.setVisible(visible);
    this.bubble.setVisible(visible);
  }

  highlight(position: number): void {
    this.active?.highlight(position);
  }

  choiceAtPoint(x: number, y: number): number | undefined {
    return this.active?.choiceAtPoint?.(x, y);
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
