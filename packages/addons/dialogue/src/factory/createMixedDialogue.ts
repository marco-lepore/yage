/**
 * `createMixedDialogue` composes the box and bubble factories so one
 * conversation can place each line — and each choice — in either presentation,
 * chosen per step by its `view` hint ("box" — default — vs "bubble"). Text,
 * chrome, and choices all route the same way, so a box choice keeps the framed
 * bottom list while a bubble choice gets its own panel over the actor.
 *
 * `theme` defaults to {@link defaultTheme} so a zero-config call works out of
 * the box (Graphics chrome + canvas text, no bundled assets).
 */

import { CompositeChrome } from "../composite/CompositeChrome.js";
import { CompositeChoicePresenter } from "../composite/CompositeChoicePresenter.js";
import { CompositeTextPresenter } from "../composite/CompositeTextPresenter.js";
import type { DialogueBundle } from "../DialogueController.js";
import { createBoxDialogue } from "./createBoxDialogue.js";
import { createBubbleDialogue, type BubbleDialogueOptions } from "./createBubbleDialogue.js";
import type { DialogueTheme } from "./theme.js";
import { defaultTheme } from "./defaultTheme.js";

export function createMixedDialogue(
  theme: DialogueTheme = defaultTheme(),
  opts: BubbleDialogueOptions,
): DialogueBundle {
  const box = createBoxDialogue(theme);
  const bubble = createBubbleDialogue(theme, opts);
  return {
    text: new CompositeTextPresenter(box.text, bubble.text),
    chrome: new CompositeChrome(box.chrome, bubble.chrome),
    choices: new CompositeChoicePresenter(box.choices, bubble.choices),
    skipMultiplier: theme.skipMultiplier,
  };
}
