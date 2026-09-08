# @yagejs-tools/feedback (private workspace package)

DOM feedback UI over a real YAGE view. Requires RendererPlugin and DebugPlugin.
No runtime dependency from engine packages to feedback.

```ts
import { FeedbackPlugin } from "@yagejs-tools/feedback";
engine.use(
  new FeedbackPlugin({
    enabled: debug, // Same application flag as Engine({ debug }).
    server: "http://127.0.0.1:5212",
    context: () => ({ host: "runtime", experiment: "formation" }),
  }),
);
```

`context` returns finite acyclic JSON, copied once per capture. Exceptions are
attributed through ErrorBoundary. Optional InputPlugin support clears held
input on entry/exit. The plugin acquires the inspector time lease, renders
and copies the canvas without stepping, and displays the immutable image in
a modal HTML dialog. Capture temporarily hides the debug HUD and restores its
previous visibility even if image capture throws. Teardown removes the UI and releases owned time state.

Targets: `global`, `entities` (scene ID, runtime ID, generation, name, bounds),
`area` (image-pixel rectangle). Multiple comments reference one capture.
Resume/re-enter creates a new capture in the same plugin session. Snapshot
camera and world state are evidence; no world-region conversion is inferred.

Vite 8: `import { yageFeedback } from "@yagejs-tools/feedback/vite"`;
add `yageFeedback()` to Vite plugins. Omit runtime `server` for automatic
discovery; explicit `server` wins. Dev only, local HTTP only. No production
routes or metadata. Options: `directory` relative to Vite root (default
`.yage/feedback`), `basePath` relative to Vite base (default `/__yage/feedback/`).
Gallery: `<origin><vite-base>__yage/feedback/`; API: gallery URL + `api/`.
Shares Vite's actual port, including port fallback. One owner per storage
directory; shutdown/restart releases ownership. Ignore `.yage/feedback/` in git.

Gallery filters pending (open+ingested), each status, or all; text/entity search;
24 cards/page. Detail includes target outlines, snapshot/context, and history.
Refresh reloads records. Select IDs and copy Codex/Claude skill instructions
with project and full API URL. Clipboard denial offers selectable text. No
read/copy operation mutates status. Agent skill is installed separately.

CLI: `yage-feedback serve --dir PATH [--port 5212] [--origin URL]
[--base-path /] [--project PATH]`,
`yage-feedback list [--status STATUS] [--server URL]`, `yage-feedback show ID [--server URL]`.
Repository invocation: `node packages/tools/feedback/dist/cli.js ...`.
`show` returns JSON with comment, capture (full snapshot/context), absolute
PNG path, and HTTP image path including the API prefix. `--server` accepts
full local HTTP base URLs with paths, with or without trailing slash.
`serve --port 0` prints an OS-allocated port. Standalone gallery is API base +
`gallery/`; project defaults to working directory. Stop Vite before opening the
same storage with `serve`. Data remains readable after browser/server
restart. One server per directory. Retries are idempotent; conflicting IDs
reject. Server binds loopback; repeated `--origin` overrides allowed origins.

Lab harnesses can include the same plugin. Pause LabClock first: its play
lease prevents feedback entry. Selection is bounding-box based, with a
searchable multi-select dropdown for overlaps (name/ID/scene filter, 50 results
per page, selection retained across filters). Capture was verified in Chrome/WebGL. External
timers/audio/network are not frozen. Feedback collects evidence and tracks work; it does not apply changes or run an agent.

`enabled: false` mounts no UI or listeners. Compact DOM feedback/freeze controls
support F8/F9. `shortcuts: false` reserves keys for the host. Editable fields
and open dialogs ignore shortcuts.

Workflow: open → ingested → addressed → resolved; reopen any non-open comment.
`yage-feedback ingest|address|resolve|reopen ID --revision N --by ACTOR
--request-id UUID [--note TEXT] [--server URL]`.
Read `comment.revision` with show first. Reads never acknowledge. Use a new
request UUID for each new action; retry the same action with unchanged args and
UUID. Stale revisions and conflicting reuse fail. `comment.history` retains
actor, server timestamp, note, revision, status change, and request ID.
Upload retries preserve workflow. Legacy open comments read at revision 0
without file writes. An exclusive `.server.lock` guards the directory; after a
crash verify its PID is no longer running before manually removing it.

Uploads can be cancelled with **Cancel save**, **Return to view**, or Escape.
Requests time out after 30 seconds. A pending draft keeps its original capture,
text, target, and request identity when you return to the game; reopen feedback
to retry it. The draft lasts until saved, discarded, or the plugin is destroyed
(including a page reload). Cancellation cannot undo a completed server write.

The server validates PNG checksums and decodes the pixels before saving.
Screenshots must be non-interlaced and contain at most 16,777,216 pixels. The
server accepts only loopback Host headers, including CLI requests without an
Origin header. Object-property order does not affect upload retry identity.

Feedback requires engine packages at `>=0.11.0 <0.12.0`. The published 0.10
packages do not provide the inspector clock leases used for comment mode.
