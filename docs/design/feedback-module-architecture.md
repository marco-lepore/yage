# Feedback implementation architecture

Feedback collects comments with immutable runtime evidence and gives agents an
explicit acknowledgement workflow. The implementation follows the editor's
separation of UI, async coordination, state transitions, and file operations.
It has no dependency on editor documents or lab internals.

## Owners

| Module                   | Owns                                                                                        | Calls                                      |
| ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `browser/FeedbackPlugin` | Installation and teardown                                                                   | Runtime host, session, client, panel       |
| `browser/runtime`        | Inspector time lease, input clearing, HUD visibility, canvas capture, visible entity bounds | Core, renderer, debug contracts            |
| `browser/session`        | Active observation, pending upload identity, abort lifetime, saved session comments         | Host contract, HTTP client                 |
| `browser/ui`             | DOM controls, selection gestures, entity filtering, keyboard shortcuts                      | Session                                    |
| `client`                 | Loopback HTTP requests and response decoding                                                | Shared DTOs                                |
| `shared`                 | Data contracts and pure workflow transitions                                                | No environment-specific module             |
| `server/http`            | Routes, origins, request limits, HTTP errors, server lifetime                               | Service and directory lock                 |
| `server/service`         | Input validation, serialized writes, revision checks, transition timestamps                 | Shared workflow and file layer             |
| `server/files`           | Atomic files, immutable evidence checks, directory ownership                                | Node filesystem and shared record decoding |
| `server/cli`             | Argument validation and JSON output                                                         | HTTP client; server startup for `serve`    |

Top-level `index.ts`, `server.ts`, and `cli.ts` are entry points. ESLint prevents
UI imports of runtime or HTTP code, prevents the CLI from accessing comment
files directly, and confines filesystem imports to the file layer. Tests use
real temporary directories and HTTP servers.

## Evidence and mutable workflow

A capture and its PNG are immutable. The authored part of a comment is also
immutable: ID, capture ID, text, timestamp, and target. Status, revision, and
history are server-owned. An upload cannot submit workflow history.

Each comment begins at revision 0 with status `open`. The accepted sequence is
`open → ingested → addressed → resolved`. Reopening any non-open comment
returns it to `open`. Each transition records actor, server timestamp, optional
note, previous/new status, revision, and request UUID. Reading does not change
any of these fields.

A transition supplies the revision the caller read. The server checks that
revision and commits inside its write queue. Competing agents cannot both
ingest the same revision. The request UUID identifies one exact command;
repeating it returns the current record without adding history. Reusing it
with different arguments fails. Retrying the original browser upload compares
only authored data and evidence, so it cannot reset an ingested comment.

Original MVP comments have `status: open` without workflow fields. Reading
normalizes these to revision 0 and empty history without touching the files.
The first transition writes their workflow. No screenshot or capture migration
is necessary.

## Persistence and failures

Only one server may own a directory. Startup exclusively creates
`.server.lock`; graceful shutdown waits for accepted writes before releasing it. Failed binding
also releases it. Crash recovery
requires checking the recorded PID before manually removing a stale lock.
Automatic stale-lock takeover is deliberately absent: it must not allow two
live writers.

A capture becomes visible by renaming a complete temporary directory containing
its JSON and PNG. The comment is published afterward by atomic rename. A failed
capture write cannot publish its comment. A failed transition leaves the
previous comment intact. These are atomic visibility guarantees, not a promise
of persistence after power loss; writes do not call `fsync`.

The browser session owns one pending upload and keeps its ID across uncertain
responses, cancellation, and closing/reopening the composer. DOM controls cannot edit that pending payload. Teardown aborts the
request and changes the active session identity; late results cannot publish
into a later observation. Aborting does not undo a server commit. Discarding a
local pending draft likewise does not remove a saved comment.

Expected invalid, conflicting, stale, and missing requests have stable error
codes. File failures remain server errors. The server accepts JSON only, caps
requests at 24 MiB, binds loopback, and checks browser origins.

## Host integration

`enabled` takes the same debug flag the application passes to `Engine`. This
keeps release builds free of feedback DOM and keyboard listeners without reading
private engine configuration or adding core APIs. `shortcuts: false` lets a
host reserve keyboard controls. The DOM interface uses F8 for feedback and F9
for freeze, ignores editable fields, and remains independent of the game loop.

The runtime host captures inspector and image in one synchronous task while it
owns frozen engine time. It hides the debug HUD for the render/copy operation
and restores prior visibility. Leaving releases the lease and preserves a
pre-existing freeze. The `context` callback adds JSON source metadata through
ErrorBoundary attribution.

The runtime host contract is internal. Lab playback currently needs an explicit
Pause because it owns the inspector clock. An editor adapter will need its
preview coordinator to provide clock cooperation and level/draft metadata.
Those adapters must reuse the session and DOM modules. They must not create a
second feedback store or independent capture UX. No editor package changes or
agent skill are included in this implementation.

## Verification record (2026-09-08)

- Seven automated tests cover complete evidence persistence, upload conflicts,
  invalid captures, HTTP origins, concurrent ingestion, lifecycle/retry/restart,
  legacy reads, and exclusive directory ownership.
- Browser runtime checks saved entity, area, and global comments across frames
  783 and 786. The clock stayed at frame 783 during the first two comments;
  input remained empty and inspector callback errors remained empty.
- The separate CLI process read capture `deb81909-4925-425a-970e-9ccc3eb4ac6a`
  and moved acceptance comment `62778393-4284-44fa-98a1-c4143b000937` through all
  four transitions. Exact retries left revision 4 unchanged. A stale competing
  request failed, and the source comment remained unchanged.
- The three user-authored MVP comments remain open; read access preserves their
  original file bytes.

The private package is an implementation under development. The earlier
[feasibility record](feedback-tdd.md) retains the initial experiment and host
limitations; this document owns the implementation boundaries and lifecycle.

- Additional browser checks verified disabled mode, F8/F9, shortcut isolation in
  the composer, and teardown. Lab reuse preserved paused frame 3796 and released
  its time lease after saving. Typecheck, lint, tests, package build, boundary
  rule tests, and the documentation build passed.

## Review fixes (2026-09-08)

Cancel, Return, and Escape can stop a pending upload. Closing releases the
runtime lease while preserving the pending observation in the session. Reopening
freezes the current runtime and displays the retained observation; it does not
replace the evidence with a later frame. Transport imposes a 30-second timeout.
Only the current request may publish its result into session state.

Evidence comparisons use recursively sorted object properties while preserving
array order. PNG validation requires complete chunks, one bounded header,
checksums, and decoded pixels. A 16,777,216-pixel limit and rejection of
interlacing bound decoder allocations for canvas screenshots. HTTP validates
loopback authority before the Origin gate, including origin-less CLI requests.
