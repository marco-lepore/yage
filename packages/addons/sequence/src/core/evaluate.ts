import {
  sampleKeyframes,
  easeLinear,
  easeInQuad,
  easeOutQuad,
  easeInOutCubic,
  easeOutBack,
} from "@yagejs/core";
import type { EasingFunction, Keyframe } from "@yagejs/core";
import type {
  Point,
  SequenceCurve,
  SequenceDocument,
  SequenceSample,
  SequenceSampleOptions,
  SequenceTrack,
  SequenceValue,
} from "./types.js";
import { finite, parseSequence, validateSequenceValue } from "./validate.js";

export const SEQUENCE_EASINGS = {
  linear: easeLinear,
  hold: (t: number) => (t < 1 ? 0 : 1),
  easeInQuad,
  easeOutQuad,
  easeInOutCubic,
  easeOutBack,
};
function easing(curve: SequenceCurve): EasingFunction {
  if (typeof curve === "string") return SEQUENCE_EASINGS[curve];
  const [x1, y1, x2, y2] = curve.bezier;
  const cubic = (t: number, a: number, b: number): number =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x) => {
    if (x <= 0 || x >= 1) return x;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (cubic(mid, x1, x2) < x) lo = mid;
      else hi = mid;
    }
    return cubic((lo + hi) / 2, y1, y2);
  };
}
interface CompiledTrack {
  track: SequenceTrack;
  keys: Keyframe<number | Point>[];
}
/** A validated immutable asset with reusable curve evaluation. */
export class SequenceClip {
  readonly document: SequenceDocument;
  private readonly compiled: CompiledTrack[];
  constructor(input: unknown) {
    this.document = parseSequence(input);
    this.compiled = this.document.tracks.map((track) => ({
      track,
      keys: track.keys.map((k) => ({
        time: k.frame,
        data: k.value as number | Point,
        easing: easing(k.curve),
      })),
    }));
  }
  private positionSpace(
    track: Pick<SequenceTrack, "position">,
    options: SequenceSampleOptions,
  ) {
    const destination = options.frame ?? { x: 0, y: 0, ...this.document.frame };
    for (const key of ["x", "y", "width", "height"] as const)
      finite(destination[key], `destination.${key}`);
    if (destination.width <= 0 || destination.height <= 0)
      throw new Error("Sequence: destination dimensions must be > 0");
    if (
      options.fit !== undefined &&
      options.fit !== "stretch" &&
      options.fit !== "contain"
    )
      throw new Error("Sequence: unknown position fit");
    const sx = destination.width / this.document.frame.width;
    const sy = destination.height / this.document.frame.height;
    const fitX = options.fit === "contain" ? Math.min(sx, sy) : sx;
    const fitY = options.fit === "contain" ? Math.min(sx, sy) : sy;
    if (track.position?.mode === "anchored")
      return {
        x: destination.x + track.position.anchor.x * destination.width,
        y: destination.y + track.position.anchor.y * destination.height,
        width: 1,
        height: 1,
      };
    return {
      x:
        destination.x +
        (destination.width - this.document.frame.width * fitX) / 2,
      y:
        destination.y +
        (destination.height - this.document.frame.height * fitY) / 2,
      width: fitX,
      height: fitY,
    };
  }
  /** Convert a destination-space position back to an authored track value. */
  unmapPosition(
    trackId: string,
    point: Point,
    options: SequenceSampleOptions = {},
  ): Point {
    const track = this.document.tracks.find((t) => t.id === trackId);
    if (!track?.position)
      throw new Error(
        `SequenceClip.unmapPosition: unknown position track ${trackId}`,
      );
    finite(point.x, "unmapPosition.x");
    finite(point.y, "unmapPosition.y");
    const space = this.positionSpace(track, options);
    const result = {
      x: (point.x - space.x) / space.width,
      y: (point.y - space.y) / space.height,
    };
    finite(result.x, "unmapPosition result.x");
    finite(result.y, "unmapPosition result.y");
    return result;
  }
  /** Sample a pose without events or target mutation. Frame is clamped to the asset. */
  sample(
    frame: number,
    options: SequenceSampleOptions = {},
  ): readonly SequenceSample[] {
    finite(frame, "sample.frame");
    this.positionSpace({ position: { mode: "proportional" } }, options);
    const time = Math.max(0, Math.min(this.document.duration, frame));
    return this.compiled.map(({ track, keys }) => {
      const def =
        this.document.targets[track.target]!.properties[track.property]!;
      let value: SequenceValue;
      if (def.kind === "boolean" || def.kind === "enum") {
        value = track.keys[0]!.value;
        for (const key of track.keys) {
          if (key.frame > time) break;
          value = key.value;
        }
      } else if (def.kind === "color") {
        const channels = [16, 8, 0].map((shift) =>
          Math.round(
            Math.max(
              0,
              Math.min(
                255,
                sampleKeyframes(
                  keys.map((k) => ({
                    ...k,
                    data: ((k.data as number) >> shift) & 255,
                  })),
                  time,
                ),
              ),
            ),
          ),
        );
        value = channels[0]! * 65536 + channels[1]! * 256 + channels[2]!;
      } else value = sampleKeyframes(keys, time);
      if (track.position) {
        const p = value as Point;
        const space = this.positionSpace(track, options);
        value = {
          x: space.x + p.x * space.width,
          y: space.y + p.y * space.height,
        };
      }
      // Core vector interpolation returns Vec2; the public data stays plain JSON.
      if (typeof value === "object") value = { x: value.x, y: value.y };
      validateSequenceValue(
        value,
        def,
        `${track.target}.${track.property} evaluated value`,
      );
      return { target: track.target, property: track.property, value };
    });
  }
}
