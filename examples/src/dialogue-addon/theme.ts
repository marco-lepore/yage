import {
  registerTexture,
  type GraphicsContext,
  type RendererPlugin,
} from "@yagejs/renderer";
import {
  defaultDialogueTheme,
  type DialogueTheme,
} from "@yagejs-addons/dialogue/presenters";
import {
  FACE_NEUTRAL,
  FACE_STERN,
  FACE_SAGE,
  FACE_PIP_SMILE,
  FACE_PIP_THINK,
  FRAME_TEXTURE,
  BUBBLE_TEXTURE,
} from "./constants.js";

// ── textures (drawn at boot, so the demo stays asset-free) ──────────────────

const FACE_SIZE = 72;
const FRAME_SIZE = 48;
// The bubble is small, so it wears a thinner border than the wide box frame.
const FRAME_BORDER = 12;
const BUBBLE_BORDER = 6;

/** A simple face for the avatar portraits. `stern` angles the brows and turns
 *  the smile into a frown. */
function drawFace(g: GraphicsContext, skin: number, stern: boolean): void {
  const s = FACE_SIZE;
  const ink = 0x15151f;
  g.circle(s / 2, s / 2, s / 2 - 3)
    .fill({ color: skin })
    .stroke({ color: 0x000000, alpha: 0.45, width: 2 });
  for (const ex of [0.36, 0.64]) {
    g.circle(s * ex, s * 0.44, 4).fill({ color: ink });
  }
  const browY = stern ? 0.38 : 0.32; // the inner brow drops for a scowl
  g.moveTo(s * 0.28, s * 0.34)
    .lineTo(s * 0.44, s * browY)
    .moveTo(s * 0.72, s * 0.34)
    .lineTo(s * 0.56, s * browY)
    .stroke({ color: ink, width: 3 });
  // A frown is the top of a circle below the mouth; a smile is the bottom of
  // one above it. `moveTo` the arc's start so no line joins it to the brows.
  const [cy, from, to] = stern
    ? [s * 0.82, Math.PI * 1.15, Math.PI * 1.85]
    : [s * 0.62, Math.PI * 0.15, Math.PI * 0.85];
  g.moveTo(s / 2 + 9 * Math.cos(from), cy + 9 * Math.sin(from))
    .arc(s / 2, cy, 9, from, to)
    .stroke({ color: ink, width: 3 });
}

/** A nine-slice frame: a coloured `border`-px ring around a fill. The border
 *  must equal the nine-slice insets so the corners map 1:1. */
function drawFrame(
  g: GraphicsContext,
  edge: number,
  fill: number,
  border: number,
): void {
  g.rect(0, 0, FRAME_SIZE, FRAME_SIZE).fill({ color: edge });
  g.rect(border, border, FRAME_SIZE - 2 * border, FRAME_SIZE - 2 * border).fill(
    { color: fill },
  );
}

/**
 * Draw the portraits and the textured frames once, and register each under its
 * key. The scripts name a portrait by key (`meta.portrait`), and the "Textured"
 * preset names its frames the same way, so the presenters resolve them
 * synchronously. Registered keys are engine-wide and survive the scene
 * rebuilds the Font and Theme buttons do.
 */
export function registerTownTextures(renderer: RendererPlugin): void {
  const bake = (
    key: string,
    size: number,
    draw: (g: GraphicsContext) => void,
  ): void => {
    registerTexture(
      key,
      renderer.createTexture(draw, { width: size, height: size }),
    );
  };
  bake(FACE_NEUTRAL, FACE_SIZE, (g) => drawFace(g, 0xe8c9a0, false));
  bake(FACE_STERN, FACE_SIZE, (g) => drawFace(g, 0xe8c9a0, true));
  bake(FACE_SAGE, FACE_SIZE, (g) => drawFace(g, 0x9fc6e8, false));
  bake(FACE_PIP_SMILE, FACE_SIZE, (g) => drawFace(g, 0xffcf9a, false));
  bake(FACE_PIP_THINK, FACE_SIZE, (g) => drawFace(g, 0xffcf9a, true));
  bake(FRAME_TEXTURE, FRAME_SIZE, (g) =>
    drawFrame(g, 0x8a6d3b, 0x2b2417, FRAME_BORDER),
  );
  bake(BUBBLE_TEXTURE, FRAME_SIZE, (g) =>
    drawFrame(g, 0x8a6d3b, 0x241d12, BUBBLE_BORDER),
  );
}

// ── theme presets (cycled by the "Theme" button) ─────────────────────────────

const insets = (
  n: number,
): { left: number; top: number; right: number; bottom: number } => ({
  left: n,
  top: n,
  right: n,
  bottom: n,
});

interface ThemePreset {
  readonly label: string;
  readonly build: () => DialogueTheme;
}

/** The presets the "Theme" button cycles. "Warm" recolours every knob through
 *  the theme (no presenter subclassed); "Textured" swaps the box + bubble chrome
 *  to a nine-slice via `theme.textured`. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { label: "Default", build: () => defaultDialogueTheme() },
  {
    label: "Warm",
    build: () => ({
      ...defaultDialogueTheme(),
      frameColor: 0x2b1d12,
      borderColor: 0xb8894e,
      nameColor: 0xffcf8a,
      textColor: 0xf3e6cf,
      choiceColor: 0xcdba97,
      choiceSelectedColor: 0xffd98a,
      highlightColor: 0x7a5a2a,
      caret: { blink: 0.2, size: { width: 9, height: 6 } },
      choiceGap: 8,
    }),
  },
  {
    label: "Textured",
    build: () => ({
      ...defaultDialogueTheme(),
      nameColor: 0xffcf8a,
      textColor: 0xf3e6cf,
      textured: {
        default: {
          frame: { texture: FRAME_TEXTURE, insets: insets(FRAME_BORDER) },
          bubble: { texture: BUBBLE_TEXTURE, insets: insets(BUBBLE_BORDER) },
        },
      },
    }),
  },
];
