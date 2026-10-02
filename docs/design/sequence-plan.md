# Sequence implementation plan

Rules: [sequence-system.md](sequence-system.md). Evidence and findings:
[sequence-implementation-log.md](sequence-implementation-log.md).

| Slice | Rules                     | Deliverable and gate                                                                                                                                                         | Status   |
| ----- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1     | S01–S07, S13              | Shared keyframe sampling, strict document parser, pure evaluation, player; tests for mapped positions, curves, event ordering and loop boundaries                            | complete |
| 2     | S04, S08–S09, S13         | Entity/visual helpers and scene component; real lifecycle, callback attribution, restore/retain tests                                                                        | complete |
| 3     | S10–S12                   | Command reducer, undo/redo, timeline UI, import/export, silent scrub and explicit event preview                                                                              | complete |
| 4     | S01–S14                   | Two-actor example, editor authoring and runtime replay through exported JSON, wide/tall frame validation, docs, package checks and visual use pass                           | complete |
| 5     | S10–S11, S14–S15          | Persistent preview/timeline, independent panel scrolling, resizable split; desktop, narrow and short viewport regressions                                                    | complete |
| 6     | S04–S05, S10–S11, S16–S17 | Continuous scrubbing, preview transforms with grouped history, actor catalog UI and binding guidance; mapping and browser regressions                                        | complete |
| 7     | S10–S11, S18              | Live key retiming, grouped history, destination feedback and cancellation; browser checks before pointer release                                                             | complete |
| 8     | S10–S18, editor Q01–Q10   | Integrate sequence workspace with the level catalog, shared draft/history and preview; remove standalone tool; independent reviews and real-project use pass (queue item 86) | complete |
| 9     | S10–S19, Q01–Q10          | Complete typed authoring, contracts, event dragging, file round trips, timeline feedback and feature audit (item 87)                                                         | complete |

Implementation order follows a thin end-to-end path, widening the same evaluator
and document owner. Do not invent a separate preview interpolator or store
entity state as authored data. Test contract failures before adding the UI.

The final example must demonstrate proportional travel, anchored offsets,
linear/hold/named/Bézier easing, rotation, opacity and a typed event observed at
the authored pose. Placeholder and real bindings must play the same document.
Tests must compare engine Inspector state, not screenshots. Visual inspection
checks usability and layout separately. Validation includes package unit tests,
typecheck, lint, formatting, emitted root dependency checks, docs build and a
focused Playwright path. Record actual results and limitations, not intentions.

Autonomous choices use the accepted behavior in the system rules. Prefer
existing engine mechanisms, avoid new globals and services, and record any
necessary correction before continuing. The 2026-10-03 request authorizes fixing
the final review findings and submitting the complete feature as a pull request.
