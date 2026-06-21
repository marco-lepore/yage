/**
 * `createBoxDialogue(theme)` is the easy on-ramp: hand it one {@link DialogueTheme}
 * and get back the wired presenter bundle for a classic bottom-of-screen box
 * (frame + nameplate + caret, a typewriter body, a vertical choice list). Spread
 * it into a controller and override any one piece:
 *
 *   new DialogueController({ ...createBoxDialogue(theme), avatar, storage });
 *
 * It only assembles configs + presenters from the theme — no scene, no input —
 * so the host stays in charge of lifecycle.
 *
 * `theme` defaults to {@link defaultTheme} so a zero-config call works out of
 * the box (Graphics chrome + canvas text, no bundled assets).
 */

import { DialogueChrome } from "../chrome/DialogueChrome.js";
import { ChoiceListPresenter } from "../chrome/ChoiceListPresenter.js";
import { DialogueTextView } from "../render/DialogueTextView.js";
import type { DialogueBundle } from "../DialogueController.js";
import { boxFrameStyles, type DialogueTheme } from "./theme.js";
import { defaultTheme } from "./defaultTheme.js";
import { themeFonts } from "./themeFonts.js";

export function createBoxDialogue(theme: DialogueTheme = defaultTheme()): DialogueBundle {
  const fonts = themeFonts(theme);

  const chrome = new DialogueChrome({
    box: theme.box,
    padding: theme.padding,
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
  });

  const choices = new ChoiceListPresenter({
    box: theme.box,
    padding: theme.padding,
    choiceSize: theme.choiceSize,
    choiceColor: theme.choiceColor,
    choiceSelectedColor: theme.choiceSelectedColor,
    highlightColor: theme.highlightColor,
    choiceGap: theme.choiceGap,
    layerFrame: theme.layerFrame,
    layerText: theme.layerText,
    ...fonts,
  });

  // Body text region: inset by padding, below the name plate.
  const text = new DialogueTextView({
    textSize: theme.textSize,
    lineHeight: theme.lineHeight,
    textColor: theme.textColor,
    charsPerSec: theme.charsPerSec,
    layer: theme.layerText,
    box: {
      x: theme.box.x + theme.padding,
      y: theme.box.y + theme.padding + theme.nameSize + 4,
      width: theme.box.width - 2 * theme.padding,
    },
    ...fonts,
  });

  return { chrome, text, choices, skipMultiplier: theme.skipMultiplier };
}
