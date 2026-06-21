/**
 * `createBubbleDialogue(theme, opts)` wires a diegetic variant: the body text
 * floats in a world-space speech bubble over the speaking NPC (resolved via its
 * {@link DialogueActor}), while choices float in their own bubble panel over the
 * actor. Reuses the {@link DialogueTheme} for colours/fonts so a game's box and
 * bubble dialogues look consistent.
 *
 *   new DialogueController({ ...createBubbleDialogue(theme, { worldLayer }), avatar });
 *
 * The actors must already carry a {@link DialogueActor} (speaker id + head
 * anchor); the bubble follows that anchor every frame. Register exactly ONE
 * actor per speaker id — the bubble chrome and the bubble text each resolve the
 * speaker independently, so two actors sharing an id would let them track
 * different entities and the text would drift off the bubble.
 *
 * `theme` defaults to {@link defaultTheme} so a zero-config call works out of
 * the box (Graphics chrome + canvas text, no bundled assets).
 */

import { BubbleChrome } from "../chrome/BubbleChrome.js";
import { BubbleChoicePresenter } from "../chrome/BubbleChoicePresenter.js";
import { BubbleTextView } from "../render/BubbleTextView.js";
import type { DialogueBundle } from "../DialogueController.js";
import type { DialogueTheme } from "./theme.js";
import { defaultTheme } from "./defaultTheme.js";
import { themeFonts } from "./themeFonts.js";

export interface BubbleGeometry {
  /** Snuggest width; the bubble widens to its text up to {@link maxWidth}. */
  readonly minWidth: number;
  /** Widest the bubble grows before its text wraps to more lines. */
  readonly maxWidth: number;
  /** Minimum height; grows to fit wrapped text once `maxWidth` is reached. */
  readonly height: number;
  readonly padding: number;
  /** Gap between the actor's head anchor and the bubble's bottom edge. */
  readonly offsetY: number;
  /** Tail (pointer) height. */
  readonly tail: number;
}

export const DEFAULT_BUBBLE: BubbleGeometry = {
  minWidth: 90,
  maxWidth: 260,
  height: 40,
  padding: 8,
  offsetY: 24,
  tail: 6,
};

export interface BubbleDialogueOptions {
  /** World-space render layer the bubble + text draw into. */
  readonly worldLayer: string;
  readonly bubble?: Partial<BubbleGeometry>;
  /**
   * Where a bubble anchors when its speaker has no live actor and no last-known
   * position (a never-seen speaker / a narrator in a pure-bubble bundle).
   * Defaults to the world origin; point it at your camera centre so a
   * speakerless line lands on screen. A despawned actor uses its last-known
   * position regardless. Shared by the chrome, text, and choice presenters.
   */
  readonly fallbackAnchor?: () => { x: number; y: number };
}

export function createBubbleDialogue(
  theme: DialogueTheme = defaultTheme(),
  opts: BubbleDialogueOptions,
): DialogueBundle {
  const geo: BubbleGeometry = { ...DEFAULT_BUBBLE, ...opts.bubble };
  const fonts = themeFonts(theme);

  const chrome = new BubbleChrome({
    layer: opts.worldLayer,
    minWidth: geo.minWidth,
    maxWidth: geo.maxWidth,
    height: geo.height,
    padding: geo.padding,
    offsetY: geo.offsetY,
    tail: geo.tail,
    bgColor: theme.frameColor,
    bgAlpha: theme.frameAlpha,
    borderColor: theme.borderColor,
    cornerRadius: theme.cornerRadius,
    nameColor: theme.nameColor,
    nameSize: theme.nameSize,
    indicatorColor: theme.indicatorColor,
    // Body-text metrics so the bubble grows to fit its wrapped text, in lockstep
    // with the BubbleTextView below.
    textSize: theme.textSize,
    lineHeight: theme.lineHeight,
    fallbackAnchor: opts.fallbackAnchor,
    ...fonts,
  });

  const text = new BubbleTextView(
    {
      size: theme.textSize,
      lineHeight: theme.lineHeight,
      defaultColor: theme.textColor,
      charsPerSec: theme.charsPerSec,
      layer: opts.worldLayer,
      ...fonts,
    },
    {
      minWidth: geo.minWidth,
      maxWidth: geo.maxWidth,
      height: geo.height,
      padding: geo.padding,
      offsetY: geo.offsetY,
      fallbackAnchor: opts.fallbackAnchor,
    },
  );

  // Choices float in their own self-contained bubble panel over the actor
  // (prompt header + options, its own bg) — so they never depend on the box
  // frame and the prompt lives in the same bubble as the options.
  const choices = new BubbleChoicePresenter({
    layer: opts.worldLayer,
    width: geo.maxWidth,
    padding: geo.padding,
    offsetY: geo.offsetY,
    tail: geo.tail,
    choiceSize: theme.choiceSize,
    choiceColor: theme.choiceColor,
    choiceSelectedColor: theme.choiceSelectedColor,
    highlightColor: theme.highlightColor,
    promptColor: theme.textColor,
    bgColor: theme.frameColor,
    bgAlpha: theme.frameAlpha,
    borderColor: theme.borderColor,
    cornerRadius: theme.cornerRadius,
    fallbackAnchor: opts.fallbackAnchor,
    ...fonts,
  });

  return { chrome, text, choices, skipMultiplier: theme.skipMultiplier };
}
