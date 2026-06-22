/**
 * Box-vs-bubble routing for the three composite presenters. A route maps a
 * {@link PresentedLine} (or a choice's context, adapted to one) to `"box"` or
 * `"bubble"`. All three composites in a mixed bundle MUST consult the SAME
 * route, or a line could send its chrome to the bubble and its text to the box.
 *
 * The default policy is **speaker-aware**: a narrator goes to the box (no head
 * to float a bubble over), an explicit `view` hint wins for a real speaker, and
 * otherwise a speaker with a registered {@link DialogueActor} floats in a bubble
 * while one without falls to the box. Because the registry is scene-scoped, the
 * default is built as a {@link MountRoute} whose `hasActor` lookup is bound at
 * mount; `createMixedDialogue` shares one instance across the three composites
 * and exposes a `route` override for a custom policy ("all of NPC X in bubbles").
 */

import type { Scene } from "@yagejs/core";
import { actorRegistryFor } from "../actor/index.js";
import type { PresentedLine, ChoiceContext } from "../core/session.js";
import type { ParsedText } from "../core/types.js";

/** Decides which variant a line renders in. Reads `view`/`speaker`/`meta`; a
 *  custom route can key off any of them (e.g. `meta.aside → bubble`). */
export type CompositeRoute = (line: PresentedLine | undefined) => "box" | "bubble";

/**
 * A route paired with a scene-bind hook the composites call at `mount`. The
 * default route needs the scene to resolve registered actors; a caller-supplied
 * route needs nothing, so its {@link bind} is a no-op. The composites store ONE
 * of these (shared, for a mixed bundle) and route every line/choice through it.
 */
export interface MountRoute {
  readonly route: CompositeRoute;
  /** Bind the scene at mount (idempotent across the three composites). */
  bind(scene: Scene): void;
}

const EMPTY_TEXT: ParsedText = { runs: [], pauses: [], length: 0 };

/**
 * The default route decision as a pure function of the line + an actor lookup
 * (testable without a scene). Precedence:
 *   1. **narrator** (no `speaker`) → **box** — the genre convention; a bubble
 *      has no head to float over. A *positioned* narrator is the invisible-anchor
 *      recipe (give it a speaker whose actor sits on an invisible entity).
 *   2. an explicit **`view`** hint wins for a real speaker (`"bubble"`/`"box"`) —
 *      a `view:"bubble"` whose actor is missing still routes to the bubble path,
 *      which renders at the fallback anchor rather than vanishing.
 *   3. otherwise a speaker with a **registered actor** → **bubble**; else **box**.
 */
export function routeWithActor(
  line: PresentedLine | undefined,
  hasActor: (speakerId: string) => boolean,
): "box" | "bubble" {
  const speaker = line?.speaker;
  if (speaker === undefined) return "box";
  const view = line?.view;
  if (view === "bubble") return "bubble";
  if (view === "box") return "box";
  return hasActor(speaker.id) ? "bubble" : "box";
}

/**
 * Build the default {@link MountRoute}. `hasActor` resolves the speaker through
 * the scene's {@link ActorRegistry}, rebound at mount (before then it answers
 * "no actor", so a pre-mount route call still resolves via the narrator/`view`
 * rules).
 */
export function makeDefaultRoute(): MountRoute {
  let hasActor: (speakerId: string) => boolean = () => false;
  return {
    bind(scene: Scene): void {
      const registry = actorRegistryFor(scene);
      hasActor = (id) => registry.resolve(id) !== undefined;
    },
    route: (line) => routeWithActor(line, hasActor),
  };
}

/** Wrap a caller-supplied route as a {@link MountRoute} (no scene needed). */
export function fixedRoute(route: CompositeRoute): MountRoute {
  return { route, bind() {} };
}

/** A choice's routing inputs as a (partial) line — the route only reads
 *  `view`/`speaker`/`meta`, all of which a {@link ChoiceContext} carries. */
export function choiceAsLine(context: ChoiceContext | undefined): PresentedLine {
  return {
    view: context?.view,
    speaker: context?.speaker,
    meta: context?.meta,
    text: context?.prompt ?? EMPTY_TEXT,
    speed: 1,
  };
}

/** Whether a presented line routes to the bubble under `route`. */
export function lineRoutesToBubble(
  route: CompositeRoute,
  line: PresentedLine | undefined,
): boolean {
  return route(line) === "bubble";
}

/** Whether a choice (by its context) routes to the bubble under `route`. */
export function choiceRoutesToBubble(
  route: CompositeRoute,
  context: ChoiceContext | undefined,
): boolean {
  return route(choiceAsLine(context)) === "bubble";
}
