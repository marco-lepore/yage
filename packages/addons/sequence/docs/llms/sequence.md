# Sequence

`@yagejs-addons/sequence` plays JSON keyframes and event markers against named
property contracts. Assets do not contain entities or callbacks. Bind the same
asset to placeholders in an editor and real objects during gameplay.

## Entry points and use

Root exports `SequenceClip`, `parseSequence`, `SequencePlayer`,
`SequenceComponent`, `sequenceProperty`, `validateSequenceTargets`,
`transformSequenceTarget`, `combineSequenceTargets`, `SEQUENCE_EASINGS`, and the
`Sequence*`, `Point`, and `PositionMapping` types. `/renderer` exports
`visualSequenceTarget(visual: VisualComponent): SequenceTarget`.
`/document` exports `parseSequence` and document types without engine imports.

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
      frame: { x: 20, y: 20, width: 800, height: 450 },
    });
  }
}
```

Add both `SequenceComponent` and the game's component to an entity in a `Scene`
subclass. The component advances its player with scene frame time. Do not also
manually advance that player. Standalone use is
`new SequencePlayer(errorBoundary)` followed by `advance(dtSeconds)`.

## Document

`parseSequence(input: unknown): SequenceDocument` returns a detached, deeply
frozen document. `new SequenceClip(input: unknown)` validates and compiles it.

- `format: "yage-sequence"`, `version: 1`, nonempty `name`.
- Positive finite `fps`, `duration` in frames, `frame: {width, height}` in pixels.
- `targets: Record<string, {properties, events}>`. Property definitions are
  `{kind: "number" | "vector" | "position" | "color" | "boolean"}` or
  `{kind: "enum", values: string[]}`. Each event maps payload field names to
  these definitions.
- `tracks: {id, target, property, keys, position?}[]`. Keys are
  `{id, frame, value, curve}`. First key must be at zero; times strictly increase
  and stay within the duration. A single key is constant. The last value holds.
- `events: {id, frame, target, event, payload}[]`. All track, key and event IDs
  are globally unique. Only one track may address each target/property pair.

Values are finite numbers, plain `{x, y}` points, RGB integers `0..0xffffff`,
booleans or declared enum strings. Payloads contain exactly the declared fields.
Unknown fields, unsupported versions and incompatible values throw.

Each key's curve applies to the segment leaving it: `linear`, `hold`,
`easeInQuad`, `easeOutQuad`, `easeInOutCubic`, `easeOutBack`, or
`{bezier: [x1,y1,x2,y2]}`. Bézier x controls must be in `0..1`; finite y controls
may overshoot. This controls time, not a curved spatial path. Boolean/enum keys
require `hold`. Colors interpolate RGB channels and clamp to their range.

## Sampling and rectangle mapping

`clip.sample(frame, {frame?: SequenceFrame, fit?: "stretch" | "contain"})`
returns `{target, property, value}[]` without writes or events. Sample time is
clamped to `0..duration`. Default destination is the authored rectangle at 0,0.

`clip.unmapPosition(trackId, point, options?)` converts a destination-space
position to an authored value using the same mapping as sample. Options match
sample's rectangle and fit options. Requires an existing position track and
finite inputs/results. Use it when authoring a position from a preview drag.

Position tracks require one mapping:

- `{mode: "proportional"}`: authored pixel coordinates scale with the destination
  rectangle. Stretch uses separate x/y ratios. Contain uses the smaller ratio
  and centers the authored rectangle inside the destination.
- `{mode: "anchored", anchor: {x,y}}`: normalized anchor in `0..1`, plus key
  values as fixed pixel offsets. Formula per axis is destination origin +
  anchor × destination size + key offset. Fit does not affect anchored tracks.

Mapping changes position only. It does not scale actors. Outside-frame positions
are valid; clipping belongs to the host. Destination dimensions must be positive
and finite. The player copies the rectangle at play; restart to change it.

## Binding and playback

`SequenceTarget` contains `properties`, `events`, and optional `isAlive()`.
Liveness methods run on the original target, including class prototype methods.
`sequenceProperty(definition, get, set)` constructs a typed property accessor.
Event bindings expose `{payload: schema, dispatch(payload, marker)}`.
`validateSequenceTargets(clip, targets)` checks contracts without calling getters,
setters or liveness functions. Extra capabilities are accepted; every declared
capability must be supplied, even if it has no track or marker.

`player.play(clip, {targets, frame?, fit?, speed?, loop?, finish?, cancel?})` checks
bindings and liveness, evaluates frame zero and captures every tracked starting
value before writing. Speed is positive finite, default 1. Policies are
`"retain"` (default) or `"restore"`. Restore writes captured starting values.

`advance(dtSeconds)`, `pause()`, `resume()`, `seek(frame)`, `cancel(policy?)`;
read `frame` and `state` (`idle`, `playing`, `paused`, `completed`, `cancelled`).
An active/paused player rejects a second play. Cancel can restore a completed
play; cancelling an idle/already-cancelled instance has no effect outside binding
callbacks. During restoration, cancel stops further writes even if already
cancelled; pause stops further writes and leaves the player paused. Seeking a
completed/cancelled instance makes it paused. Seek does not dispatch events.

Events fire at play's frame zero, then at every crossed marker. All properties
are applied at the marker's exact frame before its callback. Same-frame markers
follow document order. Loop end markers precede the next frame-zero markers;
large advances process every crossed loop. Pause/cancel/seek during any binding
callback ends the current operation before further writes or events, discarding
unused advancement time. Resume continues remaining
same-frame markers. Events are synchronous; pause explicitly for dialogue.

Binding callbacks run through `ErrorBoundary`. A throw ends the operation;
remaining writes/events do not run. A dead required target throws before the
next pose. There is no rollback of callbacks already run. Playback assumes
exclusive use of tracked properties: the game must suspend conflicting writes.
No global ownership registry, blending, reverse playback or resumable playback
snapshot is provided. Store the asset or its ID in controlled save state.

`transformSequenceTarget(entity, placementOffset?)` exposes world `position`,
local `rotation` in radians and local `scale`. The placement offset is a fixed
world-pixel point relative to the origin, not rotated/scaled with the entity.
With related entity targets, local transforms settle before world positions,
and ancestor world positions precede children regardless of track order.
Restore uses the same hierarchy ordering.
`visualSequenceTarget(visual)` exposes `opacity`, `visible`, `tint` through normal
renderer setters. Helpers expire when their entity/component is removed.
`combineSequenceTargets(...targets)` rejects duplicate property/event names.
Component teardown cancels with retain, without writing other dying entities.

## Core sampling helpers

`sampleKeyframes<T>(keys, time, defaultEasing?)` from `@yagejs/core` samples core
`Keyframe<T>` values without executing key events. Supply nonempty keys ordered
by time; one key is constant; endpoints hold; default easing is linear. Time and
key times use the same unit. This read-only helper assumes valid finite inputs;
use the sequence parser for unknown documents.

`durationReached(elapsed, duration)` from core compares elapsed time against a
positive duration with the engine's relative tolerance of one part in a billion.
Use consistent time units. Both inputs must be finite; other query results are
undefined. This avoids missing an endpoint due to accumulated floating-point
rounding.
