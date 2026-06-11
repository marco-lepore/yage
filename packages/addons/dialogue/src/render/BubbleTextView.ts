/**
 * A {@link DialogueTextView} that lays its body text inside a diegetic bubble
 * and follows the speaking actor: on each line it resolves the speaker's
 * {@link DialogueActor} via the registry and points the view's origin provider
 * at that actor's head anchor (offset to the bubble's inner top-left). All the
 * typewriter/effect/markup machinery is inherited unchanged.
 */

import type { Scene } from "@yagejs/core";
import { actorRegistryFor } from "../actor/index.js";
import type { PresentedLine } from "../core/session.js";
import { bubbleSize } from "./bubbleSizing.js";
import {
  DialogueTextView,
  type DialogueTextConfig,
} from "./DialogueTextView.js";

export interface BubbleTextLayout {
  /** Snuggest width; the bubble widens to its text up to {@link maxWidth}. */
  readonly minWidth: number;
  /** Widest the bubble grows before its text wraps to more lines. */
  readonly maxWidth: number;
  /** Minimum bubble height (px); the text origin tracks the grown size. */
  readonly height: number;
  readonly padding: number;
  readonly offsetY: number;
}

export class BubbleTextView extends DialogueTextView {
  private sceneRef?: Scene;
  /** Body-text metrics, kept so the bubble can size to its wrapped text (the
   *  base `cfg` is private to `DialogueTextView`). Must match what the companion
   *  `BubbleChrome` measures with. */
  private readonly body: {
    readonly textSize: number;
    readonly lineHeight: number;
    readonly fontFamily?: string | undefined;
    readonly bitmapFont?: string | undefined;
  };

  constructor(
    cfg: Omit<DialogueTextConfig, "box">,
    private readonly bubble: BubbleTextLayout,
  ) {
    super({
      ...cfg,
      // Initial wrap width; updated per line in present() as the bubble widens.
      box: { x: 0, y: 0, width: bubble.maxWidth - 2 * bubble.padding },
    });
    this.body = {
      textSize: cfg.size,
      lineHeight: cfg.lineHeight,
      fontFamily: cfg.fontFamily,
      bitmapFont: cfg.bitmapFont,
    };
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
    // Size to the same width + height the chrome draws this line at, so the text
    // sits inside the (content-sized) bubble. Update the wrap width too — the
    // bubble may have widened/narrowed for this line.
    const plain = line.text.runs.map((r) => r.text).join("");
    const size = bubbleSize(plain, {
      minWidth: b.minWidth,
      maxWidth: b.maxWidth,
      padding: b.padding,
      minHeight: b.height,
      textSize: this.body.textSize,
      lineHeight: this.body.lineHeight,
      fontFamily: this.body.fontFamily,
      bitmapFont: this.body.bitmapFont,
    });
    this.setBox(0, 0, size.width - 2 * b.padding);
    this.setOrigin(
      actor
        ? () => {
            const a = actor.anchorWorld();
            return {
              x: a.x - size.width / 2 + b.padding,
              y: a.y - (b.offsetY + size.height) + b.padding,
            };
          }
        : undefined,
    );
    super.present(line);
  }
}
