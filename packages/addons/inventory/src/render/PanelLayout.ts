/**
 * PanelLayout — the single geometry owner for one inventory panel. One
 * instance is shared by the chrome, the slots view, the detail pane, and the
 * action menu, so the frame, header, content window, and detail band are
 * carved from the SAME rect instead of each presenter holding its own copy.
 *
 * Placement is one of two modes:
 *  - **centered** (default): the panel centres in the design viewport (the
 *    renderer's `virtualSize`, bound at mount via {@link setViewport}) — the
 *    standalone screen.
 *  - **explicit bounds**: the factory `bounds` option pins the panel to a
 *    caller-given rect and ignores the viewport — how an embedded panel sits
 *    inside a host menu's own layout.
 */

import type { Rect } from "./gridGeometry.js";

export interface PanelLayoutConfig {
  /** Panel size (virtual px) when centered; ignored when `bounds` is set. */
  readonly width: number;
  readonly height: number;
  /** Inner padding between the frame and its contents. */
  readonly padding: number;
  /** Header band height (title + counter). 0 = no band (no chrome). */
  readonly headerHeight: number;
  /** Detail band height at the panel bottom. 0 = no band (no detail pane). */
  readonly detailHeight: number;
  /** Pin the panel to this rect (embedded mode). Omit to centre. */
  readonly bounds?: Rect | undefined;
}

export class PanelLayout {
  /** Design viewport (the renderer's `virtualSize`) — bound at mount via
   *  {@link setViewport}. Defaults to a sane size so headless use (no
   *  renderer) and pre-mount reads still produce a valid frame. */
  private viewW = 800;
  private viewH = 600;
  private readonly listeners: Array<() => void> = [];

  constructor(private readonly cfg: PanelLayoutConfig) {}

  /** Bind the design viewport, read at mount by whichever presenter mounts
   *  first (idempotent). Recentres the panel; explicit `bounds` don't move. */
  setViewport(width: number, height: number): void {
    if (this.viewW === width && this.viewH === height) return;
    this.viewW = width;
    this.viewH = height;
    for (const fn of this.listeners) fn();
  }

  /** Register a callback fired when the panel rect changes (a viewport
   *  rebind) — presenters re-place their content. Returns an unsubscribe;
   *  presenters call it in `dispose()` so a disposed view can't be re-placed. */
  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  /** The panel frame rect. */
  panelRect(): Rect {
    if (this.cfg.bounds) return this.cfg.bounds;
    return {
      x: Math.round((this.viewW - this.cfg.width) / 2),
      y: Math.round((this.viewH - this.cfg.height) / 2),
      width: this.cfg.width,
      height: this.cfg.height,
    };
  }

  padding(): number {
    return this.cfg.padding;
  }

  /** Header band (title + counter) inside the frame — zero-height when the
   *  panel has no chrome. */
  headerRect(): Rect {
    const p = this.panelRect();
    return {
      x: p.x + this.cfg.padding,
      y: p.y + this.cfg.padding,
      width: p.width - 2 * this.cfg.padding,
      height: this.cfg.headerHeight,
    };
  }

  /** The content window between the header and detail bands — the slots view
   *  fills this. */
  contentRect(): Rect {
    const p = this.panelRect();
    const top = this.cfg.padding + this.headerOffset();
    return {
      x: p.x + this.cfg.padding,
      y: p.y + top,
      width: p.width - 2 * this.cfg.padding,
      height: p.height - top - this.cfg.padding - this.detailOffset(),
    };
  }

  /** Detail band at the panel bottom — zero-height when the panel has none. */
  detailRect(): Rect {
    const p = this.panelRect();
    return {
      x: p.x + this.cfg.padding,
      y: p.y + p.height - this.cfg.padding - this.cfg.detailHeight,
      width: p.width - 2 * this.cfg.padding,
      height: this.cfg.detailHeight,
    };
  }

  /** Header band height + its bottom gap (0 without a header). */
  headerOffset(): number {
    return this.cfg.headerHeight > 0 ? this.cfg.headerHeight + HEADER_GAP : 0;
  }

  /** Detail band height + its top gap (0 without a detail pane). */
  detailOffset(): number {
    return this.cfg.detailHeight > 0 ? this.cfg.detailHeight + DETAIL_GAP : 0;
  }
}

/** Gap between the header band and the content window. */
export const HEADER_GAP = 10;
/** Gap between the content window and the detail band. */
export const DETAIL_GAP = 10;
