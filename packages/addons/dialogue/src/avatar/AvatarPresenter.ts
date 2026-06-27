/**
 * The avatar layer is deliberately decoupled from the box: the controller only
 * ever talks to this interface, so a speaker can be shown as a portrait beside
 * the box, as a full figure already standing in the scene, or not at all —
 * without the dialogue runtime knowing which. Implementations live alongside
 * (PortraitPresenter, SceneFigurePresenter); swap freely or compose your own.
 */

import type { Scene } from "@yagejs/core";
import type { AvatarChannel } from "../core/session.js";
import type { MarkerToken } from "../core/types.js";

/**
 * The adapter-level avatar presenter: the headless {@link AvatarChannel}
 * (setSpeaker / setExpression / setSpeaking / marker / update) plus the YAGE
 * lifecycle the host drives (mount / dispose).
 */
export interface AvatarPresenter extends AvatarChannel {
  /** Called once when the controller mounts. */
  mount(scene: Scene): void;
  dispose(): void;
}

/**
 * The bundled avatar presenters' shared `[expression=…/]` convention, in one
 * place: an inline reveal marker named `expression` drives the avatar's own
 * `setExpression` (the self-named prop is the new face; absent → reset to the
 * default). The Session name-matches NO marker — each presenter decides what it
 * owns, so any other marker name is ignored here.
 */
export function applyExpressionMarker(
  avatar: Pick<AvatarChannel, "setExpression">,
  marker: MarkerToken,
): void {
  if (marker.name === "expression") avatar.setExpression(marker.props["expression"]);
}

/** No-op presenter — the default when a script has no avatars. */
export class NullAvatarPresenter implements AvatarPresenter {
  mount(): void {}
  setSpeaker(): void {}
  setExpression(): void {}
  setSpeaking(): void {}
  update(): void {}
  dispose(): void {}
}
