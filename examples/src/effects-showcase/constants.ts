import type { LayerDef } from "@yagejs/renderer";
import type { ColorBackground, UIButton } from "@yagejs/ui";

export const VIRTUAL_WIDTH = 900;
export const VIRTUAL_HEIGHT = 640;
export const SIDEBAR_WIDTH = 248;

// ---------------------------------------------------------------------------
// Layer setup. The "ui" layer is screen-space and ordered above everything
// else, so it's not transformed by cameras and isn't part of the "world"
// layer's effects host. World-scope effects (bloom, halftone, etc.) attach
// to the "world" RenderLayer's container — the UI layer is a sibling, not a
// descendant, and is unaffected.
// ---------------------------------------------------------------------------
export const layers: LayerDef[] = [
  { name: "background", order: -10 },
  { name: "world", order: 0 },
  { name: "ui", order: 1000, space: "screen" },
];

// Toggle button styling — color BG only, no nine-slice assets needed.
export const BTN_OFF: ColorBackground = {
  color: 0x1f2937,
  alpha: 1,
  radius: 4,
};
export const BTN_OFF_HOVER: ColorBackground = {
  color: 0x374151,
  alpha: 1,
  radius: 4,
};
export const BTN_ON: ColorBackground = { color: 0x0ea5e9, alpha: 1, radius: 4 };
export const BTN_ON_HOVER: ColorBackground = {
  color: 0x0284c7,
  alpha: 1,
  radius: 4,
};
export const BTN_ACCENT: ColorBackground = {
  color: 0x115e59,
  alpha: 1,
  radius: 4,
};
export const BTN_ACCENT_HOVER: ColorBackground = {
  color: 0x0f766e,
  alpha: 1,
  radius: 4,
};

export const TXT_LABEL = {
  fontFamily: "monospace",
  fontSize: 11,
  fill: 0xffffff,
};
export const TXT_HEADING = {
  fontFamily: "monospace",
  fontSize: 11,
  fill: 0xfde68a,
  fontWeight: "bold" as const,
};
export const TXT_TITLE = {
  fontFamily: "monospace",
  fontSize: 14,
  fill: 0xffffff,
  fontWeight: "bold" as const,
};

/** Apply on/off styling to a UIButton. Used to mark the active toggles so
 * the in-game UI mirrors the panel's HTML predecessor. */
export function paintButton(btn: UIButton, on: boolean): void {
  btn.update({
    background: on ? BTN_ON : BTN_OFF,
    hoverBackground: on ? BTN_ON_HOVER : BTN_OFF_HOVER,
  });
}
