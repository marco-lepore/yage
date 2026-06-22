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
import { makeDefaultRoute, fixedRoute, type CompositeRoute } from "../composite/route.js";
import type { DialogueBundle } from "../DialogueController.js";
import { createBoxDialogue, type BoxDialogueOptions } from "./createBoxDialogue.js";
import { createBubbleDialogue, type BubbleDialogueOptions } from "./createBubbleDialogue.js";
import type { DialogueTheme } from "./theme.js";
import { defaultTheme } from "./defaultTheme.js";

export interface MixedDialogueOptions extends BubbleDialogueOptions {
  /**
   * Override the box-vs-bubble routing policy for this bundle. The default is
   * speaker-aware (narrator → box; explicit `view` wins; else a registered
   * actor → bubble, otherwise box). Supply a route to key off anything on the
   * line — e.g. `(line) => line?.speaker?.id === "boss" ? "bubble" : "box"`.
   * All three composites consult this one route, so chrome, text, and choices
   * always agree per line.
   */
  readonly route?: CompositeRoute;
  /** Wire an in-box avatar to the box's layout owner (see {@link BoxDialogueOptions.avatar}).
   *  The avatar is the box's; bubble lines drive it the same way via `meta`. */
  readonly avatar?: BoxDialogueOptions["avatar"];
}

export function createMixedDialogue(
  theme: DialogueTheme = defaultTheme(),
  opts: MixedDialogueOptions,
): DialogueBundle {
  const box = createBoxDialogue(theme, opts.avatar ? { avatar: opts.avatar } : {});
  const bubble = createBubbleDialogue(theme, opts);
  // ONE route shared across the three composites — per-composite divergence
  // would route a line's chrome to the bubble and its text to the box.
  const routing = opts.route ? fixedRoute(opts.route) : makeDefaultRoute();
  return {
    text: new CompositeTextPresenter(box.text, bubble.text, routing),
    chrome: new CompositeChrome(box.chrome, bubble.chrome, routing),
    choices: new CompositeChoicePresenter(box.choices, bubble.choices, routing),
    ...(box.avatar ? { avatar: box.avatar } : {}),
    skipMultiplier: theme.skipMultiplier,
  };
}
