/**
 * The avatar layer is deliberately decoupled from the box: the controller only
 * ever talks to this interface, so a speaker can be shown as a portrait beside
 * the box, as a full figure already standing in the scene, or not at all —
 * without the dialogue runtime knowing which. Implementations live alongside
 * (PortraitPresenter, SceneFigurePresenter); swap freely or compose your own.
 */

import type { Scene } from "@yagejs/core";
import type { AvatarChannel } from "../core/session.js";

/**
 * The adapter-level avatar presenter: the headless {@link AvatarChannel}
 * (setSpeaker / setExpression / setSpeaking / update) plus the YAGE lifecycle
 * the host drives (mount / dispose).
 */
export interface AvatarPresenter extends AvatarChannel {
  /** Called once when the controller mounts. */
  mount(scene: Scene): void;
  dispose(): void;
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
