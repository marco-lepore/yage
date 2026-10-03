export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface SequenceFrame extends Point {
  readonly width: number;
  readonly height: number;
}
export type SequenceValue = number | boolean | string | Point;
export type SequenceProperty =
  | { readonly kind: "number" | "vector" | "position" | "color" | "boolean" }
  | { readonly kind: "enum"; readonly values: readonly string[] };
export interface SequenceContract {
  readonly properties: Readonly<Record<string, SequenceProperty>>;
  readonly events: Readonly<
    Record<string, Readonly<Record<string, SequenceProperty>>>
  >;
}
export type SequenceCurve =
  | "linear"
  | "hold"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutCubic"
  | "easeOutBack"
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
  readonly frame: { readonly width: number; readonly height: number };
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
  readonly frame?: SequenceFrame;
  readonly fit?: "stretch" | "contain";
}
