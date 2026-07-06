/**
 * `createBoxDialogue(theme)` is the easy on-ramp: hand it one {@link DialogueTheme}
 * and get back the wired presenter bundle for a classic bottom-of-screen box
 * (frame + nameplate + caret, a typewriter body, a vertical choice list). Spread
 * it into a controller and override any one piece:
 *
 *   new DialogueController({ ...createBoxDialogue(theme), avatar, storage });
 *
 * It only assembles configs + presenters from the theme — no scene, no input —
 * so the host stays in charge of lifecycle. All four box presenters share ONE
 * {@link BoxLayout} so the frame, nameplate, body text, and choice rows move and
 * grow as one panel (per-line `meta.position`, choice-grow, avatar reflow).
 *
 * `theme` defaults to {@link defaultDialogueTheme} so a zero-config call works out of
 * the box (Graphics chrome + canvas text, no bundled assets).
 */

import { DialogueChrome } from "../chrome/DialogueChrome.js";
import { ChoiceListPresenter } from "../chrome/ChoiceListPresenter.js";
import { BoxTextView } from "../render/BoxTextView.js";
import { BoxLayout } from "../render/BoxLayout.js";
import type { AvatarPresenter } from "../avatar/AvatarPresenter.js";
import type { DialogueBundle } from "../DialogueController.js";
import { boxFrameStyles, DEFAULT_CHOICE_GAP, type DialogueTheme } from "./theme.js";
import { defaultDialogueTheme } from "./defaultTheme.js";
import { themeFonts } from "./themeFonts.js";

export interface BoxDialogueOptions {
  /**
   * Build an avatar presenter wired to the box's shared {@link BoxLayout} — so
   * a line-driven, reflowing in-box avatar (the reference `InBoxAvatarPresenter`)
   * can reserve a text-reflow inset on it. Receives the layout the box
   * chrome/text/choices share. Omit for no avatar (the default).
   *
   *   createBoxDialogue(theme, {
   *     avatar: (layout) =>
   *       new InBoxAvatarPresenter(layout, { layer: DIALOGUE_LAYER_AVATAR, width: 96 }),
   *   })
   */
  readonly avatar?: (layout: BoxLayout) => AvatarPresenter;
}

export function createBoxDialogue(
  theme: DialogueTheme = defaultDialogueTheme(),
  opts: BoxDialogueOptions = {},
): DialogueBundle {
  const fonts = themeFonts(theme);

  // The single per-line geometry owner for the box: frame position (meta.position),
  // the unified panel grow (choices grow the frame), and the avatar-reflow inset
  // registry — shared by the chrome, body text, and choice list below.
  const layout = new BoxLayout({
    box: theme.box,
    padding: theme.padding,
    nameSize: theme.nameSize,
    textSize: theme.textSize,
    lineHeight: theme.lineHeight,
    choiceGap: theme.choiceGap ?? DEFAULT_CHOICE_GAP,
    ...fonts,
  });

  const chrome = new DialogueChrome(
    {
      frameColor: theme.frameColor,
      frameAlpha: theme.frameAlpha,
      borderColor: theme.borderColor,
      cornerRadius: theme.cornerRadius,
      nameColor: theme.nameColor,
      nameSize: theme.nameSize,
      indicatorColor: theme.indicatorColor,
      caret: theme.caret,
      frameStyles: boxFrameStyles(theme.textured),
      layerFrame: theme.layerFrame,
      layerText: theme.layerText,
      ...fonts,
    },
    layout,
  );

  const choices = new ChoiceListPresenter(
    {
      choiceSize: theme.choiceSize,
      choiceColor: theme.choiceColor,
      choiceSelectedColor: theme.choiceSelectedColor,
      highlightColor: theme.highlightColor,
      choiceGap: theme.choiceGap,
      layerFrame: theme.layerFrame,
      layerText: theme.layerText,
      ...fonts,
    },
    layout,
  );

  // Body text region comes from the owner (below the nameplate band, reflowing
  // around any registered avatar inset, moving with meta.position).
  const text = new BoxTextView(
    {
      textSize: theme.textSize,
      lineHeight: theme.lineHeight,
      textColor: theme.textColor,
      charsPerSec: theme.charsPerSec,
      layer: theme.layerText,
      ...fonts,
    },
    layout,
  );

  // Opt-in avatar, wired to the same layout owner so it can reserve a text inset.
  const avatar = opts.avatar?.(layout);

  return {
    chrome,
    text,
    choices,
    ...(avatar ? { avatar } : {}),
    skipMultiplier: theme.skipMultiplier,
  };
}
