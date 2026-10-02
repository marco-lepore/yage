# Sequence implementation log

## 2026-10-02 — Design and repository study

- Read the level-editor workflow and located its canonical queue in the main
  worktree. This task studies that system; it does not claim or modify its items.
- Studied the level-editor system boundaries, module architecture, delivery
  principles, command DTOs, store, and serialized draft queue.
- Read addon/example guidance and core callback/lifecycle rules.
- Found the existing core keyframe interpolation and EntityHandle mechanisms.
  Plan: reuse both rather than implement parallel sampling or lifetime tracking.
- Recorded accepted decisions as S01–S14 and linked implementation gates to them.
- Chose explicit import/export for this first editor delivery. Project-file
  persistence, shared drafts and recovery are not claimed or implemented.
- Installing this worktree's own dependencies so validation uses its sources.

## Runtime, bindings and authoring slices

- S01–S07: implemented strict JSON parsing, frozen clips, pure sampling, named
  and Bézier easing, RGB/discrete values and both position mappings. Extracted
  sampling from the existing core keyframe mechanism.
- S04, S08–S09: added contract validation, accessor dispatch through ErrorBoundary,
  event traversal at exact poses, loops, silent seek, pause/resume and captured
  restore policies. Entity helpers reuse EntityHandle and normal transform and
  renderer setters. A scene component owns the clock.
- S10–S12: implemented a pure command reducer, bounded undo/redo session and DOM
  timeline. Added key selection/movement, curve controls, event payload editing,
  binding/frame controls and JSON import/export. Preview restores old tracked
  values before rebuilding; incompatible imports are rejected before commit.
- Initial addon tests: 24 passed. Editor tests: 6 passed, including command
  atomicity, undo/export, grouped movement, silent scrubbing and a real DOM edit.
  Package build/typecheck/lint passed (lint warnings are non-null assertions).
- Example typecheck found incorrect renderer container and Scene constructor
  assumptions; corrected both against the existing APIs. Browser inspection
  also found the shared page layout unsuitable for a timeline; the example now
  scrolls and preserves the preview's aspect ratio.
- First Inspector E2E pass verified mapped poses, fixed actor sizes and
  placeholder replacement. It found a final marker missed at floating-point
  accumulation boundaries. Reused core's existing duration tolerance instead
  of introducing a second comparison policy. A separate test locator was fixed
  to match the actual accessible label `Value x`.
- Chromium cannot start inside this macOS sandbox. The regression command was
  authorized by automatic escalation and runs outside that sandbox.

## Final validation — 2026-10-02

- S10–S11: added editable document settings (name, FPS, duration, authored
  rectangle), separate event rows by actor, and overlapping-marker placement.
  Corrected shift selection to include the first selected key. Playhead input
  now seeks on input without a render removing focus; the live browser pass
  confirmed frame 75 and its Bézier controls.
- Preview configuration is read-only outside `configure`. Undo/redo checks the
  current binding contract before changing history. Rebuild restores old
  tracked values; destruction retains them to avoid writes during scene teardown.
- The dev server had retained older transforms during worktree builds. Restarted
  it and reran both browser paths against the rebuilt packages. One overlapping
  docs/package build briefly removed declarations under another build; the
  standalone docs rerun passed. These were validation-environment issues.
- Core: **63 files / 1,760 tests passed**, including the shared sampler tests.
- Addon: **25 tests passed**. Editor: **7 tests passed**. Package builds,
  typechecks and lint passed; non-null assertions produce warnings, not errors.
- Examples: typecheck, lint and production build passed.
- Browser: **2 Playwright tests passed** using
  `npx playwright test --config=e2e/sequence.config.ts`. Assertions use Inspector
  component data: quadratic/cubic movement, hold, Bézier midpoint, rotation,
  opacity, proportional/anchored placement, fixed actor dimensions, placeholder
  replacement, silent scrubbing and all four event consequences at marker poses.
- The authoring path changes a position key, uses undo/redo, changes easing and
  an event frame, exports JSON and uploads that file on the runtime page. Both
  actors complete the exported sequence. Runtime requests contain no editor
  module. The test is also included in the root Playwright examples project.
- Emitted addon root dependency check passed across **7 files**, including shared
  chunks and declarations: no renderer, Pixi or tool imports.
- Documentation: **11 tests passed**; TypeScript snippet checks passed; the docs
  build produced **952 pages** and verified their agent-discovery links.
- Changesets status passed with separate core, addon and tool notes. Formatting
  and diff whitespace checks passed. No commit, push or publication performed.
- Visual evidence: the browser preview shows two differently sized actors at
  frame 75, the timeline and the selected Bézier segment. A saved screenshot is
  outside the repository; the example remains open at
  `http://127.0.0.1:5198/sequence.html?debug=1`.

### Delivery limits

The editor is an embeddable browser tool with JSON import/export, not a
project-file server. Contracts come from the host document; the UI edits tracks,
keys, markers and document settings. Event consequences are not reversible.
The addon does not arbitrate arbitrary gameplay property writes, blend players,
spawn actors, animate curved spatial paths or save an in-progress playback.
These limits are explicit in the system rules and user documentation.

## Workspace layout revision — 2026-10-02

- Compared the official [Rive interface](https://rive.app/docs/editor/interface-overview/overview),
  [Theatre.js Studio](https://www.theatrejs.com/docs/latest/manual/studio), and
  [Sequence interface](https://sequence.film/docs/get-started/editor-interface).
  Adopted a central preview, right inspector and full-width lower timeline.
- S15 records the persistent-workspace rule. Plan slice 5 references S10–S11
  and S14–S15. The example fills the viewport; a pointer/keyboard divider shares
  height between preview and timeline. Inspector and tracks scroll separately.
- Document and preview settings collapse in the inspector. Playback controls
  stay above the tracks; the event log expands below them. Track labels and the
  ruler stay visible when scrolling. Selection preserves panel scroll positions.
- Added the optional host-owned preview element to the existing mount API.
  It stays mounted during edits and returns to its original DOM position and
  slot on destruction. Invalid mounts fail before moving the element.
- Browser tests caught a settings disclosure closing after an edit. The shell
  now reads disclosure state before rebuilding controls, avoiding delayed toggle
  events from discarded elements.
- Validation: **9 editor unit tests** and **5 Playwright tests passed**, including
  the two existing authoring/runtime paths and viewport checks at 1280×800,
  700×900 and 900×600. Package build/typecheck/lint passed (24 warnings, no errors).
  Docs build, typecheck and tests passed; 952 rendered pages verified.
- Manual browser use confirmed independent inspector scrolling and pointer
  resizing while both actors and timeline remain visible. Saved visual evidence
  as `sequence-workspace.jpg` outside the repository. Work remains uncommitted.

## Direct manipulation and actor controls — 2026-10-02

- Recorded S16–S17 and plan slice 6 for timeline drag scrubbing, preview
  authoring and explicit actor/binding controls.
- Empty lanes and the ruler capture pointer movement, seek continuously and
  clamp to the duration. Scrubbing remains silent and does not edit keys.
- Added host-projected move, scale and rotation controls. Gestures sample the
  document, edit the rounded cursor frame, update an existing key or add one,
  and create missing transform tracks with explicit defaults. Each drag is one
  undo step; Escape/pointer cancellation restores the initial edit. Completed
  gestures select the affected key and bring its track into view.
- The evaluator now owns forward and inverse position mapping through the same
  calculation. Preview moves preserve proportional, contain and anchored modes.
- Actors & bindings uses the existing host binding sets as its available list.
  Add creates a contract and initial tracks; Remove deletes that actor's
  contract, tracks and markers atomically. No extra entity registry or runtime
  actor spawning was added to the addon. Host visibility follows document IDs.
- The example supplies a third real actor, Lumen, and a matching placeholder.
  Added inline binding guidance and complete game-side binding documentation.
  Actor creation remains in the Scene; runtime targets match exported IDs.
- Validation: **29 addon tests**, **13 editor tests**, and **8 browser tests
  passed**. New checks cover inverse mappings, grouped history/cancellation,
  repeated edits of the same key, missing scale/rotation tracks, actor removal
  and undo, continuous scrubbing before release, and exported three-actor
  playback through Inspector. Existing viewport and two-actor tests still pass.
- Package builds/typechecks/lint and example typecheck/lint passed. Documentation
  typechecks/tests/build passed, including 952 rendered pages. Changesets status
  and diff whitespace checks passed. Lint reports warnings but no errors.
- Manual use added Lumen and dragged it to create a selected frame-75 key while
  keeping the preview and timeline visible. Screenshot saved outside the repo
  as `sequence-interactions.jpg`. No commit, push or publication performed.
- Current boundary: available actors come from the host; the editor does not
  instantiate arbitrary entity classes. Built-in preview handles assume no
  rotated/scaled parent; custom hierarchies can provide a custom preview.

## Live keyframe retiming — 2026-10-02

- Added S18 and plan slice 7. Dragging keys now updates their positions and
  resamples the actor preview before pointer release. The playhead remains at
  its current time, including fractional frames.
- Reused the session's live-edit transaction and command reducer. Added an
  optional snap flag to beginEdit so key retiming preserves the playhead while
  preview transform authoring retains whole-frame snapping.
- Selected keys move together with an outline and destination-frame label.
  Movement stays inside the sequence and frame-zero keys stay fixed. Collisions
  show a red outline without applying invalid values. Releasing at a collision
  or cancelling with Escape/pointer cancellation restores the original data.
- One completed drag creates one undo step. Returning to the original timing
  leaves history unchanged. Pointer listeners and capture are released on
  completion, cancellation, rerender and destruction.
- Editor build/typecheck/lint and **13 unit tests passed**. All **11 browser
  tests passed**, including assertions before pointer release for live diamond
  positions and actor poses, multi-selection cancellation, collision feedback,
  preserved fractional playhead, silent editing and one-step undo.
- Documentation typechecks/tests/build passed; 952 rendered pages verified.
  Saved and inspected a screenshot captured during the drag at frame 100, with
  the preview rendered at playhead 75.5. The screenshot is outside the repository
  as `sequence-live-key-drag.png`. Work remains uncommitted.

## Level editor integration — 2026-10-02

The preceding entries describe the standalone experiment. Its editor package,
local history and host-provided actor catalog are replaced by sequence mode.
Canonical editor queue item 86 records the decision and mandatory review gates.

- Studied all five original editor planning documents and extended them with
  rules Q01–Q10, independent workspaces and explicit runtime slot bindings.
- Extended the shared document codec, command reducer, per-file drafts and
  exact-revision saves. Actor operations are atomic transactions.
- Reused declared entities, parameter controls, assets, dormant preview,
  selection and transform tools. Sampled parent poses feed manipulation math;
  transform edits write cursor-time keys through inverse position mapping.
- Added live key retiming, silent drag scrubbing, typed event payload data,
  marker logs, frame mapping controls and preview type replacement.
- The first use pass found sequence coordinates outside the level camera's
  default view. Sequence opening now centers its rectangle; Fit frame restores
  it. Fixed mode-button focus, stale timeline commits and frame-zero events on
  resume. Focused tests cover these contracts.
- Removed the standalone authoring package. The runtime example reads the
  nested clip from the same workspace and supplies real actor bindings.
- Integration verification and independent review results are recorded below
  when complete; earlier standalone counts do not validate this migration.

### Integration validation and review gate

- Three independent first-round reviews identified six bounded defects: inverse
  position mapping on insertion, anchored key insertion, track-kind defaults,
  custom-kind preview projection, hierarchy command preconditions, and runtime
  parent ordering. Fixed each and added regressions. A fourth independent
  reviewer approved the corrections and invalid/no-op drag behavior.
- Editor: 1,794 unit tests passed; addon: 30; core: 1,760. All seven sequence
  browser tests and all 50 existing level-editor browser tests passed.
- Builds and typechecks passed for the affected packages, examples and docs.
  Lint has warnings but no errors. Docs tests, 1,511 checked snippets, the
  952-page build, import boundaries and headless workspace validation passed.
  Changesets parsed; existing monorepo peer-range warnings remain.
- Manual use authored a cursor key through the existing move gizmo, replaced
  the preview type, edited placeholder parameters, and undid those edits.
  Both 1280x720 and 1024x640 retain preview and timeline, with a movable divider.
  Removed level-only runtime-key guidance from sequence preview inspectors.
- Canonical item 86 and plan slice 8 are complete. The independent reports
  accompany item 86; all five canonical editor documents reflect ownership.
  Runtime slots stay separate from preview placements. Custom channels are
  authored for game targets; only standard channels have a visual preview.
  Screenshot: /tmp/yage-sequence-mode.jpg. No commit or publication performed.

## Sequence authoring completion — 2026-10-02

Canonical editor queue item 87 closes the authoring gaps left by integration.
Rule S19 extends the existing document and command contracts.

- Added typed controls for every property kind, named and Bézier easing,
  contract properties, events and payload fields. Removing declarations updates
  dependent tracks or markers in the same command. Raw JSON remains optional.
- Added track removal, multiple-key deletion, frame stepping, timeline zoom,
  marker dragging and visible proposed-frame feedback. Preview and timeline
  retain their independent scrolling and shared resizable divider.
- Added runtime clip import and clip/workspace downloads. Import preserves
  preview placements and matching bindings; missing slots can reuse an unbound
  preview or create a placeholder. Invalid imports leave the document intact.
- Three distinct independent reviews confirmed late-import and export ordering
  defects and stale selected-key IDs. Import now refuses transients begun during
  file reading; export refuses newer pending/transient work and returns the
  committed revision only. Selection filters deleted keys and resets on file
  changes. A fourth independent reviewer accepted all bounded corrections.
- Built **Curtain call** through the editor from a blank workspace in the actual
  examples project. Added two declared actors, changed their appearance, authored
  proportional travel, rotation, scale, named/Bézier easing and typed gestures.
  Changing an existing track to anchored coordinates initially moved the actor.
  The controller now converts keys with the shared sampler and inverse mapping.
  The rebuilt editor preserved the pose; saved and reloaded playback logged both
  expected markers. Browser-session recovery required a fresh tab once; no data
  was lost. Both use-pass findings are disposed.
- The saved Curtain call workspace loads through the game example's file input.
  Inspector checks verify two runtime targets, final poses, explicit scale,
  unchanged actor dimensions and events dispatched at their authored poses.
- Final focused results: 1,803 editor unit tests, 12 sequence browser cases and
  all 50 existing level-editor browser cases passed. The sequence cases ran as
  11 regressions plus the new authored-workspace playback case. Editor build,
  typecheck and lint passed; lint reports warnings and no errors. The correction
  reviewer ran 57 tests including repeated baseline cases.
- Both documentation surfaces describe the complete controls and binding flow.
  Documentation checks passed: 11 tests, snippet checking, and 952 generated
  pages. The complete monorepo gate passed all 129 tasks (43 cached), covering
  build, typecheck, lint, tests and repository checks. Formatting, Changesets
  parsing and headless validation of both workspaces passed.
- The first monorepo run timed out in two unchanged synth tests under 40-task
  contention. All 89 synth cases passed alone; the final gate used concurrency 2. Repository checks also required renaming a private UI callback from
  `onRemove` to `onDelete` to avoid a reserved component lifecycle name.
- Item 87 and plan slice 9 are complete.
- No runtime API or format was added in item 87. Custom property channels remain
  data for game bindings; standard channels have editor previews. Earlier
  exclusions such as blending and nested sequences remain outside the accepted
  scope. No commit, push or publication performed.

## Final review corrections and PR — 2026-10-03

The user requested fixes for the three additional review findings and a PR.

- Preserved lifetime methods on the original target, including class prototype
  methods. Expired targets are rejected before property writes.
- Stopped the current operation when a binding callback pauses, cancels or seeks
  playback. Remaining setters and markers do not run, and completion does not
  replace cancellation. Restoration retains the same interruption behavior.
- Kept unbound preview placement transforms in the normal pose command. Mixed
  selections group context placement changes and actor keys in one undo step.
- Added failing regression tests before the fixes. The corrected addon passes
  38 tests and the editor passes 1,804. A fresh independent reviewer found no
  remaining defect and passed five additional callback/reparent probes.
- Updated the branch to the latest main before verification. All 129 repository
  tasks passed (82 cached), including build, typecheck, lint and tests. All 12
  sequence and 50 level-editor browser tests passed. Formatting, Changesets and
  whitespace checks passed. Existing lint/build and peer-range warnings remain.
- Rules S07, S09 and S16 and both documentation surfaces describe the verified
  behavior. The corrections keep the existing public APIs and document format.
