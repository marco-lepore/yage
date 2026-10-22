# Sequence

`@yagejs-addons/sequence` plays JSON keyframes and event markers against named
property contracts. A clip contains no entities or callbacks: the game binds
each target slot to an object when playback starts. The editor's Sequence mode
binds the same clip to preview entities.

## Entry points

- Root: `SequenceClip`, `parseSequence`, `SequencePlayer`, `SequenceComponent`,
  `sequenceProperty`, `sequenceEvent`, `validateSequenceTargets`,
  `transformSequenceTarget`, `combineSequenceTargets`, `SEQUENCE_EASINGS` (the
  frozen easing function of each named curve), everything `/document` exports,
  and the `Sequence*` types.
- `/renderer`: `visualSequenceTarget(visual: VisualComponent): SequenceTarget`
  and `SEQUENCE_VISUAL_ACCESSORS`, the `get(visual)` / `set(visual, value)`
  table the target binds. Needs the optional `@yagejs/renderer` peer.
- `/document`: `parseSequence`, `parseSequenceFile`, `SEQUENCE_TRANSFORM_PROPERTIES`,
  `SEQUENCE_VISUAL_PROPERTIES`, `SEQUENCE_PROPERTY_KINDS`,
  `SEQUENCE_CURVE_NAMES`, and the document types (`Point`,
  `PositionMapping`, `SequenceDocument`, ...), with no engine imports. Use it
  in Node tools and editor UI.

```ts
import { Component, Entity } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import {
  SequenceClip,
  SequenceComponent,
  transformSequenceTarget,
  combineSequenceTargets,
} from "@yagejs-addons/sequence";
import { visualSequenceTarget } from "@yagejs-addons/sequence/renderer";

class Entrance extends Component {
  private readonly sequence = this.sibling(SequenceComponent);
  play(data: unknown, actor: Entity): void {
    const clip = new SequenceClip(data);
    this.sequence.player.play(clip, {
      targets: {
        actor: combineSequenceTargets(
          transformSequenceTarget(actor),
          visualSequenceTarget(actor.get(GraphicsComponent)),
        ),
      },
      rect: { x: 20, y: 20, width: 800, height: 450 },
    });
  }
}
```

Add both `SequenceComponent` and the game's component to an entity in a `Scene`
subclass. The component advances its player with scene frame time. Do not also
advance that player by hand. Standalone use is
`new SequencePlayer(errorBoundary)` followed by `advance(dtSeconds)`.

## Document

`parseSequence(input: unknown): SequenceDocument` returns a detached, deeply
frozen document. `parseSequenceFile(input: unknown): SequenceDocument` parses a
saved file: a workspace's `sequence` field, or an exported runtime clip.
`new SequenceClip(input: unknown)` validates and compiles its input;
`clip.document` is the parsed document.

- `format: "yage-sequence"`, `version: 1`, nonempty `name`.
- Positive finite `fps`, `duration` in frames, and `size: {width, height}`: the
  authored rectangle in pixels.
- `targets: Record<string, {properties, events}>`. Property definitions are
  `{kind: "number" | "vector" | "position" | "color" | "boolean"}` or
  `{kind: "enum", values: string[]}`. Each event maps payload field names to
  these definitions.
- `tracks: {id, target, property, keys, position?}[]`. Keys are
  `{id, frame, value, curve}`. The first key is at frame 0; frames strictly
  increase and stay within the duration. A single key is constant. The last
  value holds.
- `events: {id, frame, target, event, payload}[]`. All track, key and event IDs
  are unique across the document. Only one track may address each
  target/property pair.

Values are finite numbers, plain `{x, y}` points, RGB integers `0..0xffffff`,
booleans or declared enum strings. Payloads contain exactly the declared fields.
Unknown fields, unsupported versions and incompatible values throw.

Each key's curve applies to the segment leaving it: `linear`, `hold`,
`easeInQuad`, `easeOutQuad`, `easeInOutCubic`, `easeOutBack`, or
`{bezier: [x1,y1,x2,y2]}`. Bézier x controls must be in `0..1`; finite y controls
may overshoot. A curve controls timing along a straight segment, not a curved
spatial path. Boolean and enum keys require `hold`. Colors interpolate RGB
channels and clamp to their range.

## Sampling and rectangle mapping

`clip.sample(frame, {rect?: SequenceRect, fit?: "stretch" | "contain"})`
returns `{target, property, value}[]` without writes or events.
`SequenceRect` is `{x, y, width, height}` in pixels. Sample time is clamped to
`0..duration`. The default `rect` is the document's `size` at 0,0.

`clip.unmapPosition(trackId, point, options?)` converts a position in `rect`
back to an authored key value, using the same options as `sample`. It requires
an existing position track and finite inputs and results. Use it to author a
position from a preview drag.

Position tracks require one mapping:

- `{mode: "proportional"}`: authored pixel coordinates scale from `size` to
  `rect`. Stretch uses separate x and y ratios. Contain uses the smaller ratio
  and centers the authored rectangle inside `rect`.
- `{mode: "anchored", anchor: {x,y}}`: a normalized anchor in `0..1`, plus key
  values as fixed pixel offsets. Per axis, the result is the `rect` origin,
  plus anchor × `rect` size, plus the key offset. `fit` does not affect
  anchored tracks.

Mapping changes position only. It does not scale actors. Positions outside
`rect` are valid; clipping belongs to the host. `rect` dimensions must be
positive and finite. The player reads the fields of `rect` at play, so a
`DOMRect` works; restart to change it.

## Binding and playback

`SequenceTarget` is `{properties, events, isAlive?()}`. The player calls
`isAlive` on the original target, so class prototype methods work.

- `sequenceProperty(definition, get, set)` builds a typed property binding.
  `SequencePropertyValue<D>` is the value type: `Point` for position and
  vector, `boolean`, `number` for number and color, and the union of declared
  values for an enum, so an enum getter returns one of those literals.
- `sequenceEvent(payload, dispatch)` builds a typed event binding.
  `dispatch(payload: SequencePayload<P>, marker)` receives the authored
  payload typed from the definition.
- `validateSequenceTargets(clip, targets)` checks bindings against the clip's
  contracts without calling getters, setters or liveness functions. Extra
  capabilities are accepted. Every declared capability must be supplied, even
  one with no track or marker.

```ts
import { Entity, defineEvent } from "@yagejs/core";
import {
  combineSequenceTargets,
  sequenceEvent,
  transformSequenceTarget,
} from "@yagejs-addons/sequence";
import type { SequenceTarget } from "@yagejs-addons/sequence";

const Greet = defineEvent<{ line: "hello" | "bye" }>("game:greet");

class Greeter extends Entity {
  sequenceTarget(): SequenceTarget {
    return combineSequenceTargets(transformSequenceTarget(this), {
      properties: {},
      events: {
        greet: sequenceEvent(
          { line: { kind: "enum", values: ["hello", "bye"] } },
          ({ line }) => this.emit(Greet, { line }),
        ),
      },
    });
  }
}
```

`player.play(clip, {targets, rect?, fit?, speed?, loop?, finish?, cancel?})`
checks bindings and liveness, evaluates frame 0 and captures every tracked
starting value before writing. Speed is positive and finite, default 1. Policies
are `"retain"` (default) or `"restore"`. Restore writes the captured starting
values.

`advance(dtSeconds)`, `pause()`, `resume()`, `seek(frame)`, `cancel(policy?)`;
read `frame` and `state` (`idle`, `playing`, `paused`, `completed`, `cancelled`).
An active or paused player rejects a second play; cancel first. Cancel can
restore a completed play. Cancelling an idle or cancelled player does nothing
outside binding callbacks. During restoration, cancel stops further writes
without restarting restoration under either policy. Pause stops further writes
and leaves the player paused. Seeking a completed or cancelled player leaves it
paused. Seek dispatches no events.

Events fire at play's frame 0, then at every crossed marker. All properties are
applied at the marker's exact frame before its callback. Same-frame markers
follow document order. Markers at the loop end precede the next pass's frame-0
markers, and a large advance processes every crossed loop. Pause, cancel or seek
from any binding callback ends the current operation before further writes or
events and discards the unused advancement time. Resume continues the remaining
same-frame markers. Events are synchronous; pause explicitly for dialogue.

Binding callbacks run through `ErrorBoundary`. A throw ends the operation;
remaining writes and events do not run, and earlier callbacks are not rolled
back. A dead required target throws before the next pose. Playback assumes
exclusive use of tracked properties: the game must suspend conflicting writes.
There is no ownership registry, blending, reverse playback or resumable playback
snapshot. Store the clip or its ID in controlled save state.

## Entity and renderer targets

- `transformSequenceTarget(entity, placementOffset?)` provides
  `SEQUENCE_TRANSFORM_PROPERTIES`: world `position`, local `rotation` in radians
  and local `scale`. The placement offset is a fixed world-pixel point relative
  to the origin; it does not rotate or scale with the entity. With related
  entity targets, local transforms settle before world positions, and ancestor
  positions are written before children regardless of track order. Restore uses
  the same order.
- `visualSequenceTarget(visual)` provides `SEQUENCE_VISUAL_PROPERTIES`:
  `opacity`, `visible` and `tint`, through `SEQUENCE_VISUAL_ACCESSORS`. Opacity
  is clamped to `0..1`, so an overshooting curve holds at the limit. A host
  that previews clips on visuals writes through the same table.
- Both expire when their entity or component is removed.
- `combineSequenceTargets(...targets)` merges targets and throws on a duplicate
  property or event name.
- `SequenceComponent` teardown cancels with retain, without writing to other
  dying entities.

A contract made of exactly `SEQUENCE_TRANSFORM_PROPERTIES` and
`SEQUENCE_VISUAL_PROPERTIES`, the editor's default for a new actor, is satisfied
by `combineSequenceTargets(transformSequenceTarget(e), visualSequenceTarget(v))`.
