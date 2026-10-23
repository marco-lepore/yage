export interface Point {
  readonly x: number;
  readonly y: number;
}
/** A destination rectangle in pixels. */
export interface SequenceRect extends Point {
  readonly width: number;
  readonly height: number;
}
export type SequenceValue = number | boolean | string | Point;
/** Every kind a contract property or payload field can declare. */
export const SEQUENCE_PROPERTY_KINDS = [
  "number",
  "vector",
  "position",
  "color",
  "boolean",
  "enum",
] as const;
export type SequenceProperty =
  | {
      readonly kind: Exclude<(typeof SEQUENCE_PROPERTY_KINDS)[number], "enum">;
    }
  | { readonly kind: "enum"; readonly values: readonly string[] };
export interface SequenceContract {
  readonly properties: Readonly<Record<string, SequenceProperty>>;
  readonly events: Readonly<
    Record<string, Readonly<Record<string, SequenceProperty>>>
  >;
}
/** Every named curve. A curve can also be a cubic Bézier. */
export const SEQUENCE_CURVE_NAMES = [
  "linear",
  "hold",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutCubic",
  "easeOutBack",
] as const;
export type SequenceCurve =
  | (typeof SEQUENCE_CURVE_NAMES)[number]
  | { readonly bezier: readonly [number, number, number, number] };
export interface SequenceKey {
  readonly id: string;
  readonly frame: number;
  readonly value: SequenceValue;
  readonly curve: SequenceCurve;
}
export type PositionMapping =
  | { readonly mode: "proportional" }
  | { readonly mode: "anchored"; readonly anchor: Point };
export interface SequenceTrack {
  readonly id: string;
  readonly target: string;
  readonly property: string;
  readonly keys: readonly SequenceKey[];
  readonly position?: PositionMapping;
}
export interface SequenceMarker {
  readonly id: string;
  readonly frame: number;
  readonly target: string;
  readonly event: string;
  readonly payload: Readonly<Record<string, SequenceValue>>;
}
export interface SequenceDocument {
  readonly format: "yage-sequence";
  readonly version: 1;
  readonly name: string;
  readonly fps: number;
  readonly duration: number;
  /** The authored rectangle, in pixels. Positions map from it to the destination rectangle. */
  readonly size: { readonly width: number; readonly height: number };
  readonly targets: Readonly<Record<string, SequenceContract>>;
  readonly tracks: readonly SequenceTrack[];
  readonly events: readonly SequenceMarker[];
}
export interface SequenceSample {
  readonly target: string;
  readonly property: string;
  readonly value: SequenceValue;
}
export interface SequenceSampleOptions {
  /** Destination rectangle. Defaults to the document's `size` at 0,0. */
  readonly rect?: SequenceRect;
  readonly fit?: "stretch" | "contain";
}

/**
 * The `format` of a sequence workspace file, which the editor's Sequence mode
 * saves. Its runtime clip is the `sequence` field.
 */
export const SEQUENCE_WORKSPACE_FORMAT = "yage-sequence-workspace";
