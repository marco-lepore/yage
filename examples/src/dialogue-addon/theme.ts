import { registerTexture } from "@yagejs/renderer";
import { Texture } from "pixi.js";
import { defaultDialogueTheme, type DialogueTheme } from "@yagejs-addons/dialogue/presenters";
import {
  FACE_NEUTRAL,
  FACE_STERN,
  FACE_SAGE,
  FACE_PIP_SMILE,
  FACE_PIP_THINK,
} from "./constants.js";

// ── theme presets (cycled by the "Theme" button) ─────────────────────────────

/** A canvas-drawn nine-slice frame (a coloured `border`-px ring around a fill)
 *  for the textured preset — keeps the demo asset-free. The `border` must equal
 *  the nine-slice insets so the corners map 1:1. */
function makeFrameTexture(edge: number, fill: number, border: number): Texture {
  const size = 48;
  const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = hex(edge);
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = hex(fill);
    ctx.fillRect(border, border, size - 2 * border, size - 2 * border);
  }
  return Texture.from(canvas);
}

/** A simple canvas-drawn face for the Captain's in-box avatar — keeps the demo
 *  asset-free. `stern` angles the brows + frowns; otherwise a neutral look. */
function makeFace(skin: number, stern: boolean): Texture {
  const s = 72;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
    ctx.fillStyle = hex(skin);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#15151f";
    for (const ex of [0.36, 0.64]) {
      ctx.beginPath();
      ctx.arc(s * ex, s * 0.44, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#15151f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const browY = stern ? 0.38 : 0.32; // inner brow drops for a scowl
    ctx.moveTo(s * 0.28, s * 0.34);
    ctx.lineTo(s * 0.44, s * browY);
    ctx.moveTo(s * 0.72, s * 0.34);
    ctx.lineTo(s * 0.56, s * browY);
    ctx.stroke();
    ctx.beginPath();
    if (stern) ctx.arc(s / 2, s * 0.82, 9, Math.PI * 1.15, Math.PI * 1.85); // frown
    else ctx.arc(s / 2, s * 0.62, 9, Math.PI * 0.15, Math.PI * 0.85); // smile
    ctx.stroke();
  }
  return Texture.from(canvas);
}

// Built once, then registered under their `meta.portrait` keys per scene mount.
let faceNeutral: Texture | undefined;
let faceStern: Texture | undefined;
let faceSage: Texture | undefined;
let facePipSmile: Texture | undefined;
let facePipThink: Texture | undefined;

/** Build the portrait textures once and register them under their meta.portrait
 * keys, so the in-box avatars resolve synchronously. */
export function registerPortraitTextures(): void {
  faceNeutral ??= makeFace(0xe8c9a0, false);
  faceStern ??= makeFace(0xe8c9a0, true);
  faceSage ??= makeFace(0x9fc6e8, false);
  facePipSmile ??= makeFace(0xffcf9a, false);
  facePipThink ??= makeFace(0xffcf9a, true);
  registerTexture(FACE_NEUTRAL, faceNeutral);
  registerTexture(FACE_STERN, faceStern);
  registerTexture(FACE_SAGE, faceSage);
  registerTexture(FACE_PIP_SMILE, facePipSmile);
  registerTexture(FACE_PIP_THINK, facePipThink);
}

const insets = (n: number): { left: number; top: number; right: number; bottom: number } => ({
  left: n,
  top: n,
  right: n,
  bottom: n,
});
// The bubble is small, so it wears a thinner border than the wide box frame.
const FRAME_BORDER = 12;
const BUBBLE_BORDER = 6;
// Built once on first use of the textured preset, then reused across rebuilds.
let frameTex: Texture | undefined;
let bubbleTex: Texture | undefined;

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
    build: () => {
      frameTex ??= makeFrameTexture(0x8a6d3b, 0x2b2417, FRAME_BORDER);
      bubbleTex ??= makeFrameTexture(0x8a6d3b, 0x241d12, BUBBLE_BORDER);
      return {
        ...defaultDialogueTheme(),
        nameColor: 0xffcf8a,
        textColor: 0xf3e6cf,
        textured: {
          default: {
            frame: { texture: frameTex, insets: insets(FRAME_BORDER) },
            bubble: { texture: bubbleTex, insets: insets(BUBBLE_BORDER) },
          },
        },
      };
    },
  },
];
