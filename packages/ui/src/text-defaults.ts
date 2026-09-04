import type { TextStyle } from "@yagejs/renderer";

// ---------------------------------------------------------------------------
// Process-scoped UI default text style (set by UIPlugin.install)
// ---------------------------------------------------------------------------

// When two engines share a page, the most recently installed UIPlugin wins.
let uiDefaultTextStyle: TextStyle | undefined;

/**
 * Store the UI-level default text style. Layered over the renderer-level
 * default (`RendererConfig.defaultTextStyle`) for UI text and generated
 * control labels, so they can use a different font/fill than free-positioned
 * `TextComponent`.
 */
export function setUIDefaultTextStyle(style: TextStyle | undefined): void {
  uiDefaultTextStyle = style ? { ...style } : undefined;
}

/** Current UI-level default text style, if any. */
export function getUIDefaultTextStyle(): TextStyle | undefined {
  return uiDefaultTextStyle;
}
