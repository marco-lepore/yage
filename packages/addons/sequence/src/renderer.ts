import type { VisualComponent } from "@yagejs/renderer";
import { SEQUENCE_VISUAL_PROPERTIES } from "./core/properties.js";
import { sequenceProperty } from "./core/SequencePlayer.js";
import type { SequenceTarget } from "./core/SequencePlayer.js";
/** Access the visual's authored appearance through renderer setters. */
export function visualSequenceTarget(visual: VisualComponent): SequenceTarget {
  const handle = visual.entity.handle();
  return {
    isAlive: () =>
      handle.current !== undefined &&
      Array.from(visual.entity.getAll()).includes(visual),
    properties: {
      // Eased opacity can overshoot; alpha holds at 0..1.
      opacity: sequenceProperty(
        SEQUENCE_VISUAL_PROPERTIES.opacity,
        () => visual.alpha,
        (value) => {
          visual.alpha = Math.max(0, Math.min(1, value));
        },
      ),
      visible: sequenceProperty(
        SEQUENCE_VISUAL_PROPERTIES.visible,
        () => visual.visible,
        (value) => {
          visual.visible = value;
        },
      ),
      tint: sequenceProperty(
        SEQUENCE_VISUAL_PROPERTIES.tint,
        () => Number(visual.tint),
        (value) => {
          visual.tint = value;
        },
      ),
    },
    events: {},
  };
}
