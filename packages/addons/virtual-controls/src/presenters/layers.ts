import type { LayerDef } from "@yagejs/renderer";

/**
 * The screen-space layer the built-in presenter draws on. The presenter
 * auto-provisions it at mount (`ensureLayer`), so scenes need no
 * declaration; declare it (spread {@link VIRTUAL_CONTROLS_LAYERS} into
 * `Scene.layers`) only to pin its order relative to other layers. Order
 * 1080 sits above the inventory addon's layers (1050–1070) and below the
 * dialogue addon's chrome (1100).
 */
export const VIRTUAL_CONTROLS_LAYER: LayerDef = {
  name: "virtual-controls",
  order: 1080,
  space: "screen",
};

export const VIRTUAL_CONTROLS_LAYERS: readonly LayerDef[] = [
  VIRTUAL_CONTROLS_LAYER,
];
