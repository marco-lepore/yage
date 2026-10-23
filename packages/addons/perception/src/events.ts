import { defineEvent } from "@yagejs/core";
import type { EntityHandle } from "@yagejs/core";
import type { PerceptionObservation } from "./core/types.js";
import type { PerceptionSensor } from "./PerceptionSensor.js";

/** Payload of every perception event, emitted on the observer entity. */
export interface PerceptionEvent {
  readonly sensor: PerceptionSensor;
  readonly observation: PerceptionObservation<EntityHandle>;
}

/** A target passed every check after not being visible. */
export const PerceptionDetectedEvent = defineEvent<PerceptionEvent>(
  "perception:detected",
);
/** A visible target failed a check or stopped being a candidate, or the sensor cleared its memory while the target was visible. */
export const PerceptionLostEvent =
  defineEvent<PerceptionEvent>("perception:lost");
/** An observation was dropped: `memoryDuration` passed without a new sighting, or the sensor cleared its memory. A target visible at the clear gets a lost event first. */
export const PerceptionForgottenEvent = defineEvent<PerceptionEvent>(
  "perception:forgotten",
);
