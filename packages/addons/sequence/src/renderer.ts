import type { VisualComponent } from "@yagejs/renderer";
import { SEQUENCE_VISUAL_PROPERTIES } from "./core/properties.js";
import { sequenceProperty } from "./core/SequencePlayer.js";
import type {
  SequencePropertyValue,
  SequenceTarget,
} from "./core/SequencePlayer.js";

type VisualProperties = typeof SEQUENCE_VISUAL_PROPERTIES;

/** Reads and writes one visual property on a visual component. */
export interface SequenceVisualAccessor<V> {
  get(visual: VisualComponent): V;
  set(visual: VisualComponent, value: V): void;
}

/**
 * How each property in `SEQUENCE_VISUAL_PROPERTIES` reads and writes a visual
 * component. `visualSequenceTarget` binds this table; a host that previews
 * clips on visuals writes through it too, so both apply the same values. The
 * table and its entries are frozen.
 */
export const SEQUENCE_VISUAL_ACCESSORS: {
  readonly [K in keyof VisualProperties]: SequenceVisualAccessor<
    SequencePropertyValue<VisualProperties[K]>
  >;
} = Object.freeze({
  opacity: Object.freeze({
    get: (visual: VisualComponent) => visual.alpha,
    // Eased opacity can overshoot; alpha holds at 0..1.
    set: (visual: VisualComponent, value: number) => {
      visual.alpha = Math.max(0, Math.min(1, value));
    },
  }),
  visible: Object.freeze({
    get: (visual: VisualComponent) => visual.visible,
    set: (visual: VisualComponent, value: boolean) => {
      visual.visible = value;
    },
  }),
  tint: Object.freeze({
    get: (visual: VisualComponent) => Number(visual.tint),
    set: (visual: VisualComponent, value: number) => {
      visual.tint = value;
    },
  }),
});

/** Access the visual's authored appearance through renderer setters. */
export function visualSequenceTarget(visual: VisualComponent): SequenceTarget {
  const handle = visual.entity.handle();
  const bind = <K extends keyof VisualProperties>(name: K) =>
    sequenceProperty(
      SEQUENCE_VISUAL_PROPERTIES[name],
      () => SEQUENCE_VISUAL_ACCESSORS[name].get(visual),
      (value) => SEQUENCE_VISUAL_ACCESSORS[name].set(visual, value),
    );
  return {
    isAlive: () =>
      handle.current !== undefined &&
      Array.from(visual.entity.getAll()).includes(visual),
    properties: {
      opacity: bind("opacity"),
      visible: bind("visible"),
      tint: bind("tint"),
    },
    events: {},
  };
}
