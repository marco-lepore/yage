import { Entity } from "@yagejs/core";
import { UISurface, Anchor } from "@yagejs/ui";
import type {
  ColorBackground,
  UIButton,
  UIPanel,
  UIScrollView,
} from "@yagejs/ui";
import {
  VIRTUAL_HEIGHT,
  SIDEBAR_WIDTH,
  BTN_OFF,
  BTN_OFF_HOVER,
  BTN_ACCENT,
  BTN_ACCENT_HOVER,
  TXT_LABEL,
  TXT_HEADING,
  TXT_TITLE,
  paintButton,
} from "./constants.js";
import { EffectControls } from "./controls.js";
import type { EffectKey, ShowcaseParts } from "./controls.js";

// The scroll view keeps a gutter for its scrollbar on its right edge. The
// sidebar's right padding gives that width back, so the rows sit 10 px from
// both edges of the panel.
const PADDING = 10;
const SCROLLBAR = { thickness: 4, margin: 2 };
const GUTTER = SCROLLBAR.thickness + 2 * SCROLLBAR.margin;

/** Width of a button inside a section. */
const ROW_WIDTH = SIDEBAR_WIDTH - 28;

/**
 * The effect sidebar in the top-right corner, on the screen-space "ui"
 * layer. Collapsible sections sit in a scroll view, so the panel never grows
 * past the canvas: the wheel or a drag scrolls whatever does not fit. Every
 * button calls a method of the entity's EffectControls.
 */
export class SidebarEntity extends Entity {
  setup(parts: ShowcaseParts): void {
    const controls = this.add(new EffectControls(parts));
    const surface = this.add(
      new UISurface({
        layer: "ui",
        anchor: Anchor.TopRight,
        offset: { x: -8, y: 8 },
        direction: "column",
        width: SIDEBAR_WIDTH,
        // As tall as its content, but never taller than the canvas less the
        // 8 px margin above and below. The scroll view shrinks to fit.
        maxHeight: VIRTUAL_HEIGHT - 16,
        padding: {
          top: PADDING,
          bottom: PADDING,
          left: PADDING,
          right: PADDING - GUTTER,
        },
        background: { color: 0x000000, alpha: 0.85, radius: 6 },
      }),
    );
    const list = surface.scrollView({ gap: 4, scrollbar: SCROLLBAR });
    list.text("Effects Showcase", TXT_TITLE);

    const effect = (host: UIPanel, label: string, key: EffectKey): void => {
      toggleButton(host, label, () => controls.toggle(key));
    };

    // ---- Component (sprite) ----
    const component = section(list, "Component (per-entity)", true);
    actionButton(component, "Hit Flash trigger", () =>
      controls.triggerHitFlash(),
    );
    effect(component, "outline (block)", "outline");
    effect(component, "dropShadow (block)", "dropShadow");
    effect(component, "glow (gem)", "glow");

    // ---- Layer (world only — UI unaffected) ----
    const layer = section(list, "Layer · world (UI unaffected)");
    effect(layer, "bloom", "bloom");
    effect(layer, "pixelate", "pixelate");
    effect(layer, "motionBlur", "motionBlur");
    effect(layer, "oldFilm", "oldFilm");
    effect(layer, "halftone (custom shader)", "halftone");
    effect(layer, "wave (custom shader)", "wave");

    // ---- Layer sets and per-visual escapes ----
    // `addLayerEffect` covers a named set of layers behind one handle.
    // `renderAboveEffects` goes the other way: it lifts one visual out of
    // every layer- and scene-scope effect and mask.
    const sets = section(list, "Layer sets & escapes");
    effect(sets, "colorGrade: night (bg + world)", "nightGrade");
    toggleButton(sets, "gem: renderAboveEffects", () =>
      controls.toggleGemAboveEffects(),
    );

    // ---- Scene (covers UI too) ----
    const scene = section(list, "Scene (covers UI too)");
    effect(scene, "crt", "crt");
    effect(scene, "colorGrade: sepia", "colorGrade");
    effect(scene, "chromaticAberration", "ca");
    effect(scene, "godRay", "godRay");
    effect(scene, "bulgePinch", "bulgePinch");
    effect(scene, "shockwave (toggle, then trigger)", "shockwave");
    actionButton(scene, "Trigger shockwave on hero", () =>
      controls.triggerShockwave(),
    );

    // ---- Screen (covers UI too) ----
    const screen = section(list, "Screen (covers UI too)");
    effect(screen, "vignette", "vignette");

    // ---- Fades: act on whichever handle is attached ----
    const fades = section(list, "Fades");
    const fade = (
      key: EffectKey,
      direction: "in" | "out",
      label: string,
    ): void => {
      actionButton(
        fades,
        label,
        () => controls.fade(key, direction, 1),
        BTN_OFF,
        BTN_OFF_HOVER,
      );
    };
    fade("bloom", "out", "bloom: fade out 1s");
    fade("bloom", "in", "bloom: fade in 1s");
    fade("vignette", "out", "vignette: fade out 1s");
    fade("vignette", "in", "vignette: fade in 1s");

    // ---- Masks: setMask / clearMask, one mask per visual ----
    const masks = section(list, "Masks");
    toggleButton(masks, "Mask gem (top half)", () => {
      const masked = controls.toggleGemMask();
      // A new mask starts non-inverted, and a removed one takes its inverse
      // flag with it.
      paintButton(inverseGem, controls.gemMaskInverted);
      return masked;
    });
    const inverseGem = toggleButton(masks, "Toggle gem mask inverse", () =>
      controls.toggleGemMaskInverse(),
    );
    toggleButton(masks, "Mask block (graphicsMask)", () =>
      controls.toggleBlockMask(),
    );
  }
}

/**
 * A collapsible section: a header button that shows and hides the panel of
 * rows under it. Returns that panel.
 */
function section(list: UIScrollView, title: string, open = false): UIPanel {
  const label = (isOpen: boolean): string => `${isOpen ? "▼" : "▶"} ${title}`;
  const header = list.button(label(open), {
    height: 22,
    width: SIDEBAR_WIDTH - 2 * PADDING,
    background: { color: 0x111827, alpha: 1, radius: 4 },
    hoverBackground: { color: 0x1f2937, alpha: 1, radius: 4 },
    pressBackground: { color: 0x1f2937, alpha: 1, radius: 4 },
    textStyle: TXT_HEADING,
    onClick: () => {
      rows.visible = !rows.visible;
      header.update({ children: label(rows.visible) });
    },
  });
  const rows = list.panel({
    direction: "column",
    gap: 3,
    padding: { left: 4 },
    visible: open,
  });
  return rows;
}

/** An on/off button. `toggle` changes the state and returns the new one. */
function toggleButton(
  host: UIPanel,
  label: string,
  toggle: () => boolean,
): UIButton {
  const button = host.button(label, {
    height: 22,
    width: ROW_WIDTH,
    background: BTN_OFF,
    hoverBackground: BTN_OFF_HOVER,
    pressBackground: BTN_OFF_HOVER,
    textStyle: TXT_LABEL,
    onClick: () => paintButton(button, toggle()),
  });
  return button;
}

/** A one-shot button: it runs `onClick` and keeps its colour. */
function actionButton(
  host: UIPanel,
  label: string,
  onClick: () => void,
  background: ColorBackground = BTN_ACCENT,
  hoverBackground: ColorBackground = BTN_ACCENT_HOVER,
): void {
  host.button(label, {
    height: 22,
    width: ROW_WIDTH,
    background,
    hoverBackground,
    pressBackground: hoverBackground,
    textStyle: TXT_LABEL,
    onClick,
  });
}
