import { defineEvent } from "@yagejs/core";

/**
 * Entity events the {@link VirtualControls} component emits from its host
 * entity (they bubble to the scene). Games that mirror onto the action map
 * usually don't need these — read the actions instead. They're the hook for
 * consequences outside the action map: UI sounds, haptics, tutorials,
 * analytics, or buttons that deliberately have no `action`.
 *
 * Destroying the host entity releases every engaged control — mirrored
 * action/axis state resets — but the release EVENTS are not emitted
 * (entity events no-op once destruction starts), so scene-level observers
 * must not rely on balanced engage/release pairs across a destroy.
 */

/** A pointer engaged a stick. Per-frame values are polled, not evented —
 *  read `controls.stick(id).value` (or `input.getStick(side)`). */
export const VirtualStickEngageEvent = defineEvent<{ id: string }>(
  "virtual-controls:stick-engage",
);

export const VirtualStickReleaseEvent = defineEvent<{ id: string }>(
  "virtual-controls:stick-release",
);

export const VirtualButtonPressEvent = defineEvent<{
  id: string;
  /** The mirrored action name, when the button has one. */
  action: string | undefined;
}>("virtual-controls:button-press");

export const VirtualButtonReleaseEvent = defineEvent<{
  id: string;
  action: string | undefined;
}>("virtual-controls:button-release");
