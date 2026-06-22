/**
 * Routes the avatar to a box-side or bubble-side presenter per line, the avatar
 * counterpart to {@link CompositeChrome} / {@link CompositeTextPresenter} /
 * {@link CompositeChoicePresenter}. It consults the SAME {@link MountRoute} the
 * other composites do, so a line's avatar lands on the same side as its chrome
 * and text. The non-routed presenter is cleared (`present(undefined)`), so only
 * one portrait shows at a time. The speaker-def + visibility verbs forward to
 * both (they are cheap and idempotent).
 */

import type { Scene } from "@yagejs/core";
import type { AvatarPresenter } from "../avatar/AvatarPresenter.js";
import type { PresentedLine } from "../core/session.js";
import type { SpeakerDef } from "../core/types.js";
import { lineRoutesToBubble, type MountRoute } from "./route.js";

export class CompositeAvatarPresenter implements AvatarPresenter {
  constructor(
    private readonly box: AvatarPresenter,
    private readonly bubble: AvatarPresenter,
    private readonly routing: MountRoute,
  ) {}

  mount(scene: Scene): void {
    this.routing.bind(scene);
    this.box.mount(scene);
    this.bubble.mount(scene);
  }

  setSpeaker(speaker: SpeakerDef | undefined): void {
    this.box.setSpeaker(speaker);
    this.bubble.setSpeaker(speaker);
  }

  setExpression(expression: string | undefined): void {
    this.box.setExpression(expression);
    this.bubble.setExpression(expression);
  }

  setSpeaking(speaking: boolean): void {
    this.box.setSpeaking(speaking);
    this.bubble.setSpeaking(speaking);
  }

  present(line: PresentedLine | undefined): void {
    if (line === undefined) {
      this.box.present?.(undefined);
      this.bubble.present?.(undefined);
      return;
    }
    const toBubble = lineRoutesToBubble(this.routing.route, line);
    const active = toBubble ? this.bubble : this.box;
    const other = toBubble ? this.box : this.bubble;
    other.present?.(undefined); // clear the variant this line doesn't use
    active.present?.(line);
  }

  setVisible(visible: boolean): void {
    this.box.setVisible?.(visible);
    this.bubble.setVisible?.(visible);
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
