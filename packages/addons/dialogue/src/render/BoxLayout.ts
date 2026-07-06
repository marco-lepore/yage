/**
 * BoxLayout — the single per-line geometry owner for the bottom-box coordinate
 * model (the box half of the "layout owner"). One instance is shared by the box
 * chrome, the box text view, the box choice list, and an in-box avatar
 * presenter, so the **frame, nameplate, prompt, and choice rows move and grow as
 * ONE coherent panel** instead of each presenter holding its own copy.
 *
 * It owns three things the presenters would otherwise compute independently:
 *
 *  - **Per-line position** — `meta.position` (`top|center|bottom`) places the
 *    frame within the design viewport (the renderer's `virtualSize`, bound at
 *    mount via {@link setViewport}); the frame AND the text region move together.
 *    The box is a full-width bottom bar resolved from viewport-relative margins,
 *    so the default presenter works at any resolution with no override.
 *  - **Unified panel grow** — for a choice, the frame grows to fit the nameplate
 *    + prompt + rows; the row rects are stacked inside it (see
 *    `stackChoiceRows`). Growing is bottom-anchored at "bottom", so the frame top
 *    rises and the chrome/nameplate/prompt follow.
 *  - **Inset registry** — a presenter reserves a left/right column; the text
 *    region subtracts it so the body text reflows around it (the reference
 *    in-box avatar registers one).
 *
 * Presenters call {@link onChange} to re-place when the committed frame changes
 * (a choice grows the frame after the chrome/text already presented).
 */

import { measureWrappedText } from "@yagejs/renderer";
import type { BoxBounds } from "../factory/theme.js";
import type { PresentedLine } from "../core/session.js";

/** RPG-Maker-style vertical placement of the box within the field. */
export type BoxPosition = "top" | "center" | "bottom";

/** A reserved column the body text reflows around (the avatar-reflow seam). */
export interface TextInset {
  readonly side: "left" | "right";
  readonly width: number;
}

/** A laid-out rectangle (screen px). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A choice row's screen rect — shared by placement, highlight, and hit-test. */
export interface ChoiceRowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BoxLayoutConfig {
  /** Viewport-relative box bounds (margins + height); the frame is resolved
   *  against the design viewport set by {@link BoxLayout.setViewport} at mount. */
  readonly box: BoxBounds;
  readonly padding: number;
  /** Nameplate band height (theme.nameSize) — body text starts below it. */
  readonly nameSize: number;
  /** Body text metrics — for measuring an optional choice prompt's height. */
  readonly textSize: number;
  readonly lineHeight: number;
  /** Vertical gap between choice rows (for the grown panel). */
  readonly choiceGap: number;
  readonly fontFamily?: string | undefined;
  readonly bitmapFont?: string | undefined;
}

/** Gap (px) between the nameplate band and the body text — matches the box text
 *  region the box dialogue used before the owner existed. */
const TEXT_GAP = 4;

/**
 * Stack choice-row slots bottom-up inside `box`, growing **upward** from the
 * bottom edge. `rowHeights` are full slot heights (wrapped text height + gap).
 * Rows are always contiguous and non-overlapping. Inside a frame the owner grew
 * to fit, the topmost row lands right below the prompt; in a too-tall menu the
 * excess spills off the top (the soft-cap advisory flags that). The single
 * source of row geometry: placement, highlight, and hit-test all consume it.
 */
export function stackChoiceRows(
  rowHeights: readonly number[],
  box: Rect,
  padding: number,
): ChoiceRowRect[] {
  const x = box.x + padding;
  const width = box.width - 2 * padding;
  const rects: ChoiceRowRect[] = [];
  let bottom = box.y + box.height - padding;
  for (let i = rowHeights.length - 1; i >= 0; i--) {
    const h = rowHeights[i] ?? 0;
    bottom -= h;
    rects[i] = { x, y: bottom, width, height: h };
  }
  return rects;
}

export class BoxLayout {
  /** Design viewport (the renderer's `virtualSize`) the box is placed within —
   *  bound at mount via {@link setViewport}. Defaults to a sane size so headless
   *  use (no renderer) and pre-mount calls still produce a valid frame. */
  private viewW = 800;
  private viewH = 600;
  private readonly insets = new Map<string, TextInset>();
  private readonly listeners: Array<() => void> = [];
  /** The committed frame — moved by `meta.position`, grown for a choice. */
  private frame: Rect;
  /** The line currently laid out (for the choice panel's prompt + nameplate). */
  private line: PresentedLine | undefined;

  constructor(private readonly cfg: BoxLayoutConfig) {
    this.frame = this.frameAt("bottom", cfg.box.height);
  }

  /**
   * Bind the design viewport (the renderer's `virtualSize`), read at mount, so
   * the box is a full-width bottom bar at any resolution and `meta.position`
   * places the frame against the true screen. Recomputes the resting frame.
   */
  setViewport(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.commit(this.frameAt(positionOf(this.line), this.cfg.box.height));
  }

  /** Register a callback fired when the committed frame changes (a choice grows
   *  it, or an inset reflows the text) — the chrome redraws, the text re-places.
   *  Returns an unsubscribe; presenters call it in `dispose()` so a disposed
   *  presenter can't be re-placed against a retained layout. */
  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  /** The frame rect for the current line (read by the chrome to draw + place). */
  frameRect(): Rect {
    return this.frame;
  }

  /** Inner content width — choice rows wrap to this. Frame minus padding minus
   *  any registered insets, so choices reflow around an in-box avatar the same
   *  way the body text does. */
  contentWidth(): number {
    return (
      this.viewW -
      2 * this.cfg.box.marginX -
      2 * this.cfg.padding -
      this.insetWidth("left") -
      this.insetWidth("right")
    );
  }

  /** Inner padding between the frame and its contents — an in-box presenter
   *  aligns its column to this so it sits inside the border, like the text. */
  padding(): number {
    return this.cfg.padding;
  }

  /** Lay out a say/prompt line: place the base-height frame at its
   *  `meta.position`. Commits the frame (firing {@link onChange} if it moved). */
  layoutLine(line: PresentedLine | undefined): Rect {
    this.line = line;
    this.commit(this.frameAt(positionOf(line), this.cfg.box.height));
    return this.frame;
  }

  /**
   * Grow the frame to fit a choice: nameplate band + optional prompt + the
   * rows, capped at the field. Commits the grown frame (firing {@link onChange}
   * so the chrome/nameplate/prompt follow) and returns the row rects stacked
   * inside it.
   */
  layoutChoicePanel(rowHeights: readonly number[]): ChoiceRowRect[] {
    const promptH = this.promptHeight();
    const headH = promptH > 0 ? promptH + this.cfg.choiceGap : 0;
    const rows = rowHeights.reduce((a, h) => a + h, 0);
    const content =
      this.cfg.padding + this.bodyOffset() + headH + rows + this.cfg.padding;
    const maxH = this.viewH - 2 * this.cfg.box.marginY; // cap at the screen (minus margins)
    const height = Math.min(Math.max(this.cfg.box.height, content), maxH);
    this.commit(this.frameAt(positionOf(this.line), height));
    // Stack the rows inside the inset-narrowed region, so they reflow around an
    // in-box avatar exactly like the prompt + body text above them.
    const insetL = this.insetWidth("left");
    const insetR = this.insetWidth("right");
    const inner: Rect = {
      x: this.frame.x + insetL,
      y: this.frame.y,
      width: this.frame.width - insetL - insetR,
      height: this.frame.height,
    };
    return stackChoiceRows(rowHeights, inner, this.cfg.padding);
  }

  /** Body-text region inside the current frame: below the nameplate band, inset
   *  by padding, minus any registered insets (so text reflows around an avatar).
   *  For a choice, this is the prompt region above the rows. */
  textRegion(): { x: number; y: number; width: number } {
    let x = this.frame.x + this.cfg.padding;
    let width = this.frame.width - 2 * this.cfg.padding;
    for (const inset of this.insets.values()) {
      width -= inset.width;
      if (inset.side === "left") x += inset.width;
    }
    return { x, y: this.frame.y + this.cfg.padding + this.bodyOffset(), width };
  }

  /** Top-left of the nameplate inside the current frame. */
  nameplatePos(): { x: number; y: number } {
    return { x: this.frame.x + this.cfg.padding, y: this.frame.y + this.cfg.padding - 1 };
  }

  /** Bottom-right continue-caret position inside the current frame. */
  caretPos(size: { width: number; height: number }): { x: number; y: number } {
    return {
      x: this.frame.x + this.frame.width - this.cfg.padding - size.width,
      y: this.frame.y + this.frame.height - this.cfg.padding - size.height - 1,
    };
  }

  /**
   * Reserve (or clear with `undefined`) a left/right column the body text
   * reflows around — the avatar-reflow seam. The reference in-box avatar
   * presenter registers one keyed by its own id. Fires {@link onChange} so a
   * text view already showing this line reflows.
   */
  setInset(key: string, inset: TextInset | undefined): void {
    const prev = this.insets.get(key);
    if (inset) this.insets.set(key, inset);
    else this.insets.delete(key);
    if (!sameInset(prev, inset)) this.notify();
  }

  /** The reserved width on a side (0 if none) — an avatar presenter reads it to
   *  place itself in the column it reserved. */
  insetWidth(side: "left" | "right"): number {
    let w = 0;
    for (const inset of this.insets.values()) if (inset.side === side) w += inset.width;
    return w;
  }

  /** Distance from the frame top to the body text (nameplate band + gap). */
  private bodyOffset(): number {
    return this.cfg.nameSize + TEXT_GAP;
  }

  /** Measure the current choice line's prompt (0 when there is none). */
  private promptHeight(): number {
    const text = this.line?.text;
    if (!text || text.length === 0) return 0;
    const plain = text.runs.map((r) => r.text).join("");
    const font = this.cfg.bitmapFont ?? this.cfg.fontFamily;
    const measured = measureWrappedText(plain, {
      fontSize: this.cfg.textSize,
      lineHeight: this.cfg.lineHeight,
      wordWrapWidth: this.textRegion().width,
      ...(font !== undefined ? { fontFamily: font } : {}),
      ...(this.cfg.bitmapFont !== undefined ? { bitmap: true } : {}),
    });
    return measured.height;
  }

  /** Place a full-width frame of `height` at `position` within the design
   *  viewport: `bottom` anchors `marginY` from the bottom edge, `top` mirrors it
   *  to the top, `center` centres. The width is the viewport minus side margins. */
  private frameAt(position: BoxPosition, height: number): Rect {
    const { marginX, marginY } = this.cfg.box;
    let y: number;
    if (position === "top") y = marginY;
    else if (position === "center") y = (this.viewH - height) / 2;
    else y = this.viewH - marginY - height; // bottom (resting)
    return { x: marginX, y, width: this.viewW - 2 * marginX, height };
  }

  private commit(frame: Rect): void {
    if (sameRect(this.frame, frame)) return;
    this.frame = frame;
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

/** A line's `meta.position`, defaulting to `bottom` (the resting box). */
function positionOf(line: PresentedLine | undefined): BoxPosition {
  const p = line?.meta?.["position"];
  return p === "top" || p === "center" ? p : "bottom";
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sameInset(a: TextInset | undefined, b: TextInset | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.side === b.side && a.width === b.width;
}
