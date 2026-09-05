import type { LayerDef } from "@yagejs/renderer";

/**
 * Screen-space render layers the dialogue system draws into. They sit ABOVE
 * the auto-provisioned ui-react layer (order 1000) so a conversation overlays
 * any in-scene React chrome, and `space: "screen"` pins the box to the
 * viewport (it doesn't scroll/zoom with the world camera).
 *
 * Built-in presenters create missing layers. A host can declare orders explicitly:
 *   readonly layers = [...DIALOGUE_LAYERS];
 */
export const DIALOGUE_LAYER_FRAME = "dialogue-frame";
export const DIALOGUE_LAYER_TEXT = "dialogue-text";
export const DIALOGUE_LAYER_AVATAR = "dialogue-avatar";

export const DIALOGUE_LAYERS: readonly LayerDef[] = [
  { name: DIALOGUE_LAYER_FRAME, order: 1100, space: "screen" },
  // Avatar between frame and text so a portrait can tuck behind the box edge.
  { name: DIALOGUE_LAYER_AVATAR, order: 1105, space: "screen" },
  { name: DIALOGUE_LAYER_TEXT, order: 1110, space: "screen" },
];
