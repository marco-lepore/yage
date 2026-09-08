# YAGE feedback: technical design and feasibility MVP

Status: feasibility MVP implemented and validated, 2026-09-08. This document
records proposed contracts and the experiment. The subsequent
[implementation architecture](feedback-module-architecture.md) defines current
module ownership and CLI workflow; the private package is not a
released API.

## Outcome

A developer pauses a YAGE view, selects entities or an area (or leaves the
target global), and writes comments. A local server saves the comments with
the captured image, inspector snapshot, and host context. `yage-feedback`
lists those observations and returns their evidence to a coding agent.

```ts
const feedback = new FeedbackPlugin({
  enabled: debug,
  server: "http://127.0.0.1:5212",
  context: () => ({ host: "runtime", example: "formation" }),
});
engine.use(feedback);
```

The same plugin owns the HTML/CSS/JavaScript interface in a standalone game,
lab, or editor. Hosts add context and, when necessary, selection and comment
mode behavior. Runtime comments do not require level data. Applying code or
level changes is separate from collecting feedback.

## Ownership and dependencies

`@yagejs-tools/feedback` has separate browser and Node entry points. The
browser entry exports the engine plugin and feedback types. The Node server
and executable import the shared wire format, never browser or engine code.
The browser imports core and renderer, and uses the existing debug time
controller. Optional input support clears held input on entry and exit.
No dependency points from core, renderer, debug, editor, or lab to feedback.
Projects install the plugin through their engine or lab harness.

Core does not own comments, storage, HTTP, or DOM controls. Missing observable
state belongs in the Inspector. Renderer-specific capabilities belong in the
renderer. A future shared viewport capture API should absorb existing callers
rather than adding another implementation alongside lab capture.

The DOM interface lives outside the game ticker. It owns the composer,
selection outlines, area gesture, capture display, and session comment list.
A runtime adapter collects real engine state and visible target geometry.
The MVP exposes host metadata through a synchronous attributed callback.
Editor selection overrides and custom enter/leave hooks are design extension
points, not speculative public methods in the MVP.

## Observation and identity

A browser plugin instance creates a session UUID. Entering comment mode
creates an immutable capture UUID. Multiple comments can reference one
capture; resuming and re-entering creates another capture in the same session.
Each comment has its own UUID so retrying an uncertain write is idempotent.

Capture data contains a format version, session/capture IDs, timestamp, frame,
inspector snapshot, JSON host context, page URL, image dimensions, and target
geometry in image pixels. The PNG is a separate file. Entity targets contain
scene ID, runtime entity ID, generation, name, and image-space bounds. Runtime
identity is scoped to the captured session, never treated as a durable source
location. Host context can add level path, draft revision, experiment, or
source hints. Metadata is evidence, not an instruction to the agent.

Targets are `global`, `entities`, or `area`. An area stores an image-space
rectangle even when empty. Captured camera and viewport metadata explain the
projection. The MVP does not invent a world rectangle for multi-camera or
HUD content; world coordinates remain available on snapshot entities. A
future host-provided world mapping must name its scene/camera and preserve
four corners under rotation.

## Capture and interaction

1. Remember whether debug time was already frozen, then freeze it.
2. Temporarily hide the debug HUD, render and synchronously copy the visible
   canvas to PNG, then restore the prior HUD visibility even on capture failure.
   Do this without advancing
   simulation. Capture the inspector and host context in the same JavaScript
   task. This avoids content-bounds extraction including off-screen objects.
3. Present that immutable image in a DOM dialog, with an overlay for entity
   selection or rectangle drawing. Coordinates refer to image pixels and
   scale with the displayed image. A detached view avoids drift from host
   scrolling, resizing, camera movement, or layout changes while writing.
4. Save any number of comments against that capture. Failed saves retain the
   text and target and can be retried using the same comment ID.
5. On leaving, clear held input and thaw only when feedback froze the clock.

Selection uses real rendered geometry, includes multiple visuals per entity,
and checks inherited visibility. Overlapping bounds are ambiguous: the MVP
offers a searchable entity dropdown rather than claiming pixel-perfect
topmost picking. A click selects a candidate; Shift adds/removes candidates.
Area selection is a distinct mode. Global clears the target.

The dialog receives browser keyboard and pointer input, and stops propagation
before document-level gameplay listeners. Modal browser behavior makes the
underlying page inert. Input is cleared through the existing input manager,
when installed. Arbitrary window capture listeners, external timers, audio,
network callbacks, and other applications are outside engine-time freezing.
The MVP must record any observed interference rather than claim full process
suspension. On plugin teardown the dialog is removed and owned freeze state
is released. No callbacks continue after teardown.

## Server, persistence, and CLI

The server binds loopback and accepts JSON requests from configured local
browser origins. It uses an explicit data directory and creates UUID-named
capture directories beneath it; clients cannot submit filesystem paths.
One upload contains a complete capture, PNG data URL, and one comment.
The server validates shape, IDs, finite coordinates, target membership,
PNG dimensions, and bounded request size before writing.

A capture is written to a temporary directory and renamed into place after
its JSON and PNG exist. A comment is written atomically only after its capture
is complete. The server serializes writes. Reusing an ID with different data
is a conflict, not an overwrite. A capture left without a comment after a
failed write is harmless; a visible comment with missing evidence is not.
Restarting the server reads the files; no separate in-memory index is needed.

`yage-feedback serve --dir PATH --port 5212 --origin http://localhost:5213`
starts storage. `yage-feedback list --server URL` returns JSON summaries.
`yage-feedback show ID --server URL` returns the comment, full capture
metadata/snapshot, and an absolute screenshot path on this local machine.
HTTP evidence routes also let browser clients retrieve the image. CLI errors
exit nonzero. The MVP ends when a separate CLI process can retrieve actual
browser-authored feedback and readable PNG evidence after a server restart.

The threat model is a developer tool on their own machine. Loopback binding,
origin checks, fixed storage layout, request limits, and atomic writes address
accidental exposure and data loss. This is not a hosted multi-user service.

## MVP scope and acceptance

The package remains private. A small moving formation uses real Engine,
RendererPlugin, DebugPlugin, InputPlugin, and FeedbackPlugin instances. A real
lab harness uses the same plugin and scene. There are no mocked renderer,
inspector, persistence, network, or CLI substitutes in acceptance validation.

Required checks:

- A PNG contains the visible viewport at the expected dimensions, including
  background and fit, and excludes DOM comment UI and off-screen content.
- Entity, multi-entity, empty-area, and global comments reach the CLI with
  matching frame, target IDs, image coordinates, and context.
- Two captures from different frames persist in one session; multiple
  comments can share a capture without overwriting evidence.
- Time is stable during commenting, resumes afterward, and stays frozen if
  frozen before entry. Text and pointer gestures do not reach game input.
- Host resize does not invalidate the captured image's target coordinates.
- A failed upload retains the draft; retry does not duplicate comments.
- Server restart preserves evidence. Concurrent writes and ID conflicts do
  not overwrite existing comments or captures.
- Plugin teardown removes the DOM interface and restores owned pause state.
- The same browser mechanism works inside a real lab harness without changing
  the lab package. Integration limitations are recorded with evidence.

The editor's custom placement selection, addressed/resolved lifecycle,
agent skill, automatic repairs, world-region mapping, replay/video, and a
hosted service are outside this experiment. Editor integration can be claimed
through its existing execution queue once the shared runtime proof is sound.

## Findings and validation

The shared implementation works in a standalone game and an actual lab
harness. The MVP changed no source in core, renderer, input, debug, lab, or
editor. It adds a private workspace package, a demo, and documentation.

### Measured results

| Check                                              | Result                                                                                                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser → HTTP → filesystem → separate CLI process | Six comments read successfully with `list` and `show`, across four captures and both runtime and lab hosts.                                                                                                                 |
| Entity, multi-entity, area, global                 | A click selected one scout; a checklist selected two scouts; a drag selected an empty region; global comments stored no entity target.                                                                                      |
| Multiple observations                              | Runtime frame 1164 held two comments on one capture; frame 1167 held another capture in the same session.                                                                                                                   |
| Capture consistency                                | Stored capture frames matched inspector frames. Runtime PNGs were 1920×1080 (the canvas backing size after fit and display scaling); the lab PNG was 800×450.                                                               |
| Viewport accuracy                                  | Visually inspected the actual saved PNG and DOM dialog. The off-screen scout was absent from image and candidates. The PNG excluded the DOM composer and selection outline.                                                 |
| Pause and input                                    | Frame 1164 stayed unchanged through typing, checkbox selection, rectangle drawing, and host resize. Inspector input keys/actions stayed empty. Returning resumed time. A pre-existing freeze remained at frame 1169.        |
| Lab reuse                                          | The same plugin captured frame 1951 with lab context. Leaving released its lease but preserved the lab's paused state. Lab Play then advanced again.                                                                        |
| Actual connection failure                          | Stopped the real storage server. The browser retained the text and frame 2018; restarting and retrying saved exactly one comment. Earlier records remained readable.                                                        |
| Teardown                                           | Destroyed the real engine while the dialog was open: zero feedback dialogs, zero launcher buttons, no remaining time ownership, no callback errors.                                                                         |
| Failed-save exit                                   | A rejected write retained its draft; discarding it allowed Return to view and released clock ownership. Keyboard activation of the launcher did not reach game input.                                                       |
| Storage and HTTP checks                            | Four tests use temporary filesystem directories and a real loopback HTTP server. They check retries, concurrent comments, conflicts, invalid targets/frames/dimensions, origin rejection, PNG retrieval, and restart reads. |

Validation commands from the repository root:

```sh
npx turbo run typecheck lint test build --filter=@yagejs-tools/feedback
node packages/tools/feedback/dist/cli.js list
node packages/tools/feedback/dist/cli.js show COMMENT_ID
```

Package typecheck includes the demo and real lab harness. The repository's
measure checks also passed. Browser validation used Playwright CLI against
the running demo and lab, with real pointer/keyboard events and inspector
assertions. `checks/runtime.js` and `checks/lab.js` in the package preserve the
repeatable browser steps; the outage and restart were performed by stopping
and restarting the actual CLI server. Browser screenshots and CLI evidence
are generated under `output/playwright/` and are excluded from Git.

### Constraints discovered and remaining work

1. **Lab clock ownership is a real integration requirement.** Lab playback
   owns an exclusive `Inspector.time` lease even though the debug ticker is
   frozen. The plugin checks ownership and refuses entry until Lab Pause is
   pressed. Automatic entry needs a host hook that pauses LabClock, lets
   feedback acquire the existing lease, and restores lab play state on exit.
   Changing `isFrozen` alone would not stop lab-issued frames. No new core
   clock mechanism is needed.
2. **Viewport capture and content capture differ.** The inspector's existing
   capture method extracts content bounds. The MVP calls the public
   renderer's `application.render()` and immediately copies its canvas,
   which preserves viewport clipping, background, and display resolution.
   This passed in Chrome's WebGL path. WebGPU, other browsers, custom
   renderers, and cross-origin textures have not been validated. Promote a
   viewport capture API into the owning shared renderer/inspector capability
   before production integration, and reconcile the lab capture caller there.
3. **Bounding boxes are useful but not pixel hit tests.** Candidates use
   `VisualComponent.renderObject.getBounds()`, inherited visibility, and
   viewport clipping. The existing inspector render facet contains world
   bounds and local visibility, which alone cannot describe screen picking.
   Masks, filters that displace pixels, and exact paint order need renderer
   support or host selection. A background overlaps most clicks; the MVP
   tells the user to use the entity dropdown. Invisible editor placements need
   the editor's own selection adapter.
4. **Engine time is not process suspension.** The lease blocks competing
   inspector step/drive calls. It does not suspend browser timers, promises,
   network work, audio, or game-owned capture-phase window listeners. Captures
   are copied synchronously and then displayed as an immutable image.
5. **Persistence scope is one server per directory.** Writes are serialized
   within that server; multiple independent writers to the same directory
   have not been supported or validated. A process crash can leave ignored
   staging directories or captures without comments. JSON/PNG commit uses
   rename, not power-loss durability guarantees.
6. **The DOM dialog is the proof UI.** It displays a captured viewport rather
   than drawing over a live canvas. Comments persist, but the small in-dialog
   history covers only the current plugin instance. Full browsing, response
   statuses, editor adapters, and an agent workflow are not implemented.

There is no blocker to the agreed shared-plugin architecture. Lab clock
handoff and precise host selection need explicit integration before claiming
transparent support in every editor/lab state.

### Entity picker follow-up (2026-09-08)

The entity selector is a searchable multi-select dropdown. It filters by
name, runtime ID, or scene, preserves selections across filters, and renders
50 results per page. A compact selection summary stays visible when closed.
Browser checks verified filtering and selection in the real demo. A separate
2,000-entry DOM component check verified the 50-row bound and selection
retention between the first and last entries; it did not simulate 2,000
running engine entities.
