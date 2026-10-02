# Sequence system rules

The sequence addon plays authored property values and events against a target
contract. The sequence editor creates those documents. Preview and game playback
use the same evaluator and player.

## Accepted scope

The first delivery is a complete two-actor authoring and playback path: numeric,
vector, color, boolean and enum tracks; linear, hold, named and cubic Bézier
easing; proportional and anchored positions; event markers; seeking, looping,
pause, resume, speed, completion and cancellation. The editor supports document
import/export, undo/redo, keyframe and event editing, and preview in several
rectangles. Real entities and placeholders satisfy the same contract.

Nested sequences, clip blending, target spawning, live rectangle changes,
curved spatial paths, and resumable saved playback are outside this delivery.
Straight movement segments and temporal Bézier easing are distinct concepts.

## Rules

- **S01 — One document.** A versioned JSON document holds contracts, the authored
  frame, explicit initial values, stable track/key/event IDs, curves and markers.
  It contains no entities, constructors, callbacks or editor selection state.
- **S02 — Validate before effects.** Parse unknown JSON and validate the entire
  document, then all required target bindings, before writing a target. Reject
  non-finite values, incompatible kinds, unknown names, duplicate IDs, repeated
  property tracks, unordered/duplicate key times, and unsupported versions.
- **S03 — One evaluator.** Direct sampling and playback use the same pure
  evaluation. Reuse core interpolation and easing. Sampling never sends events.
  A track has an explicit value at frame zero; its last value holds to the end.
- **S04 — Contract before entities.** A target exposes typed property accessors
  and declared event handlers. Contract data is separate from those callbacks.
  Extra target capabilities are legal. Entity helpers use existing setters and
  EntityHandle lifetimes; no second entity registry or transform hierarchy.
- **S05 — Position mapping.** Proportional points are authored in frame pixels
  and mapped by stretch or contain. Anchored points use a normalized frame
  anchor plus fixed pixel offsets. Mapping never changes entity scale. The
  target placement point defaults to its origin. Helpers may supply an offset
  in the destination coordinate space. Outside-frame positions are legal.
  The destination rectangle is copied once per play. Clipping is a host concern.
- **S06 — Time.** Documents use frames with a positive frame rate. Runtime
  advancement uses scene seconds and a positive finite speed. Frame-clock
  components drive visual playback; hosts can manually advance the headless
  player. Seek applies a pose without events. Reverse playback is not included.
- **S07 — Event order.** Playback applies all properties at each crossed event
  time before dispatching markers in document order. Frame-zero markers fire
  once at play and once per loop. Ending markers precede the next loop's start.
  Large updates visit every crossed marker and loop. Pausing/cancelling/seeking
  inside a binding callback ends the current operation before further writes
  or events, including during play, seek and restoration. Events are synchronous;
  the host may pause for dialogue and resume later.
- **S08 — Playback policies.** A player owns only its tracked properties.
  Gameplay must yield those properties while playback is active; the addon
  cannot intercept arbitrary game setters. One player rejects a second active
  play. Finish retains final values by default; finish/cancel may restore
  captured starting values. Blending is not implemented. Policies belong to
  playback options, never to the asset.
- **S09 — Failures and lifetime.** Wrap game accessors, liveness checks and event
  handlers in core ErrorBoundary. A throw ends the current operation, without
  attempting remaining writes or cleanup. An expired required target throws
  before the next pose is applied. Lifetime methods retain their original target
  receiver, including prototype methods. Component teardown cancels with retain so
  scene teardown does not write to other dying entities.
- **S10 — Editor mutations.** The level editor's shared document reducer,
  server draft queue and history own workspace edits. Actor creation/deletion
  and animation edits are atomic transactions. A timeline drag is transient
  browser state until its single command commits. Stale edits are rejected.
- **S11 — Preview ownership.** The level editor's PreviewCoordinator owns the
  engine, dormant scene, asset lease and sequence playback. The shell sends
  intent through CommandController. One sampled document selector drives
  preview poses and manipulation math. Scrubbing is silent. Playback markers
  enter a preview log and never dispatch to game entities.
- **S12 — File boundary.** The authoring file is a versioned
  `yage-sequence-workspace`: normal level placements, a runtime `sequence`
  clip, and slot-to-placement `bindings`. The existing editor file service
  saves the complete workspace at an exact accepted revision. Drafts and
  history survive browser reload, but not server restart. Games consume the
  nested runtime clip alone.
- **S13 — Package boundaries.** `@yagejs-addons/sequence` owns runtime data,
  evaluation, playback and binding helpers. Its root imports core only, its
  `/document` entry is pure, and `/renderer` has the optional renderer peer.
  `@yagejs-tools/editor` owns sequence authoring through its existing layers.
  There is no separate sequence editor package or browser session owner.
- **S14 — Delivery evidence.** Plans reference these rule IDs. Each slice records
  tests, defects and corrections in the implementation log. The final gate
  includes authoring through the editor, exported-data playback on two real
  actors, Inspector assertions, and a visual use pass. Commit and submit only
  when requested by the user.

- **S15 — Persistent workspace.** Preview and timeline share a bounded viewport
  with a resizable horizontal divider. The inspector and tracks scroll
  independently. Selection, settings and event logs cannot push either main
  panel out of view. The level editor owns the preview and its lifecycle.

- **S16 — Direct manipulation.** Empty timeline dragging seeks continuously
  without events or document changes. Preview gestures use the same command
  reducer as fields, sample the document rather than reading entity state, and
  convert destination positions through the evaluator's inverse mapping.
  A gesture edits the rounded playhead frame, preserves an existing key's
  curve, creates missing transform tracks with explicit initial values, and
  contributes one undo step. Unbound preview placements retain ordinary pose
  edits; mixed gestures group placement edits and actor keys in one transaction.
  Escape or pointer cancellation restores the edit.
- **S17 — Actor authoring and binding.** Actor previews are ordinary declared
  entities from the level catalog, including a bundled placeholder with normal
  parameters. Runtime slots, preview placement IDs and entity types are
  separate identities. Retyping a preview preserves its slot and tracks;
  deleting an actor removes its tracks, events and binding atomically.
  Duplication creates fresh animation IDs. Missing preview bindings are
  repairable without changing the runtime contract.

- **S18 — Live key retiming.** Key dragging updates selected diamonds and the
  sampled preview before release, preserving the current playhead. Retiming
  uses the existing live-edit transaction and reducer, with one undo step per
  gesture. Frame labels expose the proposed timing. Invalid collisions show
  an outline without applying invalid data; releasing there cancels the move.
  Escape/pointer cancellation restores the original document and pose.

- **S19 — Complete authoring controls.** Typed value, contract and event controls
  edit the same document as the optional JSON fields. Contract removal updates
  its dependent tracks/markers atomically. Runtime clip imports retain matching
  preview bindings and all placement setup; missing slots are explicitly
  repairable. Validate before mutation and reject stale asynchronous imports.
  Downloads settle edits before reading accepted data. Timeline zoom, selection,
  marker dragging and frame feedback are local UI state, not another history.

## Module ownership

| Module                                | Owns                                         | Allowed runtime dependencies             |
| ------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| addon `core/types`, `validate`        | JSON grammar and constraints                 | none                                     |
| addon `core/evaluate`                 | values at a frame and position mapping       | core interpolation/easing                |
| addon `core/SequencePlayer`           | playhead, marker traversal, binding dispatch | core ErrorBoundary                       |
| addon `bindings`, `SequenceComponent` | entity setters and engine clock              | core, addon core                         |
| addon `renderer`                      | visual component accessors                   | renderer types, addon bindings           |
| tool `commands`                       | pure document edits                          | addon document/validator                 |
| editor store / draft service          | document projection / authoritative history  | shared document and commands             |
| editor preview / shell                | dormant playback / timeline intent           | addon runtime / store and controller     |
| example                               | actors, scene, event consequences            | addon, renderer, tool for authoring only |

## Design evidence

The level editor's system and module designs were read from the canonical local
planning directory on 2026-10-02. Their relevant shipped counterparts are
`packages/tools/editor/src/shared/commands`, `src/browser/store`, and
`src/browser/preview`. The retained principles are document-first authoring,
one mutation path, explicit ownership, disposable preview, strict runtime
validation, and vertical slices with a real-use gate. Sequence mode extends that same server. Canonical editor rules Q01–Q10
and queue item 86 specify integration ownership and validation gates.

Core already provides `interpolate`, named easing functions and process-based
keyframe tracks. Pure sampling is extracted into the existing keyframe module
and shared with the addon; process scheduling remains owned by core.

External references: [Theatre.js sequence editing](https://www.theatrejs.com/docs/latest/manual/sequences),
[Unreal replaceable bindings](https://dev.epicgames.com/documentation/en-us/unreal-engine/dynamic-binding-in-sequencer),
[Unity assets and instances](https://docs.unity3d.com/Packages/com.unity.timeline@1.8/manual/tl-overview.html),
[Rive layouts](https://rive.app/docs/editor/layouts/layouts-overview).

Workspace references: [Rive interface](https://rive.app/docs/editor/interface-overview/overview),
[Theatre.js Studio](https://www.theatrejs.com/docs/latest/manual/studio),
[Sequence interface](https://sequence.film/docs/get-started/editor-interface).
These separate the central preview, property inspector and lower timeline.
Sequence also documents draggable panel dividers.
