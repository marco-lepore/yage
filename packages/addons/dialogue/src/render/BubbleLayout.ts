/**
 * BubbleLayout — the single per-line geometry owner for the speech-bubble
 * coordinate model (the bubble half of the "layout owner"). One instance is
 * injected into `BubbleChrome`, `BubbleTextView`, and `BubbleChoicePresenter` so
 * they can no longer drift: the bubble outer size is measured **once** per line
 * (memoized — the session always calls `chrome.present` then `text.present` with
 * the same line object, so the second read is free), the missing-actor anchor
 * policy lives in ONE {@link BubbleAnchorResolver}, and the anchor→inner-top-left
 * origin formula exists once.
 *
 * It owns the bubble *geometry* (sizing inputs + padding/offsetY); the
 * presenters keep only their drawing config (colours, tail, caret).
 */

import type { Scene } from "@yagejs/core";
import { BubbleAnchorResolver, type AnchorPoint } from "./bubbleAnchor.js";
import { bubbleSize, type BubbleSize } from "./bubbleSizing.js";
import type { DiagnosticSink } from "../chrome/DialogueUiAdapter.js";
import type { PresentedLine } from "../core/session.js";

export interface BubbleLayoutConfig {
  /** Snuggest width; the bubble widens to its text up to {@link maxWidth}. */
  readonly minWidth: number;
  /** Widest the bubble grows before its text wraps to more lines. */
  readonly maxWidth: number;
  /** Minimum bubble height (px); grows past this to fit wrapped text. */
  readonly height: number;
  readonly padding: number;
  /** Gap between the actor's head anchor and the bubble's bottom edge. */
  readonly offsetY: number;
  /** Body-text metrics the size measures with (the text view wraps to the same). */
  readonly textSize: number;
  readonly lineHeight: number;
  readonly fontFamily?: string | undefined;
  readonly bitmapFont?: string | undefined;
  /** Anchor for a missing/absent speaker with no last-known position. Default
   *  world origin; point it at the camera centre for a pure-bubble bundle that
   *  shows narrator lines. */
  readonly fallbackAnchor?: (() => AnchorPoint) | undefined;
}

export class BubbleLayout {
  private readonly anchors: BubbleAnchorResolver;
  /** One-line memo: the session presents one line to chrome then text, so a
   *  one-deep cache makes the second `sizeFor` free (no redundant measure pass). */
  private memoLine: PresentedLine | undefined;
  private memoSize: BubbleSize | undefined;

  constructor(private readonly cfg: BubbleLayoutConfig) {
    this.anchors = new BubbleAnchorResolver(cfg.fallbackAnchor);
  }

  /** Inner padding (px) — the presenters position the name/caret/text by it. */
  get padding(): number {
    return this.cfg.padding;
  }

  /** Gap between the speaker anchor and the bubble's bottom edge (px). */
  get offsetY(): number {
    return this.cfg.offsetY;
  }

  /** Wire the missing-actor warning to the engine Logger (the controller's sink). */
  setDiagnostics(warn: DiagnosticSink): void {
    this.anchors.setDiagnostics(warn);
  }

  /** Outer bubble size to fit this line's text — measured once, then memoized
   *  for the companion presenter's read of the same line. */
  sizeFor(line: PresentedLine): BubbleSize {
    if (line === this.memoLine && this.memoSize) return this.memoSize;
    const plain = line.text.runs.map((r) => r.text).join("");
    const size = bubbleSize(plain, {
      minWidth: this.cfg.minWidth,
      maxWidth: this.cfg.maxWidth,
      padding: this.cfg.padding,
      minHeight: this.cfg.height,
      textSize: this.cfg.textSize,
      lineHeight: this.cfg.lineHeight,
      fontFamily: this.cfg.fontFamily,
      bitmapFont: this.cfg.bitmapFont,
    });
    this.memoLine = line;
    this.memoSize = size;
    return size;
  }

  /** World anchor for a speaker: a live {@link DialogueActor}'s head, else the
   *  last-known / fallback position (and a once-per-speaker warning). Shared by
   *  all three bubble presenters so they track the same actor. */
  anchorFor(scene: Scene, speakerId: string | undefined): AnchorPoint {
    return this.anchors.resolve(scene, speakerId);
  }

  /** Inner top-left a content-sized bubble's body sits at, from the speaker
   *  anchor + the bubble size (the once-derived origin formula). */
  originFor(anchor: AnchorPoint, size: BubbleSize): { x: number; y: number } {
    return {
      x: anchor.x - size.width / 2 + this.cfg.padding,
      y: anchor.y - (this.cfg.offsetY + size.height) + this.cfg.padding,
    };
  }
}
