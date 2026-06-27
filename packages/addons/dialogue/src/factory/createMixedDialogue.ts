/**
 * `createMixedDialogue` composes the box and bubble factories so one
 * conversation can place each line — and each choice — in either presentation,
 * chosen per step by its `view` hint ("box" — default — vs "bubble"). Text,
 * chrome, choices, and the avatar all route the same way, so a box choice keeps
 * the framed bottom list while a bubble choice gets its own panel over the actor.
 *
 * `theme` defaults to {@link defaultTheme} so a zero-config call works out of
 * the box (Graphics chrome + canvas text, no bundled assets).
 */

import { CompositeChrome } from "../composite/CompositeChrome.js";
import { CompositeChoicePresenter } from "../composite/CompositeChoicePresenter.js";
import { CompositeTextPresenter } from "../composite/CompositeTextPresenter.js";
import { CompositeAvatarPresenter } from "../composite/CompositeAvatarPresenter.js";
import { makeDefaultRoute, fixedRoute, type CompositeRoute } from "../composite/route.js";
import type { AvatarPresenter } from "../avatar/AvatarPresenter.js";
import type { DialogueBundle } from "../DialogueController.js";
import { createBoxDialogue, type BoxDialogueOptions } from "./createBoxDialogue.js";
import { createBubbleDialogue, type BubbleDialogueOptions } from "./createBubbleDialogue.js";
import type { DialogueTheme } from "./theme.js";
import { defaultTheme } from "./defaultTheme.js";

export interface MixedDialogueOptions extends Omit<BubbleDialogueOptions, "avatar"> {
  /**
   * Override the box-vs-bubble routing policy for this bundle. The default is
   * speaker-aware (narrator → box; explicit `view` wins; else a registered
   * actor → bubble, otherwise box). Supply a route to key off anything on the
   * line — e.g. `(line) => line?.speaker?.id === "boss" ? "bubble" : "box"`.
   * All composites (and the avatar) consult this one route, so chrome, text,
   * choices, and avatar always agree per line.
   */
  readonly route?: CompositeRoute;
  /**
   * Wire avatar presenters per side. `box` gets the box's {@link BoxLayout} (an
   * in-box reflowing avatar); `bubble` gets the bubble's {@link BubbleLayout} (a
   * portrait beside the bubble). With both, a {@link CompositeAvatarPresenter}
   * routes each line to the matching side; with one, only that side shows.
   */
  readonly avatar?: {
    readonly box?: BoxDialogueOptions["avatar"];
    readonly bubble?: BubbleDialogueOptions["avatar"];
  };
}

export function createMixedDialogue(
  theme: DialogueTheme = defaultTheme(),
  opts: MixedDialogueOptions,
): DialogueBundle {
  const box = createBoxDialogue(theme, opts.avatar?.box ? { avatar: opts.avatar.box } : {});
  const bubble = createBubbleDialogue(theme, {
    worldLayer: opts.worldLayer,
    ...(opts.bubble !== undefined ? { bubble: opts.bubble } : {}),
    ...(opts.fallbackAnchor !== undefined ? { fallbackAnchor: opts.fallbackAnchor } : {}),
    ...(opts.avatar?.bubble ? { avatar: opts.avatar.bubble } : {}),
  });
  // ONE route shared across the composites (+ the avatar) — per-presenter
  // divergence would route a line's chrome to the bubble and its text to the box.
  const routing = opts.route ? fixedRoute(opts.route) : makeDefaultRoute();

  // Compose the avatars: both sides → a routing composite; one side → that one.
  let avatar: AvatarPresenter | undefined;
  if (box.avatar && bubble.avatar) {
    avatar = new CompositeAvatarPresenter(box.avatar, bubble.avatar, routing);
  } else {
    avatar = box.avatar ?? bubble.avatar;
  }

  return {
    text: new CompositeTextPresenter(box.text, bubble.text, routing),
    chrome: new CompositeChrome(box.chrome, bubble.chrome, routing),
    choices: new CompositeChoicePresenter(box.choices, bubble.choices, routing),
    ...(avatar ? { avatar } : {}),
    skipMultiplier: theme.skipMultiplier,
  };
}
