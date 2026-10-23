import type { SequenceProperty } from "./types.js";

/**
 * The properties `transformSequenceTarget` provides: world position, local
 * rotation in radians and local scale.
 */
export const SEQUENCE_TRANSFORM_PROPERTIES = {
  position: { kind: "position" },
  rotation: { kind: "number" },
  scale: { kind: "vector" },
} as const satisfies Readonly<Record<string, SequenceProperty>>;

/** The properties `visualSequenceTarget` provides. */
export const SEQUENCE_VISUAL_PROPERTIES = {
  opacity: { kind: "number" },
  visible: { kind: "boolean" },
  tint: { kind: "color" },
} as const satisfies Readonly<Record<string, SequenceProperty>>;
