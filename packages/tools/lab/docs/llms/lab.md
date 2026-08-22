# @yagejs-tools/lab

Scenario browser for YAGE games (`@yagejs-tools` scope, independently
versioned, NOT in the engine `fixed` group). Mount one entity, one scene or one
mechanic in a real engine, tune it with live controls, and run the same
scenarios in a headless browser so a broken one fails the build.

Scenarios live in `*.scenario.ts` files, next to the code they exercise. The
lab finds them with a glob, boots one engine from the project's harness, and
rebuilds the scene whenever a control changes. Directories become the list's
grouping, so the sidebar mirrors the source tree without being configured.

## Install

```bash
npm install -D @yagejs-tools/lab
# engine peers, already in a YAGE game:
# @yagejs/core, @yagejs/renderer, @yagejs/debug, vite
# optional, only for `yage-lab test`:
npm install -D @playwright/test
```

Peers are `@yagejs/core`, `@yagejs/renderer`, `@yagejs/debug` and `vite ^8`.
`@playwright/test` is an **optional** peer — `init`, `dev` and `build` work
without it; only `test` needs it and a chromium binary.

## Commands

```bash
yage-lab init [--force]                          # write lab/harness.ts
yage-lab [dev] [--port 5210] [--no-open]         # the scenario browser
yage-lab build [--out-dir dist-lab]              # a static site
yage-lab test [--timeout 30000] [--screenshots <dir>] \
  [--screenshot-view <content|camera>]                  # headless, exits non-zero
```

Every command also takes `--scenarios <comma-separated globs>`.

All four load the project's own `vite.config.ts` and merge the lab into it, so
scenarios run under the same plugins and transforms the game uses — wasm for
Rapier, the legacy decorator transform for `@serializable`, path aliases.

`init` prefills the harness from the `@yagejs/*` packages the project declares
and writes nothing else. `@yagejs/core` and `@yagejs/renderer` must be
dependencies.

## The harness

One per project, at `lab/harness.ts` (or `.mts`/`.js`/`.mjs`). The path is a
convention, not a setting — there is no `--harness` flag.

```ts
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { DebugPlugin } from "@yagejs/debug";
import { defineHarness } from "@yagejs-tools/lab";

export const WIDTH = 800;
export const HEIGHT = 480;

export default defineHarness({
  width: WIDTH,          // canvas width, default 800
  height: HEIGHT,        // canvas height, default 480
  engine: () => new Engine({ debug: true }),
  plugins: ({ container }) => [
    new RendererPlugin({ width: WIDTH, height: HEIGHT, container }),
    new PhysicsPlugin({ gravity: { x: 0, y: 980 } }),
    // Fixes every scene's RNG seed, so a scenario replays the same way.
    new DebugPlugin({ deterministicSeed: 1 }),
  ],
});
```

Every scenario shares it, so they run against the game's plugin set. Keep it in
step with the game's own boot. `DebugPlugin` is appended automatically when the
harness declares no plugin named `debug`, because the clock needs it — declare
it yourself only to pass options.

## A scenario

Export what `defineScenario` returns from a `*.scenario.ts` file, as the
default export or as a named one. A scenario either builds a situation with
`setup` or mounts a `Scene` the game already has. Declaring both, or neither,
fails to compile.

```ts
// src/entities/ball.scenario.ts  →  entities › ball
import { Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { control, defineScenario } from "@yagejs-tools/lab";

export default defineScenario({
  describe: "Bodies falling onto a floor. Raise bounce and watch again.",

  controls: {
    count: control.int(3, { min: 1, max: 12, label: "balls" }),
    bounce: control.number(0.6, { min: 0, max: 0.95, step: 0.05 }),
  },

  // Runs in a blank scene, on every rebuild.
  setup(scene, c) {
    for (let i = 0; i < c.count; i++) {
      const ball = scene.spawn(`ball-${i}`, { key: `ball-${i}` });
      ball.add(new Transform({ position: new Vec2(80 * i + 60, 60) }));
      ball.add(
        new GraphicsComponent().draw((g) => {
          g.circle(0, 0, 16).fill({ color: 0x38bdf8 });
        }),
      );
      ball.add(new RigidBodyComponent({ type: "dynamic" }));
      ball.add(
        new ColliderComponent({
          shape: { type: "circle", radius: 16 },
          restitution: c.bounce,
        }),
      );
    }
  },
});
```

`ScenarioDef` fields:

| Field | Type | Notes |
| --- | --- | --- |
| `title` | `string` | Overrides where the list nests it, as a `/`-separated path. Defaults to the file's own location. |
| `name` | `string` | The entry's own label. Defaults to the export name. |
| `describe` | `string` | One or two sentences under the title. |
| `controls` | `ControlSchema` | Built with `control.*`. |
| `setup` | `(scene, controls) => void` | Builds a blank scene. Excludes `scene`. |
| `scene` | `(controls) => Scene` | Mounts an existing scene. Excludes `setup`. |
| `layers` | `readonly LayerDef[]` | `setup` form only. |
| `preload` | `readonly AssetHandle[]` | `setup` form only. |
| `onMounted` | `(scene, controls) => void` | After the scene is on the stack, every rebuild. |
| `drive` | `(ctx) => Promise<void>` | A driven run. See below. |

The `scene` form gets layers and preloads from the `Scene` itself, which is why
those two fields exist on the `setup` form only.

### Several scenarios in one file

Named exports each become a scenario, and they nest under the file. Anything
else the file exports is ignored, so a file holds the helpers its scenarios
share:

```ts
// src/entities/slime.scenario.ts  →  entities › slime › { idle, Chasing the player }
const hp = { hp: control.int(30, { min: 1, max: 200 }) };

function arena(scene: Scene) { /* shared by both */ }

export const idle = defineScenario({
  controls: hp,
  setup(scene, c) { arena(scene); spawnSlime(scene, c.hp); },
});

export const chase = defineScenario({
  name: "Chasing the player",
  controls: hp,
  setup(scene, c) { /* ... */ },
});
```

A file exports **either** a default scenario **or** named ones. Doing both is
reported as a problem, because the file would appear as a leaf and as a group
of the same name side by side.

A module namespace lists its exports alphabetically, so scenarios inside a file
cannot be shown in declaration order.

### Controls

Plain data — a scenario file declaring controls imports no runtime engine code.

```ts
control.number(0.6, { min: 0, max: 1, step: 0.05, label: "bounce" }) // slider, step defaults to 0.01
control.int(3, { min: 1, max: 12 })                                  // whole numbers
control.boolean(true, { label: "outline" })                          // checkbox
control.select("green", ["green", "sky", "amber"])                   // dropdown
```

`min`/`max` default to a range containing the value. `select` infers literal
types, so `setup` sees the union rather than `string` — no `as const` needed.

Changing a control rebuilds the scene from scratch, so `setup` must be able to
run again. Scenarios reward entities and scenes that take their values as
constructor parameters.

### `onMounted` — values the target does not accept as a parameter

For a field on a component the scenario cannot pass in at construction:

```ts
// src/feel/pulse.scenario.ts  →  feel › pulse
export default defineScenario({
  scene: () => new PulseScene(),
  controls: { amplitude: control.number(0.4, { min: 0, max: 1, step: 0.05 }) },
  onMounted(scene, c) {
    const pulse = scene.findByKey("disc")?.get(Pulse);
    if (pulse) pulse.amplitude = c.amplitude;
  },
});
```

## `drive` — play a scenario and assert on it

A `drive` rebuilds the scene, stops the clock control and issues the frames
itself, so a run advances a fixed number of frames instead of depending on
wall-clock timing. The panel's Run button executes one. `yage-lab test` runs
every one of them in a headless browser.

```ts
async drive({ scene, controls, step, until, expect, input, events, capture }) {
  const ball = scene.findByKey("ball-0");
  if (!ball) throw new Error("the scenario spawned no ball-0");
  const transform = ball.get(Transform);
  const startY = transform.position.y;

  await step(120);                                  // two seconds of gravity

  expect(transform.position.y).toBeGreaterThan(startY);
}
```

`DriveContext`:

| Member | Signature | Notes |
| --- | --- | --- |
| `scene` | `Scene` | `findByKey(...)` reaches what the scenario spawned. |
| `controls` | `ControlValues<C>` | The values the run started with. |
| `step` | `(frames?, { dtMs? }) => Promise<void>` | Advances frames, one at a time. `dtMs` sets the simulated milliseconds per frame for this call. |
| `until` | `(predicate, { maxFrames?, dtMs? }) => Promise<number>` | Steps until true, resolving with the frames it took. Rejects after 600 frames by default. |
| `expect` | `ExpectStatic` | `@vitest/expect`, Jest-style. |
| `events` | `Inspector["events"]` | The engine's event log. |
| `input` | `DriveInput` | Synthetic input, below. |
| `capture` | `(label?) => Promise<string>` | Screenshots into the run's result, resolves with a PNG data URL. |

**Every call that advances a frame is async and has to be awaited.**
`Inspector.time.step()` is synchronous and drains nothing — use `step` from the
context.

`dtMs` defaults to the clock's fixed step. The override applies only to that
`step` or `until` call:

```ts
await step(90, { dtMs: 1000 / 90 });
await until(() => probe.settled, { maxFrames: 180, dtMs: 1000 / 90 });
```

**`events.waitFor` has to be started before the frames that satisfy it.** The
run is the only thing issuing frames, so awaiting it first parks the run with
nothing left to advance it:

```ts
const hit = events.waitFor("enemy:hit", { withinFrames: 60 });
await step(60);
await hit;
```

### Synthetic input

Use `ctx.input`, not `Inspector.input`. Every call on it that advances frames is
async; the rest are synchronous.

```ts
input.keyDown(code); input.keyUp(code);          // sync
input.mouseMove(x, y); input.mouseDown(button?); input.mouseUp(button?);
input.pointerMove(x, y, opts?); input.pointerDown(button?, opts?); input.pointerUp(button?, opts?);
input.gamepadButton(code, pressed); input.gamepadAxis(side, value);
input.pressAction(name); input.releaseAction(name);  // sync, needs InputPlugin
input.clearAll();                                     // releases everything

await input.tap(code, frames?);        // hold for 1 frame unless told otherwise
await input.hold(code, frames);
await input.fireAction(name, frames?); // needs InputPlugin
```

Reading a one-frame edge such as `isJustPressed` means issuing the frames
yourself:

```ts
input.keyDown("Space");
await step(1);
expect(probe.jumpJustPressed).toBe(true);
await step(1);
expect(probe.jumpJustPressed).toBe(false);
```

## `yage-lab test`

Runs every scenario in headless chromium and exits non-zero if any failed.

```
  PASS  drop                          drive    120f  240ms
  PASS  shapes                        smoke     60f  41ms
  FAIL  enemies/slime                 drive     12f  88ms
        expected 1 to be 2 // Object.is equality

  2/3 passed, 1 failed
```

A scenario with a `drive` is driven. One without is mounted and stepped 60
frames, so the command is a smoke test for a project that has written no
drives.

A scenario fails when its `drive` throws or an assertion fails, when the engine
recorded a callback error (a `setup` that threw, a component `update` that
threw), when the page outlives `--timeout`, or when the page reported an
uncaught error. A scenario file the lab could not load fails the run too. A
glob that matched nothing fails rather than reporting an empty green run.

Each scenario gets its own page, so an error recorded while the scene was
mounting still belongs to it, and a stopped game loop cannot cascade into the
scenarios after it.

Assertion failures print the full compared values. Long strings and serialized
objects are not shortened.

`--screenshots <dir>` writes one PNG per scenario under the Vite root, plus one
per `capture(label)` a drive asked for, named `<id>[-<index>][-<label>].png`.
Without the flag nothing is written and no screenshot is taken. A screenshot
that could not be taken is a warning, not a failure.

`--screenshot-view content` is the default. It captures the stage's drawn
content at the renderer's resolution. The lab warns when the predicted image
exceeds the GPU texture limit. `--screenshot-view camera` captures the camera's
virtual viewport at resolution 1, so the PNG dimensions equal the game's
virtual resolution. It captures the declared virtual rect, which is what the
canvas shows under `letterbox` and `stretch`; `expand` shows more than that
rect on screen and `cover` shows less, and the PNG covers the rect either way.

Every scenario runs with its declared control values. There is no flag for a
different set.

## Discovery, ids and nesting

Scenario files go next to the code they exercise. The default glob is
`**/*.scenario.ts` under the Vite root, ignoring `node_modules` and `dist`, so
colocation needs no configuration. Narrow it in package.json to keep ids short:

```json
{ "yage-lab": { "scenarios": ["src/**/*.scenario.ts"] } }
```

An id is the module path with the patterns' shared directory prefix and the
`.scenario.ts` suffix removed, plus the export name when the scenario is a
named one:

| File and export | Id |
| --- | --- |
| `src/entities/slime.scenario.ts`, default | `entities/slime` |
| `src/entities/slime.scenario.ts`, `idle` | `entities/slime/idle` |

Leave the glob at its `**` default and the shared prefix is empty, so every id
carries `src/`. The whole path is kept either way, so two files both named
`jump.scenario.ts` stay distinct. Ids address a scenario from outside the
page — in a URL (`?scenario=entities/slime/idle`) and in `--scenarios`.

**The id is also where the list nests it.** Every `/` is a level, the last
segment is the entry, and a file with several scenarios becomes the group
holding them. A file with one keeps the file's own position rather than
nesting a single child under itself.

`title` overrides the position without moving the id, so a scenario stays
addressable by its file after being shown somewhere else:

```ts
export const king = defineScenario({
  title: "Bosses / Act 1 / Slime King",   // shown under Bosses › Act 1
  setup(scene) { /* ... */ },             // still `entities/slime/king`
});
```

A file that exports no scenario is reported and skipped rather than taking the
page down. `defineScenario` is what marks one — a plain object of the right
shape is treated as a helper and ignored.

## The panel

Each column scrolls on its own and the page never does, so scrolling the
scenario list leaves the canvas where it is.

- **Scenarios**, left. The filter box matches a scenario's title, the group
  names in it, and its file path. Clicking a group heading folds the group
  away. A filter opens whatever groups hold a match, and clearing it restores
  the folds.
- **Controls**, under the canvas, or beside it through the `→ right` toggle.
  `copy JSON` puts every current control value on the clipboard as one JSON
  object, to paste into code or into a prompt.
- **Clock**, under the canvas: play, pause, `+1`, `+10`, a speed slider, and the
  Run button. Select **real time** beside Run to show one driven engine frame
  per browser animation frame. A background tab pauses this run until the tab
  is focused again. `yage-lab test` always runs without animation-frame pacing.
- **Errors**, above the canvas.

Clicking the canvas gives it keyboard focus. While it holds focus the browser
does not scroll on space, the arrow keys, page up and down, or home and end.
The game still receives every one of those keys.

The folds and the controls column are stored in `localStorage` under
`yage-lab:panel`.

## URL state

`?scenario=<id>&c.<name>=<value>&speed=1&paused=1`. Editing a scenario file
reloads the page, and the query string is what returns you to the same
scenario, controls, speed and play state. A control value the schema no longer
accepts is dropped silently. A scenario id that no file matches is reported.

## Entry points

| Import | Contents |
| --- | --- |
| `@yagejs-tools/lab` | The grammar: `defineScenario`, `defineHarness`, `control`, and the types. Type-only where the engine is concerned — no runtime engine code, no pixi. |
| `@yagejs-tools/lab/runner` | `mount`, `LabApi`, `LabClock`, `DriveResult`. The browser shell. Imported by a page that hosts the lab, never by a scenario file. |
| `@yagejs-tools/lab/vite` | `yageLab(options)`, the Vite plugin the CLI uses. |

A scenario file imports the first only.

### Your own Vite config

`yageLab()` answers the dev server's root URL with the lab page, so a config
carrying it serves the lab rather than the game:

```ts
import { yageLab } from "@yagejs-tools/lab/vite";

export default defineConfig({
  plugins: [yageLab({ scenarios: ["src/**/*.scenario.ts"], harness: "lab/harness.ts", title: "Lab" })],
});
```

### `LabApi`

`mount` writes its API to `globalThis.__yageLab__` before the first scenario is
built, so a scenario whose `setup` throws still leaves something to diagnose it
with. Useful from a browser console or an out-of-page driver:

```ts
interface LabApi {
  readonly engine: Engine;
  readonly scenarios: readonly ScenarioEntry[];   // { id, path, exportName, groups, label, title, hasDrive }
  readonly problems: readonly RegistryProblem[];  // modules that were skipped
  readonly clock: LabClock;                       // play/pause/step/speed
  readonly ready: Promise<void>;                  // first mount done, or rejected with the boot error
  current(): ScenarioEntry | undefined;
  controls(): Readonly<Record<string, ControlValue>>;
  scene(): Scene | undefined;
  show(id: string): Promise<void>;
  setControl(name: string, value: ControlValue): Promise<void>;
  run(opts?: { pace?: "immediate" | "frame"; captureView?: "content" | "camera" }): Promise<DriveResult>;
  drive<T = void>(fn: (ctx: DriveContext) => Promise<T> | T, opts?: { rebuild?: boolean; pace?: "immediate" | "frame"; captureView?: "content" | "camera" }): Promise<DriveResult<T>>;
  capture(view?: "content" | "camera"): Promise<LabCaptureResult>;
}
```

`ready` is what to wait on — the API is published before the engine starts, so
its presence alone does not mean there is anything to drive.

`run()` defaults to immediate playback and content captures. `DriveResult`
includes `warnings` beside `captures`. `capture()` returns the PNG data URL and
capture warnings for an out-of-page driver.

### Ad-hoc drives from the console

`drive(fn, opts?)` runs `fn` with the same `DriveContext` a scenario's own
`drive` receives — `step`, `until`, `input`, `events`, `expect`, `capture` —
against the currently mounted scene. Call it from the browser console to
explore a scenario, to try things out before writing a `drive`, or to
continue from wherever `run()` or a previous `drive()` left the scene:

```js
const r = await __yageLab__.drive(async ({ input, until, scene }) => {
  const body = scene.findByKey("player")?.get(RigidBodyComponent);
  if (!body) throw new Error("no player in this scene");
  input.keyDown("KeyD");
  const frames = await until(() => body.positionX > 950, { maxFrames: 240 });
  input.clearAll();
  return { frames, x: body.positionX };
});
// r: { ok: true, value: { frames, x }, framesUsed, durationMs, captures, warnings }
```

Unlike `run()`, `drive()` does **not** rebuild the scene first — it drives the
scene as it stands, mutations from an earlier drive included. Pass
`{ rebuild: true }` to rebuild before it runs, the way `run()` does. The
current scenario does not need its own declared `drive`; `ctx.scene` is
whatever scene is mounted and `ctx.controls` is the current control values. A
throw inside `fn`, including a failed `expect`, resolves with `ok: false`
rather than rejecting the promise. The promise itself rejects when no
scenario is mounted, when a run or drive is already in flight, when
`{ rebuild: true }`'s rebuild throws, or when no scene is mounted at all (the
boot rebuild failed). While a `drive()` is in flight, `show`, `setControl`,
`run`, and a second `drive()` all reject.

## Gotchas

- **The clock is frozen.** `mount` freezes the engine clock at boot and issues
  every frame itself. The default delta is 1/60s. A drive can set `dtMs` for one
  `step` or `until` call. Speed changes how often the panel clock issues a
  frame, never the delta the frame reports.
- **A run and the clock control are two writers on one clock.** A run stops the
  clock for its duration and restores the play state afterwards. Switching
  scenario or changing a control during a run is rejected.
- **A throw that escapes a whole frame stops the game loop permanently.** The
  engine detaches its ticker, and only a page reload recovers. The panel reports
  the state, and `yage-lab test` gives every scenario its own page for this
  reason.
- **A scenario laying bodies out from a control has to keep them clear of each
  other.** Physics pushes intersecting bodies apart hard enough that the
  scenario stops showing what it was built to show.
- **A content screenshot is the size of what was drawn**, not the size of the
  canvas. It is the stage cropped to its bounds. Use the camera view for the
  game's virtual resolution.
- **Screenshot bytes are not stable between runs.** Two runs at the same frame
  count with a fixed seed differ by tens of bytes. Any comparison needs a
  perceptual diff.
- **One harness per project.** A game wanting a physics-free harness for UI
  scenarios has no way to ask for one.
- **`--scenarios` selects files, not scenarios.** A pattern naming a file with
  several scenarios runs all of them.
