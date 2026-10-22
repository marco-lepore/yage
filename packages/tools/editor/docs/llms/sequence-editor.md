# Sequence mode — @yagejs-tools/editor

Sequence mode in `@yagejs-tools/editor` lets you animate project entities with
keyframes and event markers. The preview uses the same entity declarations,
parameters, assets and transform tools as level editing (`tools/editor.md`).
A resizable timeline stays below the preview.

## Open a sequence workspace

Add a `sequences` glob to your editor configuration:

```ts
import { defineEditorConfig } from "@yagejs-tools/editor";

export default defineEditorConfig({
  modules: { project: "../src/levelProject.ts", harness: "./harness.ts" },
  levels: ["src/levels/*.yage-level.json"],
  sequences: ["src/sequences/*.yage-sequence-workspace.json"],
  assets: ["public/sprites/**/*.png"],
});
```

Start `yage-editor`, choose **Sequence**, then **New**. The sequence has its own
file and does not need a gameplay level. A project that only edits sequences
can leave out `levels`. A sequence glob can also declare `layers`, using the
same form as a level glob.

**Save** writes the accepted draft to the project file. Undo, redo and unsaved
work survive a browser reload while the editor server runs. Restarting that
server discards unsaved drafts and history. Duplicate copies the saved file.

## Add and change actors

Open **Actors** below the preview and choose a project entity. The available
classes come from `defineLevelProject` and package contributions. Their
`static level` declarations define the parameter controls in the inspector;
`setup()` and the harness's renderer produce the artwork. Assets must be
represented by declared asset parameters, as in level editing.

**Add placeholder actor** creates a rectangle with editable width, height and
colour. Select an actor and change **Preview entity** to replace that rectangle
with a project type. Its runtime slot and animation keys stay in place; the new
type's parameters start at their defaults. Edit those parameters in the normal
inspector.

**Runtime slot** names the target your game supplies during playback. It is
separate from the preview placement ID and the entity type. The **Actor
contract** lists the properties and event payloads that target must support.
A new actor's contract declares the six properties the sequence addon's
transform and visual targets provide: position, rotation, scale, opacity,
visibility and tint. It declares no events.
Deleting an actor removes its preview, tracks and markers together; Undo
restores them. Duplicating an actor also copies its animation with fresh IDs.
Copy and paste carries placement setup and creates fresh actor tracks.

Expand **Actor contract** to add typed properties, event definitions and typed
payload fields. Removing a property removes its track. Removing an event
definition removes its markers. Adding a payload field supplies its default to
existing markers. Each operation is one undo step. Contract JSON remains
available for direct editing.

## Animate in the preview and timeline

Drag the ruler or empty track space to scrub continuously. Scrubbing is silent.
Use **Fit rectangle** to show the whole rectangle. Use Move, Rotate, Scale or
Transform on an actor, or edit the transform numbers above the preview. An edit
updates the key at the rounded cursor frame, or creates one there. Its existing
outgoing easing is preserved. The actor's preview parameters remain independent
of those animation keys.

Select a diamond to edit its frame, typed value and outgoing easing. Choose
linear, hold, a named curve, or cubic Bézier controls with a curve preview.
Numbers and coordinates commit with Enter or blur; Escape cancels a field edit.
Booleans use a checkbox, enums a choice list, and colors a color picker.
**Add key at cursor** uses
the sampled value there. Shift-select keys to move several together. Diamonds
and the preview update during dragging; releasing creates one undo step.
Escape cancels. A collision shows an outline and releasing there cancels the
move. The proposed frame appears beside the playback controls during a drag.
Every property track retains an explicit frame-zero key. **Remove track** removes
the whole track. Shift-select several keys to delete them together; a selection
containing an initial key cannot be deleted.

**Zoom** expands the timeline for precise placement. Scroll horizontally to reach
later frames. With timeline focus, Left/Right steps one frame (Shift steps ten);
Delete removes selected keys or the selected marker.

Use **Add property track** for a declared property without a track. A new
actor starts with tracks for every declared property except `tint`. The preview
writes `opacity`, `visible` and `tint` through the addon's
`SEQUENCE_VISUAL_ACCESSORS`, and places `position`, `rotation` and `scale` by
the transform target's rules. A bound actor that declares one of those six
properties with another kind is refused with an error, as the game's standard
targets refuse it. Custom properties remain available to game
targets but have no visual effect in the editor. New transform tracks start from
the current preview pose; boolean and enum tracks start with hold interpolation.
Choose a declared **Event type**, then **Add event at cursor**. Select a marker
to edit its frame, actor, event and typed payload. Drag flags to retime events
with live frame feedback and one undo step. Events may share a frame; their
document order determines dispatch order. Overlapping flags appear on separate
rows so each can be selected and dragged.
**Play** records crossed markers in **Event log**. The editor keeps preview
entities dormant and does not dispatch markers to game handlers. Pause/resume
keeps the log; **Clear event log** clears it.

**Settings** contains duration, frame rate, the authored rectangle and the
preview rectangle. Proportional positions scale from the authored rectangle.
Anchored positions use a normalized anchor plus fixed pixel offsets. Changing
the preview rectangle moves the positions without changing actor scale.
`stretch` maps each axis separately; `contain` preserves the authored aspect
ratio. Explicit scale tracks still change actor scale. Switching a track between
proportional and anchored converts its keys to preserve the path in the current
preview rectangle. Editing the anchor itself changes the path.

## Import and export

**Files → Import clip** accepts an exported runtime clip or a saved workspace
file, whose runtime clip it reads. It replaces animation data in one undo step. Matching
runtime slots keep their preview bindings; the current preview placements stay
in the workspace. Missing slots appear in the actor panel, where you can assign
an unbound existing preview or create a placeholder. Unbound placements remain
preview context and do not become runtime targets. Move, rotate and scale edit
their saved placement poses. A gesture that also edits bound actors records the
placement changes and animation keys in one undo step.

Invalid files leave the document intact. An import is rejected if the workspace
changes or a new gesture starts during its file read. **Export runtime clip** downloads the accepted
animation data after settling active edits. **Export workspace** also includes
preview placements and bindings. Neither export writes over the project file;
use **Save** for that. If an edit starts while an export is settling, finish the
edit and export again.

## Play with real game entities

The workspace contains `sequence`, the runtime clip, plus preview placements
and their slot bindings. Your game passes only `sequence` to the addon and
supplies actual targets. It does not load the authoring placements or import
the editor.

```ts
import type { Entity } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import {
  SequenceClip,
  parseSequenceFile,
  combineSequenceTargets,
  transformSequenceTarget,
} from "@yagejs-addons/sequence";
import type { SequencePlayer } from "@yagejs-addons/sequence";
import { visualSequenceTarget } from "@yagejs-addons/sequence/renderer";

/** The parsed JSON of a saved workspace or an exported runtime clip. */
declare const file: unknown;
declare const player: SequencePlayer;
declare const actor: Entity;

player.play(new SequenceClip(parseSequenceFile(file)), {
  targets: {
    hero: combineSequenceTargets(
      transformSequenceTarget(actor),
      visualSequenceTarget(actor.get(GraphicsComponent)),
    ),
  },
  rect: { x: 20, y: 20, width: 800, height: 450 },
});
```

The `hero` name must match the workspace's runtime slot. Supply every declared
property and event, even those without tracks. The two helpers cover a new
actor's contract. An event you add to the contract needs a binding built with
`sequenceEvent`, as shown in `addons/sequence.md`.
Transform helpers write world position, local rotation and local scale.

The [runtime example](https://examples.yage.dev/sequence.html) plays two actors
with different position mappings, easing, opacity, rotation and typed events.
Its game pauses the clip for 0.75 seconds after each greeting. In the
repository, run `npm run sequence:edit -w @yagejs/examples` to edit its
workspace. The file picker also includes **Curtain call**, a second sequence
with proportional and anchored travel, rotation, scale and typed gestures.
The example plays a saved workspace or a runtime clip JSON file. It refuses a
clip that names a runtime slot it has no actor for, or a property or event its
actors do not provide, and shows the error. See
`addons/sequence.md` for playback and binding APIs.
