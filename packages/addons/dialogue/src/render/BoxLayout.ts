import { ErrorBoundaryKey, type ErrorBoundary, type Scene } from "@yagejs/core";
import { measureWrappedText, RendererKey } from "@yagejs/renderer";
import type { BoxBounds } from "../factory/theme.js";
import type { PresentedLine } from "../core/session.js";

export type BoxPosition = "top" | "center" | "bottom";

/** A column reserved for an avatar beside the text. */
export interface TextInset {
  readonly side: "left" | "right";
  readonly width: number;
  /** Minimum content height needed by this inset, in virtual pixels. */
  readonly height?: number;
}

/** A rectangle in virtual screen pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Shared geometry for a choice label, highlight, and pointer target. */
export type ChoiceRowRect = Rect;

export interface BoxLayoutConfig {
  readonly box: BoxBounds;
  readonly padding: number;
  /** Nameplate height. Zero reserves no nameplate space. */
  readonly nameSize: number;
  readonly textSize: number;
  readonly lineHeight: number;
  readonly choiceGap: number;
  readonly fontFamily?: string | undefined;
  readonly bitmapFont?: string | undefined;
}

const TEXT_GAP = 4;

/** Stack full row slots from the padded top of a content rectangle. */
export function stackChoiceRows(
  rowHeights: readonly number[],
  box: Rect,
  padding: number,
): ChoiceRowRect[] {
  let y = box.y + padding;
  return rowHeights.map((height) => {
    finiteNonnegative("stackChoiceRows", "row height", height);
    const row = {
      x: box.x + padding,
      y,
      width: box.width - 2 * padding,
      height,
    };
    y += height;
    return row;
  });
}

/** Shared frame and content geometry for box chrome, text, choices and avatars.
 * Bind a viewport with mount(scene) or setViewport before reading geometry. */
export class BoxLayout {
  private viewport: { width: number; height: number } | undefined;
  private frame: Rect | undefined;
  private readonly insets = new Map<string, TextInset>();
  private readonly listeners: Array<() => void> = [];
  private line: PresentedLine | undefined;
  private rowHeights: readonly number[] | undefined;
  private caretHeight = 0;
  private boundary: ErrorBoundary | undefined;

  constructor(private readonly cfg: BoxLayoutConfig) {
    for (const [name, value] of Object.entries({
      marginX: cfg.box.marginX,
      marginY: cfg.box.marginY,
      minHeight: cfg.box.minHeight,
      padding: cfg.padding,
      nameSize: cfg.nameSize,
      textSize: cfg.textSize,
      lineHeight: cfg.lineHeight,
      choiceGap: cfg.choiceGap,
    }))
      finiteNonnegative("BoxLayout", name, value);
  }

  /** Bind the renderer's design viewport. Repeated mounts at the same size retain content. */
  mount(scene: Scene): void {
    this.boundary = scene.context.tryResolve(ErrorBoundaryKey);
    const renderer = scene.context.tryResolve(RendererKey);
    if (renderer)
      this.setViewport(renderer.virtualSize.width, renderer.virtualSize.height);
    else this.requireViewport();
  }

  /** Standalone/headless viewport binding; reflows the current content. */
  setViewport(width: number, height: number): void {
    this.validateViewport(width, height);
    if (this.viewport?.width === width && this.viewport.height === height)
      return;
    this.viewport = { width, height };
    this.reflow(true);
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  frameRect(): Rect {
    this.requireViewport();
    return this.frame!;
  }

  contentWidth(): number {
    return (
      this.requireViewport().width -
      2 * (this.cfg.box.marginX + this.cfg.padding) -
      this.insetWidth("left") -
      this.insetWidth("right")
    );
  }

  padding(): number {
    return this.cfg.padding;
  }

  /** Reserve a continue-indicator footer for say lines before reveal begins. */
  setCaretHeight(height: number): void {
    finiteNonnegative("BoxLayout.setCaretHeight", "height", height);
    if (this.caretHeight === height) return;
    this.caretHeight = height;
    if (this.viewport) this.reflow(true);
  }

  /** Fit the complete say line or choice prompt before reveal starts. */
  layoutLine(line: PresentedLine | undefined): Rect {
    this.requireViewport();
    const offset = this.bodyOffset();
    const footer = this.footerHeight();
    this.line = line;
    this.rowHeights = undefined;
    this.reflow(offset !== this.bodyOffset() || footer !== this.footerHeight());
    return this.frameRect();
  }

  /** Fit the prompt and measured rows. Oversized content remains unscrolled. */
  layoutChoicePanel(rowHeights: readonly number[]): ChoiceRowRect[] {
    this.requireViewport();
    let total = 0;
    for (const height of rowHeights) {
      finiteNonnegative("BoxLayout.layoutChoicePanel", "row height", height);
      total += height;
    }
    finiteNonnegative("BoxLayout.layoutChoicePanel", "total row height", total);
    const footer = this.footerHeight();
    this.rowHeights = [...rowHeights];
    this.reflow(footer !== this.footerHeight());
    const frame = this.frameRect();
    const head = this.bodyOffset() + this.choicePromptHeight();
    return stackChoiceRows(
      rowHeights,
      {
        x: frame.x + this.insetWidth("left"),
        y: frame.y + head,
        width: frame.width - this.insetWidth("left") - this.insetWidth("right"),
        height: frame.height - head,
      },
      this.cfg.padding,
    );
  }

  textRegion(): Rect {
    const frame = this.frameRect();
    return {
      x: frame.x + this.cfg.padding + this.insetWidth("left"),
      y: frame.y + this.cfg.padding + this.bodyOffset(),
      width: this.contentWidth(),
      height: Math.max(
        0,
        frame.height -
          2 * this.cfg.padding -
          this.bodyOffset() -
          this.footerHeight(),
      ),
    };
  }

  nameplatePos(): { x: number; y: number } {
    const frame = this.frameRect();
    return { x: frame.x + this.cfg.padding, y: frame.y + this.cfg.padding - 1 };
  }

  caretPos(size: { width: number; height: number }): { x: number; y: number } {
    const frame = this.frameRect();
    return {
      x: frame.x + frame.width - this.cfg.padding - size.width,
      y: frame.y + frame.height - this.cfg.padding - size.height - 1,
    };
  }

  /** Reserve or release an avatar column, then reflow the active content. */
  setInset(key: string, inset: TextInset | undefined): void {
    if (inset) {
      finiteNonnegative("BoxLayout.setInset", "width", inset.width);
      finiteNonnegative("BoxLayout.setInset", "height", inset.height ?? 0);
    }
    const prev = this.insets.get(key);
    if (
      prev?.side === inset?.side &&
      prev?.width === inset?.width &&
      prev?.height === inset?.height
    )
      return;
    if (this.viewport) {
      const width =
        this.contentWidth() + (prev?.width ?? 0) - (inset?.width ?? 0);
      if (!Number.isFinite(width) || width <= 0)
        throw new Error(
          `BoxLayout.setInset: content width must be positive and finite, got ${width}`,
        );
    }
    if (inset) this.insets.set(key, { ...inset });
    else this.insets.delete(key);
    if (this.viewport) this.reflow(true);
  }

  insetWidth(side: "left" | "right"): number {
    let width = 0;
    for (const inset of this.insets.values())
      if (inset.side === side) width += inset.width;
    return width;
  }

  private bodyOffset(): number {
    return this.cfg.nameSize > 0 && this.line?.speaker?.name
      ? this.cfg.nameSize + TEXT_GAP
      : 0;
  }

  private textHeight(): number {
    const text = this.line?.text;
    if (!text?.length) return 0;
    const font = this.cfg.bitmapFont ?? this.cfg.fontFamily;
    const measured = measureWrappedText(
      text.runs.map((run) => run.text).join(""),
      {
        fontSize: this.cfg.textSize,
        lineHeight: this.cfg.lineHeight,
        wordWrapWidth: this.contentWidth(),
        ...(font !== undefined ? { fontFamily: font } : {}),
        ...(this.cfg.bitmapFont !== undefined ? { bitmap: true } : {}),
      },
    );
    finiteNonnegative("BoxLayout", "measured text height", measured.height);
    return measured.height;
  }

  private choicePromptHeight(): number {
    const height = this.textHeight();
    return height > 0 ? height + this.cfg.choiceGap : 0;
  }

  private footerHeight(): number {
    return this.line && !this.rowHeights && this.caretHeight > 0
      ? this.caretHeight + TEXT_GAP + 1
      : 0;
  }

  private reflow(force = false): void {
    const viewport = this.requireViewport();
    const text = this.rowHeights
      ? this.choicePromptHeight()
      : this.textHeight();
    const rows = this.rowHeights?.reduce((sum, h) => sum + h, 0) ?? 0;
    let insetHeight = 0;
    for (const inset of this.insets.values())
      insetHeight = Math.max(insetHeight, inset.height ?? 0);
    const content =
      2 * this.cfg.padding +
      this.bodyOffset() +
      Math.max(text + rows, insetHeight) +
      this.footerHeight();
    finiteNonnegative("BoxLayout", "content height", content);
    const height = Math.min(
      Math.max(this.cfg.box.minHeight, content),
      viewport.height - 2 * this.cfg.box.marginY,
    );
    const pos = positionOf(this.line);
    const frame = {
      x: this.cfg.box.marginX,
      y:
        pos === "top"
          ? this.cfg.box.marginY
          : pos === "center"
            ? (viewport.height - height) / 2
            : viewport.height - this.cfg.box.marginY - height,
      width: viewport.width - 2 * this.cfg.box.marginX,
      height,
    };
    const prev = this.frame;
    this.frame = frame;
    if (
      !force &&
      prev &&
      prev.x === frame.x &&
      prev.y === frame.y &&
      prev.width === frame.width &&
      prev.height === frame.height
    )
      return;
    for (const listener of this.listeners) {
      if (this.boundary)
        this.boundary.wrapCallback(listener, { kind: "BoxLayout.onChange" });
      else listener();
    }
  }

  private requireViewport(): { width: number; height: number } {
    if (!this.viewport)
      throw new Error(
        "BoxLayout: bind a viewport with mount(scene) or setViewport(width, height) before reading geometry",
      );
    return this.viewport;
  }

  private validateViewport(width: number, height: number): void {
    const contentWidth =
      width -
      2 * (this.cfg.box.marginX + this.cfg.padding) -
      this.insetWidth("left") -
      this.insetWidth("right");
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(contentWidth) ||
      contentWidth <= 0
    )
      throw new Error(
        `BoxLayout.setViewport: width must be finite and leave positive content width, got ${width}`,
      );
    if (!Number.isFinite(height) || height <= 2 * this.cfg.box.marginY)
      throw new Error(
        `BoxLayout.setViewport: height must be finite and exceed vertical margins, got ${height}`,
      );
  }
}

function positionOf(line: PresentedLine | undefined): BoxPosition {
  const position = line?.meta?.["position"];
  return position === "top" || position === "center" ? position : "bottom";
}

function finiteNonnegative(context: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(
      `${context}: ${name} must be finite and nonnegative, got ${value}`,
    );
}
