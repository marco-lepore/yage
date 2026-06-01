/**
 * A {@link DialogueTextView} that lays its body text inside a diegetic bubble
 * and follows the speaking actor: on each line it resolves the speaker's
 * {@link DialogueActor} via the registry and points the view's origin provider
 * at that actor's head anchor (offset to the bubble's inner top-left). All the
 * typewriter/effect/markup/term machinery is inherited unchanged.
 */

import type { Scene } from "@yagejs/core";
import { actorRegistryFor } from "../actor/index.js";
import type { PresentedLine } from "../core/session.js";
import {
  DialogueTextView,
  type DialogueTextConfig,
} from "./DialogueTextView.js";

export interface BubbleTextLayout {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  readonly offsetY: number;
}

export class BubbleTextView extends DialogueTextView {
  /** Body text follows a world-anchored origin, so term hit-tests come in world
   *  coords (the pointer binding picks the world pointer for "world" presenters). */
  override readonly pointerSpace = "world" as const;

  private sceneRef?: Scene;
  /** Current bubble top-left in world coords (term boxes are resting-relative). */
  private originX = 0;
  private originY = 0;

  constructor(
    cfg: Omit<DialogueTextConfig, "box">,
    private readonly bubble: BubbleTextLayout,
  ) {
    super({
      ...cfg,
      box: { x: 0, y: 0, width: bubble.width - 2 * bubble.padding },
    });
  }

  override mount(scene: Scene): void {
    super.mount(scene);
    this.sceneRef = scene;
  }

  override present(line: PresentedLine): void {
    const actor = this.sceneRef
      ? actorRegistryFor(this.sceneRef).resolve(line.speaker?.id)
      : undefined;
    const b = this.bubble;
    this.setOrigin(
      actor
        ? () => {
            const a = actor.anchorWorld();
            const o = {
              x: a.x - b.width / 2 + b.padding,
              y: a.y - (b.offsetY + b.height) + b.padding,
            };
            this.originX = o.x;
            this.originY = o.y;
            return o;
          }
        : undefined,
    );
    // No actor → text pins at the layout origin (0,0); clear any stale anchor so
    // `termAtPoint` (world space) doesn't subtract a previous line's origin.
    if (!actor) {
      this.originX = 0;
      this.originY = 0;
    }
    super.present(line);
  }

  /** Term hit-boxes are captured in resting (box 0,0) coords; the bubble follows
   *  a world origin, so translate the world point back before delegating. */
  override termAtPoint(x: number, y: number): string | undefined {
    return super.termAtPoint(x - this.originX, y - this.originY);
  }
}
