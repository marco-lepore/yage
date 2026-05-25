import type { TextStyle } from "@yagejs/renderer";

// ---------------------------------------------------------------------------
// Module-level UI default text style (set by UIPlugin.install)
// ---------------------------------------------------------------------------

let uiDefaultTextStyle: TextStyle | undefined;

/**
 * Store the UI-level default text style. Layered over the renderer-level
 * default (`RendererConfig.defaultTextStyle`) for `UIText` only, so UI text
 * can carry a different font/fill than free-positioned `TextComponent`.
 */
export function setUIDefaultTextStyle(style: TextStyle | undefined): void {
  uiDefaultTextStyle = style ? { ...style } : undefined;
}

/** Current UI-level default text style, if any. */
export function getUIDefaultTextStyle(): TextStyle | undefined {
  return uiDefaultTextStyle;
}
