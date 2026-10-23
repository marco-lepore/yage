---
"@yagejs-addons/sequence": minor
---

Add authored keyframe sequences and the editor's Sequence mode.

- `SequenceClip` validates a runtime clip and samples typed keyframes with easing, including cubic Bézier curves. Each position track maps its points into the `rect` passed to `play`, proportionally or as an anchor plus pixel offsets, without scaling the actors.
- `SequencePlayer` and `SequenceComponent` play a clip on scene time with `pause`, `resume`, `seek`, `cancel`, `speed` and `loop`. The `finish` and `cancel` policies keep the last values or restore the values the targets had when playback started.
- An event marker dispatches its typed payload after the pose at its frame is applied. Pausing, cancelling or seeking from a binding callback stops the current update.
- `transformSequenceTarget`, `visualSequenceTarget` from `@yagejs-addons/sequence/renderer`, and `combineSequenceTargets` bind a clip's target slots to entities. `SEQUENCE_TRANSFORM_PROPERTIES` and `SEQUENCE_VISUAL_PROPERTIES` list the properties the two targets provide. `SEQUENCE_VISUAL_ACCESSORS` is the table of visual reads and writes that `visualSequenceTarget` binds.
- `sequenceProperty` and `sequenceEvent` build typed bindings for custom properties and events. `validateSequenceTargets` checks targets against a clip's contracts without reading or writing anything.
- `SequenceClip.unmapPosition` converts a position on screen back into a key value for a track.
- `parseSequenceFile` reads a saved file: the runtime clip of a workspace saved in Sequence mode, or an exported runtime clip.
- `@yagejs-addons/sequence/document` exports `parseSequence`, `parseSequenceFile`, the document types, and the lists of property kinds and named curves, for tools that run without the engine.
