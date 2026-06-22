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

/** A reserved portrait column INSIDE the bubble: the bubble grows to contain it
 *  and the body text reflows past it (the in-bubble avatar registers one). */
export interface BubblePortraitInset {
  readonly side: "left" | "right";
  /** Full reserved column width (portrait + gap), px. */
  readonly width: number;
  /** Min content height the bubble clears for the portrait, px. */
  readonly height: number;
}

export class BubbleLayout {
  private readonly anchors: BubbleAnchorResolver;
  /** One-line memo: the session presents one line to chrome then text, so a
   *  one-deep cache makes the second `sizeFor` free (no redundant measure pass). */
  private memoLine: PresentedLine | undefined;
  private memoSize: BubbleSize | undefined;
  /** Reserved portrait column for the current line (set by the in-bubble avatar
   *  before the chrome/text present). */
  private inset: BubblePortraitInset | undefined;

  constructor(private readonly cfg: BubbleLayoutConfig) {
    this.anchors = new BubbleAnchorResolver(cfg.fallbackAnchor);
  }

  /** Reserve (or clear with `undefined`) a portrait column inside the bubble.
   *  The bubble then grows to contain it and the text wraps to the narrowed
   *  column; the avatar sets this per line before the chrome/text present. */
  setPortraitInset(inset: BubblePortraitInset | undefined): void {
    this.inset = inset;
    this.memoLine = undefined; // re-measure with the new reserve
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

  /** Outer bubble size to fit this line's text (+ a reserved portrait column,
   *  if one is registered) — measured once, then memoized for the companion
   *  presenter's read of the same line. */
  sizeFor(line: PresentedLine): BubbleSize {
    if (line === this.memoLine && this.memoSize) return this.memoSize;
    const plain = line.text.runs.map((r) => r.text).join("");
    const reserve = this.inset?.width ?? 0;
    // Measure the text in the column left of the portrait, so the FULL bubble
    // (text + portrait column) still caps at maxWidth.
    const textSize = bubbleSize(plain, {
      minWidth: this.cfg.minWidth,
      maxWidth: Math.max(this.cfg.minWidth, this.cfg.maxWidth - reserve),
      padding: this.cfg.padding,
      minHeight: this.cfg.height,
      textSize: this.cfg.textSize,
      lineHeight: this.cfg.lineHeight,
      fontFamily: this.cfg.fontFamily,
      bitmapFont: this.cfg.bitmapFont,
    });
    const size: BubbleSize = {
      width: textSize.width + reserve,
      height: Math.max(textSize.height, (this.inset?.height ?? 0) + 2 * this.cfg.padding),
    };
    this.memoLine = line;
    this.memoSize = size;
    return size;
  }

  /** Body-text wrap width inside the bubble — the inner width minus the
   *  reserved portrait column (so the text reflows past an in-bubble avatar). */
  textWrapWidth(size: BubbleSize): number {
    return size.width - 2 * this.cfg.padding - (this.inset?.width ?? 0);
  }

  /** World anchor for a speaker: a live {@link DialogueActor}'s head, else the
   *  last-known / fallback position (and a once-per-speaker warning). Shared by
   *  all three bubble presenters so they track the same actor. */
  anchorFor(scene: Scene, speakerId: string | undefined): AnchorPoint {
    return this.anchors.resolve(scene, speakerId);
  }

  /** Inner top-left a content-sized bubble's body sits at, from the speaker
   *  anchor + the bubble size (the once-derived origin formula). Shifts past a
   *  left-side portrait column so the text reflows beside it. */
  originFor(anchor: AnchorPoint, size: BubbleSize): { x: number; y: number } {
    let x = anchor.x - size.width / 2 + this.cfg.padding;
    if (this.inset?.side === "left") x += this.inset.width;
    return { x, y: anchor.y - (this.cfg.offsetY + size.height) + this.cfg.padding };
  }
}
