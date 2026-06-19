/**
 * The default box-vs-bubble routing shared by the three composite presenters
 * (Design B / D3). Factored out here — not inlined in each composite — because
 * Design C makes routing injectable and reuses this exact function as its
 * default's core, and because all three composites MUST route identically (a
 * line that goes to the box chrome must also go to the box text + box choices).
 */

import type { PresentedLine, ChoiceContext } from "../core/session.js";

/** Decides which variant a line/choice renders in, from its `view` hint and
 *  whether it has a speaker. */
export type CompositeRoute = (
  view: string | undefined,
  hasSpeaker: boolean,
) => "box" | "bubble";

/**
 * Default route (D3): a **speakerless** line goes to the **box** — the narrator
 * convention — regardless of its `view`, since a bubble has no head to float
 * over. A line WITH a speaker honours `view: "bubble"` (else the box). A
 * *positioned* narrator is the documented invisible-anchor recipe: give the
 * narrator a `speaker` whose `DialogueActor` sits on an invisible entity, and
 * it routes to the bubble like any other speaker.
 */
export const defaultCompositeRoute: CompositeRoute = (view, hasSpeaker) =>
  hasSpeaker && view === "bubble" ? "bubble" : "box";

/** Whether a presented line routes to the bubble under `route`. */
export function lineRoutesToBubble(
  route: CompositeRoute,
  line: PresentedLine | undefined,
): boolean {
  return route(line?.view, line?.speaker !== undefined) === "bubble";
}

/** Whether a choice (by its context) routes to the bubble under `route`. */
export function choiceRoutesToBubble(
  route: CompositeRoute,
  context: ChoiceContext | undefined,
): boolean {
  return route(context?.view, context?.speaker !== undefined) === "bubble";
}
