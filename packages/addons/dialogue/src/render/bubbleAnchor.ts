/**
 * The ONE shared "where does this speaker's bubble go" resolver.
 *
 * The three bubble presenters (`BubbleChrome`, `BubbleTextView`,
 * `BubbleChoicePresenter`) all need the same answer for "anchor the bubble for
 * speaker X", including the failure cases: a
 * despawned NPC, a typo'd speaker, or a speakerless narrator line routed to a
 * pure-bubble bundle. Three independent copies of that logic is exactly the bug
 * class — so it lives here once. (A future layout owner can absorb this.)
 *
 * Policy:
 *  - A **live actor** wins: use its head anchor, and refresh the caches.
 *  - A **missing declared speaker** (despawn / typo) falls back to that
 *    speaker's last-known position, else the most recent any-speaker anchor,
 *    else a configurable anchor — and warns (at most once per speaker id per
 *    resolver instance) through the diagnostics sink (→ engine Logger), never
 *    `console.warn`.
 *  - A **speakerless narrator** line (no id) uses the same fallback chain but
 *    never warns — it is authored intent, not a failure.
 *
 * The bubble stays VISIBLE in every case — anchored to a sane fallback rather
 * than hidden — so a line is always readable somewhere with its continue caret.
 */

import type { Scene } from "@yagejs/core";
import { actorRegistryFor } from "../actor/index.js";
import type { DiagnosticSink } from "../chrome/DialogueUiAdapter.js";

export interface AnchorPoint {
  readonly x: number;
  readonly y: number;
}

/** Resolves a speaker id to a world anchor, with last-known caching + a
 *  fallback for missing/absent actors. Each bubble presenter owns its own
 *  instance; the position caches converge frame-to-frame (every resolver sees
 *  the same live actors), but the missing-actor warning dedups *per instance* —
 *  a missing speaker warns at most once per presenter that anchors it (so up to
 *  ~2–3× across a bubble bundle), not once globally. A future single layout
 *  owner could collapse these into one shared instance. */
export class BubbleAnchorResolver {
  private readonly lastKnown = new Map<string, AnchorPoint>();
  private lastAnchor: AnchorPoint | undefined;
  private readonly warned = new Set<string>();
  private warn: DiagnosticSink | undefined;

  /**
   * @param fallback Ultimate anchor when nothing better is known (a speaker
   *   never seen and no prior bubble). Defaults to the world origin; a
   *   pure-bubble bundle that shows narrator lines should point this at its
   *   camera centre so a speakerless line lands on screen.
   */
  constructor(private readonly fallback: () => AnchorPoint = () => ({ x: 0, y: 0 })) {}

  /** Wire the diagnostics sink (the controller injects the engine-Logger one). */
  setDiagnostics(warn: DiagnosticSink): void {
    this.warn = warn;
  }

  /**
   * World anchor for `speakerId`. Live actor → its anchor (caches refreshed).
   * Missing → last-known for that speaker, else the most recent any-speaker
   * anchor, else {@link fallback}. Warns at most once per declared speaker id
   * (per resolver instance); a speakerless line never warns.
   */
  resolve(scene: Scene, speakerId: string | undefined): AnchorPoint {
    const actor = actorRegistryFor(scene).resolve(speakerId);
    if (actor) {
      const anchor = actor.anchorWorld();
      if (speakerId !== undefined) this.lastKnown.set(speakerId, anchor);
      this.lastAnchor = anchor;
      return anchor;
    }
    // A declared speaker with no live actor is a runtime failure — warn once so
    // the dev knows, but still render the bubble at a sane spot. A speakerless
    // narrator line is authored intent, so it routes through the same fallback
    // chain silently.
    if (speakerId !== undefined && !this.warned.has(speakerId)) {
      this.warned.add(speakerId);
      this.warn?.(
        `no DialogueActor is registered for speaker "${speakerId}"; anchoring its ` +
          `bubble at the last-known / fallback position. Register a DialogueActor ` +
          `(even on an invisible entity) to place it deliberately.`,
      );
    }
    const known = speakerId !== undefined ? this.lastKnown.get(speakerId) : undefined;
    return known ?? this.lastAnchor ?? this.fallback();
  }
}
