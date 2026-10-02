import type { VisualComponent } from "@yagejs/renderer";
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
      opacity: sequenceProperty(
        { kind: "number" },
        () => visual.alpha,
        (value) => {
          visual.alpha = value;
        },
      ),
      visible: sequenceProperty(
        { kind: "boolean" },
        () => visual.visible,
        (value) => {
          visual.visible = value;
        },
      ),
      tint: sequenceProperty(
        { kind: "color" },
        () => Number(visual.tint),
        (value) => {
          visual.tint = value;
        },
      ),
    },
    events: {},
  };
}
