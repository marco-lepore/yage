# YAGE feedback

Leave comments on a running YAGE view and read them from a local CLI. The
private package contains one DOM interface, a YAGE plugin, a filesystem
server, and the `yage-feedback` executable.

## Start feedback with a Vite game

Add the dev-server plugin to `vite.config.ts` (Vite 8):

```ts
import { defineConfig } from "vite";
import { yageFeedback } from "@yagejs-tools/feedback/vite";

export default defineConfig({ plugins: [yageFeedback()] });
```

Keep `FeedbackPlugin({ enabled: debug })` in the game and omit `server`.
Starting Vite starts feedback on the same port. The browser plugin discovers
its API automatically. An explicit `server` option overrides discovery.
Production builds contain no feedback server routes or discovery metadata.

Open **Feedback gallery** from the game controls, or visit
`/__yage/feedback/` on the game's origin. The API is at
`/__yage/feedback/api/`. Both paths include Vite's configured `base`, and follow
its actual port if the preferred port is occupied. Use that full API URL in
CLI `--server` arguments, including the path.

`yageFeedback({ directory: ".yage/feedback", basePath: "/__yage/feedback/" })`
configures storage relative to Vite's root and routes relative to Vite's base.
Add `.yage/feedback/` to your project's `.gitignore` if captures should stay local.
Each running server must own a different storage directory. A second owner
fails with a lock error; it never creates a different directory silently.
Restarting Vite preserves comments and releases/reacquires the lock.

The integration requires local HTTP. Feedback routes reject nonlocal clients
even when the game dev server is exposed on the network. Closing Vite stops
feedback; use the standalone server with the same directory to review saved
comments afterward.

## Review and hand off comments

The gallery defaults to **Pending** (open and ingested). Filter by status,
search text or entity names, and open **View evidence** for the original image,
target outlines, inspector snapshot, host context, and status history.
Cards show 24 comments per page. **Refresh** reloads saved comments and status.

Select comments, then choose **Copy for Codex** or **Copy for Claude**.
The instruction includes the skill invocation, project directory, actual API
URL, and explicit comment IDs. Paste it into an agent session opened in that
project. Install the `yage-feedback` skill separately in that agent first.
If clipboard access fails, a dialog offers selectable text. Reading, selecting,
and copying do not ingest comments. Changing the filter clears selection;
changing pages retains it.

## Run the demo

From the repository root, install dependencies and build:

```sh
npm install
npx turbo run build --filter=@yagejs-tools/feedback --filter=@yagejs-tools/lab
```

Start the game; its Vite plugin starts feedback automatically:

```sh
npm run demo --workspace=@yagejs-tools/feedback
```

Open [the game](http://127.0.0.1:5213). Its data is in
`packages/tools/feedback/demo/.yage/feedback`.

The lab harness uses the standalone server. Start these in separate terminals:

```sh
node packages/tools/feedback/dist/cli.js serve --dir output/playwright/feedback-data
npm run lab --workspace=@yagejs-tools/feedback
```

Open [the lab](http://127.0.0.1:5214).
In the lab, press **Pause** before **Leave feedback**. In either host:

1. Open **Leave feedback**. The game freezes and a captured image appears.
2. Choose **Whole view**, **Entities**, or **Area**. Click an entity or use
   the searchable entity dropdown; hold Shift to add another on the image. In Area mode, drag a rectangle.
3. Write a comment and save. Add more comments or return to the view.
4. Resume and capture another frame to collect more observations in the same
   session.

The demo also accepts `?shortcuts=custom` to try Shift+K for feedback, Shift+P
for freeze, and Period/Shift+Period for stepping.

The entity dropdown filters by name, ID, or scene and displays 50 results per
page. Filtering preserves selected entities; their summary stays visible below
the dropdown.

Screenshots hide the debug HUD during capture and immediately restore its
previous visibility, including when capture fails.

The server saves comments, PNGs, and inspector snapshots in the chosen
directory. Use one server per directory. Failed uploads keep their draft for
retry; **Discard unsaved draft** lets you leave without retrying. Discarding
the local draft does not delete anything already stored on the server.

## Read the evidence

```sh
node packages/tools/feedback/dist/cli.js list --status open --server http://127.0.0.1:5213/__yage/feedback/api/
node packages/tools/feedback/dist/cli.js show COMMENT_ID --server http://127.0.0.1:5213/__yage/feedback/api/
```

These invoke the same CLI exported as `yage-feedback`. Output is JSON.
`show` includes the original comment, target, capture metadata, full inspector
snapshot, and absolute screenshot path. The browser can close before the CLI
reads the data. Restart the server with the same directory to read earlier
comments. Use `--server URL` to read another local endpoint, including its base path.

## Track agent work

Reading leaves status unchanged. Use `ingest` once an agent has read the
comment and evidence, `address` after applying changes, and `resolve` after
verification. `reopen` returns any non-open comment to `open`.

```sh
node packages/tools/feedback/dist/cli.js ingest COMMENT_ID \
  --server http://127.0.0.1:5213/__yage/feedback/api/ \
  --revision 0 --by codex/session-name \
  --request-id 7582a71c-ffab-4b16-b7d3-145b34fafac5
```

Use `comment.revision` from `show`. Every new action needs a new request UUID;
retry an uncertain action with the same UUID and unchanged arguments. A retry
never adds a second history entry. A stale revision fails so another agent's
work cannot be overwritten. `--note TEXT` records an optional explanation.
All transitions retain the original comment, target, screenshot, and snapshot.
`list --status STATUS` filters open, ingested, addressed, or resolved comments.

The server records actor, timestamp, status, revision, and request ID in
`comment.history`. Earlier MVP comments read as revision 0 without rewriting
their files. Retrying an upload preserves existing workflow state.

The standalone server binds `127.0.0.1:5212`. `--port 0` asks the OS for an
available port and prints the actual API URL. `--base-path /review/api/`
changes its API prefix; its gallery is under `/review/api/gallery/`.
`--project PATH` sets the project directory used in copied instructions;
it defaults to the working directory. Its default allowed origins cover the demo
and lab. Supply repeatable `--origin URL` arguments for another project;
supplying any replaces the defaults. A directory lock prevents simultaneous
servers. Graceful shutdown releases it. After a crash, check the PID recorded
in `.server.lock` before removing a stale lock.

## Use the plugin

```ts
import { FeedbackPlugin } from "@yagejs-tools/feedback";

engine.use(
  new FeedbackPlugin({
    enabled: debug, // Same flag passed to new Engine({ debug }).
    server: "http://127.0.0.1:5212",
    context: () => ({ host: "runtime", experiment: "formation" }),
  }),
);
```

Set `enabled` to the application’s debug flag. Disabled feedback mounts no UI
or keyboard listeners. The compact controls become fully visible on hover or
focus. F8 opens feedback and F9 toggles freeze; `shortcuts: false` disables
those keys. Shortcuts ignore editable fields and open dialogs.

Override keyboard bindings in the runtime plugin:

```ts
new FeedbackPlugin({
  enabled: debug,
  shortcuts: {
    feedback: { code: "KeyF", shift: true },
    freeze: { code: "KeyP", shift: true },
    stepFrame: { code: "Period" },
    stepTenFrames: { code: "Period", shift: true },
  },
});
```

Bindings use physical `KeyboardEvent.code` values, such as `KeyF`, `Space`,
or `Backquote`. Optional `ctrl`, `alt`, `shift`, and `meta` modifiers must
match exactly; omitted modifiers are false. Omitted actions keep F8/F9 and F10/Shift+F10.
Set an action to `false` to disable only its shortcut, or use `shortcuts: false`
to disable all feedback shortcuts. Buttons remain available and tooltips show each
configured binding. Duplicate bindings are rejected. Choose combinations that
your browser and OS do not reserve. Configured step keys stay reserved even
when stepping is unavailable, except while typing or in a dialog.

Once the game is frozen, **+1 frame** and **+10 frames** advance it and leave
it frozen. Their default keys are F10 and Shift+F10. Stepping uses the
inspector's configured frame delta, clears held input, and is unavailable
while a comment dialog is open or another tool owns the clock. Return to the
game before stepping; saved captures and pending comment evidence stay unchanged.

Install RendererPlugin and DebugPlugin on that engine. Feedback uses the
existing inspector time lease and never advances simulation during capture.
InputPlugin is optional; when present, held input is cleared on entry and
exit. Context must be finite, acyclic JSON and is copied with the capture.
The same plugin can be included in a lab harness's `plugins` array, as shown
in [the demo harness](demo/lab/harness.ts).

## Limits

- Pause lab playback before opening feedback: lab playback owns the clock.
- Selection uses rendered bounding boxes. Use the entity dropdown for overlapping
  objects. Masks, displaced pixels, and exact paint order are not resolved.
- Regions use screenshot pixels. The inspector retains entity world state
  and camera information; feedback does not infer a world region.
- Capture covers the canvas, not surrounding HTML. Chrome/WebGL was verified.
- Freezing engine time does not stop external timers, network callbacks, or
  audio. Comments display an immutable captured image.
- The package is private and does not apply fixes or run an agent.

## Verify

```sh
npx turbo run typecheck lint test build --filter=@yagejs-tools/feedback
```

For CLI lifecycle verification after saving a browser comment:

```sh
node packages/tools/feedback/checks/cli.mjs http://127.0.0.1:5213/__yage/feedback/api/
```

This creates one acceptance comment using existing captured evidence and checks
all transitions, exact retries, stale rejection, and read-only source access.

For repeatable browser checks, start the servers above and use Playwright CLI:

```sh
playwright-cli open http://127.0.0.1:5213
playwright-cli snapshot
playwright-cli run-code --filename packages/tools/feedback/checks/runtime.js
playwright-cli run-code --filename packages/tools/feedback/checks/controls.js
playwright-cli run-code --filename packages/tools/feedback/checks/shortcuts.js
playwright-cli goto http://127.0.0.1:5213/__yage/feedback/
playwright-cli run-code --filename packages/tools/feedback/checks/gallery.js
playwright-cli goto "http://127.0.0.1:5213/?debug=false"
playwright-cli run-code --filename packages/tools/feedback/checks/disabled.js
playwright-cli goto http://127.0.0.1:5214
playwright-cli snapshot
playwright-cli run-code --filename packages/tools/feedback/checks/lab.js
```

The scripts create real comments and save screenshots under
`output/playwright/`.

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
