import type {
  SequenceProperty,
  SequenceValue,
  SequenceTrack,
} from "@yagejs-addons/sequence/document";
/** An editable initial value for a declared property or event payload field. */
export function defaultSequenceValue(
  definition: SequenceProperty,
): SequenceValue {
  if (definition.kind === "boolean") return true;
  if (definition.kind === "enum") return definition.values[0] ?? "";
  if (definition.kind === "vector" || definition.kind === "position")
    return { x: 0, y: 0 };
  return 0;
}
/** A valid initial track for each kind, including discrete values and positions. */
export function initialSequenceTrack(
  id: string,
  keyId: string,
  target: string,
  property: string,
  definition: SequenceProperty,
  value: SequenceValue = defaultSequenceValue(definition),
): SequenceTrack {
  return {
    id,
    target,
    property,
    ...(definition.kind === "position"
      ? { position: { mode: "proportional" as const } }
      : {}),
    keys: [
      {
        id: keyId,
        frame: 0,
        value,
        curve:
          definition.kind === "boolean" || definition.kind === "enum"
            ? "hold"
            : "linear",
      },
    ],
  };
}
