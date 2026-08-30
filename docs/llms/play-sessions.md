# Play sessions

Driving a running game to answer a question about it: hold keys, advance
frames, read the state back. `debug: true` on the engine publishes
`window.__yage__`, which carries the Inspector and `ready`. Anything that steps
the clock — `drive`, `time.freeze`, `time.stepUntil` — also needs
`DebugPlugin`, which supplies the clock control; without it those calls throw
while the readouts still work.

The full Inspector surface is in `llms/packages/debug.md`, and the scenario lab
in `llms/tools/lab.md`. This page covers which mechanism to reach for and how
to write the run.

## Pick a mechanism

| Situation | Use |
| --- | --- |
| One question about the game as it is running | one `inspector.drive()` call on the game page |
| A bug whose situation you can build from nothing | a scenario file, rerun with `yage-lab test --scenarios <file>` |
| Rerunning the same probe while iterating on a fix | move it out of the console into a scenario file |
| State only the real game reaches: progression, saves, the room graph | the Inspector on the game page |
| Tuning a number by feel, with a person watching | a lab scenario with `controls` |
| Behavior a person accepted and wants kept true | a scenario committed next to the code it exercises |

A scenario written to reproduce a bug mid-session is throwaway. Mixing it in
with the scenarios the project keeps makes both the lab's sidebar and a
`yage-lab test` run mean less:

- Put it where the project's `yage-lab.scenarios` globs in package.json do not
  reach. A `scratch/` directory is the shape to copy.
- Rerun it while iterating with `yage-lab test --scenarios scratch/gap.scenario.ts`.
- Delete it at the end of the session, or promote it deliberately: move the
  file next to the code it exercises, where the project's normal glob finds it.
- Keep scratch files out of git.

## Wait for the game before driving it

```ts
await page.waitForFunction(() => window.__yage__ !== undefined);
await page.evaluate(() => window.__yage__.ready);
await page.waitForFunction(
  () => window.__yage__.inspector.getSceneStack().length > 0,
);
```

`window.__yage__` is published as `start()` begins, so finding it says nothing
about how far boot got. `ready` settles when `start()` finishes, and rejects
with the error that stopped a failed boot instead of leaving a poller to time
out.

The host pushes the first scene after `await engine.start()`, so `ready` does
not cover it. Poll for the scene rather than stepping to it — the clock is
running at that point, and `step`/`stepUntil` throw on a clock that is not
frozen.

## One drive call, on the game page

`inspector.drive(fn, opts?)` freezes the clock, hands the callback awaitable
play verbs, and reports the run as one object. It restores the clock to the
state it found and releases every synthetic input afterwards.

```ts
const run = await window.__yage__.inspector.drive(async (ctx) => {
  const i = window.__yage__.inspector;
  ctx.input.keyDown("KeyD");
  const frames = await ctx.until(() => i.getEntityPosition("player").x > 950, {
    maxFrames: 240,
  });
  ctx.input.clearAll();
  return { frames, x: i.getEntityPosition("player").x };
}, { maxFrames: 900 });

run.framesUsed; // frames the whole run issued
run.state; // { keys, actions, scenes } at the moment the run ended
run.captures; // screenshots ctx.capture() took, as { label, dataUrl }

// `ok` discriminates the result, so narrow before reading the rest: `value`
// exists only on the success branch, `error` and `timedOut` only on the failure
// one.
if (!run.ok) throw new Error(run.error);
run.value.frames;
```

The context carries `step(frames?, { dtMs? })`, `until(predicate, { maxFrames?,
dtMs? })`, `input`, `events`, `capture(label?)` and a live `framesUsed`. Read
`framesUsed` off the context — it is a getter, and a destructured copy stays at
the value it had when the run started.

`state` is read before the run releases what the callback left held, so it
reports the keys that were actually down at the end. `opts.maxFrames` bounds
the whole run: the budget is checked before each frame-advancing call, and once
spent the run ends with `ok: false` and `timedOut: true`. The budget unwinds by
throwing inside the context, so a callback that catches every exception and
carries on defeats it. Omit `maxFrames` and a default of 10,000 frames applies;
pass `Infinity` for none.

A drive releases all synthetic input when it ends, so a hold does not carry
into the next call. A sequence that depends on a key staying down belongs in
one drive.

## The Inspector verbs on their own

`drive` is the clock control and the input verbs bundled with cleanup. Reach
past it when a run spans several evaluated calls, or when you want the clock
frozen while a person looks at the screen:

```ts
const { time, input } = window.__yage__.inspector;

time.freeze(); // nothing advances until thaw()
time.step(1); // synchronous: one frame, no microtask draining
await time.stepAsync(30); // drains between frames
await time.stepUntil(() => enemyDown(), { maxFrames: 240 });
time.setDelta(16.667); // milliseconds per simulated frame
time.thaw();
```

`time.isFrozen()` reports the flag; `time.isAdvancing(withinMs)` reports
whether the loop actually ticked, which separates a frozen clock from a stalled
one.

`inspector.input` mirrors the drive context's verbs synchronously:
`keyDown`, `keyUp`, `mouseMove`, `pointerDown`, `gamepadAxis`, `clearAll`.
Its `hold`, `tap` and `fireAction` step through the synchronous `time.step`, so
they advance frames without draining microtasks — the drive context's versions
are the awaitable ones. Nothing here releases input for you; pair every hold
with a release, or call `clearAll()`.

## Playing by rules instead of by a fixed script

A fixed script — hold Right 30 frames, jump, step 45 — only works while the
tuning constants hold. A run that reads the game each frame and picks the next
input keeps working after a balance change, and reaches situations too long to
script. The shape is a `while` loop with an `if` chain for priority, `continue` to
restart it, and `input.whileHolding` for a key that stays down across the
maneuvers inside:

```ts
// src/levels/gauntlet.scenario.ts
import { defineScenario } from "@yagejs-tools/lab";

export default defineScenario({
  scene: () => new GauntletScene(),

  async drive(ctx) {
    const player = ctx.scene.findByKey("player");
    if (!player) throw new Error("the scene has no player");
    const body = player.get(RigidBodyComponent);
    const ground = player.get(GroundProbe);   // this game's own component

    await ctx.input.whileHolding(["KeyD"], async () => {
      while (ctx.framesUsed < 900 && !atExit(body)) {
        if (ground.grounded && gapAhead(body, 48)) {
          await ctx.input.whileHolding(["Space"], () => ctx.step(6));
          continue;
        }
        if (ground.grounded && overTarget(body)) {
          await diveAttack(ctx, body, ground);
          continue;
        }
        if (enemyAhead(body, 120)) {
          await ctx.input.tap("KeyJ", 3);
          continue;
        }
        await ctx.step(1);
      }
    });
  },
});
```

**A maneuver is an ordinary async function** that awaits its own frames. It
needs no state machine and no per-frame phase counter, because the frames it
spends are the ones it awaits:

```ts
import type { DriveContext } from "@yagejs-tools/lab";

async function diveAttack(
  ctx: DriveContext,
  body: RigidBodyComponent,
  ground: GroundProbe,
) {
  await ctx.input.whileHolding(["Space"], async () => {
    await ctx.step(4);
    await ctx.until(() => body.velocityY > -20);          // rising to the apex
    await ctx.input.whileHolding(["KeyS", "KeyJ"], () =>
      ctx.until(() => ground.grounded, { maxFrames: 60 }),
    );
  });
}
```

**Nest `whileHolding` rather than tracking which keys are down.**
`whileHolding(codes, fn)` presses `codes`, runs `fn`, then restores the hold
state it found on entry, including when `fn` throws. A code already down when
it starts is left alone at both ends, so an inner call that repeats one of the
outer call's codes does not drop it on the way out, and the outer hold is still
down when the maneuver returns. Do not call `input.clearAll()` inside a
maneuver: it releases the caller's keys along with the maneuver's own.

The call resolves with whatever `fn` returned, so a hold can wrap a verb that
reports something: `whileHolding(codes, () => ctx.until(pred))` gives back the
frames it took.

**Bound the loop with `ctx.framesUsed`, not a loop counter.** One iteration
that runs a maneuver can spend 60 frames, so `for (let f = 0; f < 900; f++)`
bounds iterations rather than game time. `framesUsed` counts every frame the
run issued, including frames spent inside a nested maneuver and frames a
callback took by calling `inspector.time.step()` itself.

**The sensors are game code.** `gapAhead`, `enemyAhead`, `overTarget` and
`atExit` are raycasts and queries written next to the game they read, and
`GroundProbe` is the game's own component — one that raycasts down each frame
and exposes a `grounded` field. The engine supplies the loop verbs and the
frame budget. What counts as a gap is specific to the game, and a game whose
components already answer that needs no extra probe code.

The example above is a lab scenario, where `ctx.scene` reaches the entities the
scenario spawned. The same loop shape runs in an `inspector.drive` on the game
page, with two differences. There is no `scene`, so state comes from
`inspector.getEntityPosition`, `inspector.getComponentData`, or an extension the
game registers (below). And the context is a different type: annotate a helper
meant for the game page with `InspectorDriveContext` from `@yagejs/core`, since
the lab's `DriveContext` also requires `scene`, `controls` and `expect`. A
helper that has to work on both takes the members it uses:
`{ step, until, input }`.

Capture a game-specific final state in a plain variable in the enclosing scope
rather than in the callback's return value. A budget that stops the run unwinds
the callback, so the return value is lost while the variable keeps its last
assignment:

```ts
const i = window.__yage__.inspector;
let lastX = 0;
const run = await i.drive(async (ctx) => {
  while (!atExit()) {
    lastX = i.getEntityPosition("player").x;
    await ctx.step(1);
  }
}, { maxFrames: 600 });
// run.timedOut === true, run.value === undefined, lastX === how far it got
```

## Frame budgets from the game's own numbers

Derive the cap from tuning constants instead of guessing a sleep. A 900px gap
crossed at 300px/s takes 3 seconds, which is 180 frames at 1/60 — so wait on
the predicate and cap it a little above the derived number:

```ts
await ctx.until(() => body.positionX > 900, { maxFrames: 240 });
```

The predicate decides when the run moves on; the cap only decides when to give
up. Waiting a fixed number of frames instead re-fails every time someone
changes the run speed. `until` resolves with the frames it took, which is the
measurement worth returning.

## Reading the state back

```ts
inspector.getEntityPosition("player");           // { x, y } | undefined
inspector.getComponentData("player", "Health");  // serialize(), or reflected fields
inspector.getSceneStack();                       // scene snapshots, bottom to top
inspector.getInputState();                       // { keys, actions, mouse, pointers, gamepad }
inspector.snapshotJSON();                        // whole world, sorted, for diffing
inspector.events.getLog();                       // bus + entity events
await ctx.events.waitFor("enemy:hit", { withinFrames: 60 });
```

`getComponentData` reads a component's `serialize()` when it defines one, and
otherwise reflects its enumerable fields and public getters, so a component
with no save support is still readable. `getInputState()` is the cheap way to
check what is held — `snapshotJSON()` walks every scene and entity.

`events.waitFor` has to be started before the frames that satisfy it, because
the run is the only thing issuing frames:

```ts
const hit = ctx.events.waitFor("enemy:hit", { withinFrames: 60 });
await ctx.step(60);
await hit;
```

## Screenshots

Inside a drive, `ctx.capture(label?)` renders the current stage and records it
in the run's `captures` as `{ label, dataUrl }`, so one call returns both the
measurements and the frames behind them. A frozen clock means the image is the
exact frame that was stepped to.

```ts
const run = await inspector.drive(async (ctx) => {
  await ctx.until(() => doorOpen(), { maxFrames: 240 });
  await ctx.capture("door-open");
});
run.captures; // [{ label: "door-open", dataUrl: "data:image/png;base64,..." }]
```

The standalone `inspector.capture.dataURL()` / `pngBase64()` / `png()`, the
`RendererPlugin` requirement, and hiding the HUD before an image you intend to
compare are in `llms/packages/debug.md`.

## Game-specific probes that survive a reload

Helpers defined in an evaluated snippet are gone after the next page load.
Register them as an inspector extension instead, from a module the production
build drops:

```ts
// src/dev/probe.ts — imported only under a build flag the release drops.
import { InspectorKey } from "@yagejs/core";

engine.context.resolve(InspectorKey).addExtension("probe", {
  roomGraph: () => world.rooms.map((r) => ({ id: r.id, exits: r.exits })),
  grantKey: () => player.get(Inventory).grant("brass-key"),
  setRunSpeed: (v: number) => { player.get(Movement).runSpeed = v; },
});
```

```ts
const probe = window.__yage__.inspector.getExtension<{
  roomGraph(): { id: string; exits: string[] }[];
  grantKey(): void;
  setRunSpeed(v: number): void;
}>("probe");
```

A namespace can only be registered once; a second `addExtension("probe", …)`
throws. `getExtension` returns `undefined` when nothing registered the
namespace, which is what a production build leaves.

## The scenario lab

`@yagejs-tools/lab` mounts one scene, entity or mechanic in a real engine with
the game's own plugins, and gives every scenario the same verbs plus `scene`,
`controls` and `expect`. A probe worth keeping moves from a drive call into a
scenario's `drive` with little edited. Four things differ:

- A scenario's `drive` returns `void`. Assert with `expect` inside the callback
  rather than returning a measurement.
- `input.fireAction` holds the action down for the whole span here, while
  `inspector.input.fireAction` pulses it once per frame. A hold-to-charge move
  behaves differently under each.
- `input.pressAction` / `input.releaseAction` exist only on the lab's context.
- A scenario's own `drive` gets no frame budget — `yage-lab test` and the
  panel's Run button own that timeout. `maxFrames` applies to an ad-hoc
  `__yageLab__.drive()` call.

`__yageLab__.drive(fn, opts?)` runs a callback against whatever scene is
mounted, without rebuilding it, which is how to explore a scenario from the
console before writing its `drive`. `yage-lab test` runs every scenario
headless and exits non-zero when one fails.

## One call per question

Set up, drive, verify and return one verdict in a single evaluated call. The
alternative — one call to press a key, another to step, another to read the
result — pays a round trip per line and loses everything the previous call
declared.

```ts
const verdict = await page.evaluate(async () => {
  const i = window.__yage__.inspector;
  const probe = i.getExtension<{ setRunSpeed(v: number): void }>("probe")!;
  const results = [];
  for (const speed of [200, 300, 400]) {
    probe.setRunSpeed(speed);
    const run = await i.drive(async (ctx) => {
      ctx.input.keyDown("KeyD");
      return await ctx.until(() => i.getEntityPosition("player").x > 900, {
        maxFrames: 400,
      });
    });
    results.push({ speed, ok: run.ok, frames: run.framesUsed });
  }
  return results;
});
```

Return plain data — numbers, strings, plain objects. An `Entity` or a
`Component` does not survive the trip out of the page. A parameter sweep
belongs in one call, as above, not one call per value.

## Traps

- **A hidden or unfocused tab suspends `requestAnimationFrame`**, so a game
  left to play on its own stops advancing. Frames issued by `drive`, `step` and
  `until` are direct calls and advance either way. Never wait on wall-clock
  time for progress.
- **A `const` or `let` typed straight into the browser console stays declared
  in the page**, so running the same lines twice fails with a redeclaration
  error. Wrap console work in `(async () => { … })()`. Code inside a
  `page.evaluate(async () => { … })` callback is already function-scoped and
  needs no wrapper.
- **A page reload discards everything the snippets declared.** Reload in one
  call, then `await window.__yage__.ready` and probe in the next.
- **Vite's hot module replacement can swap a module mid-run.** Reload the page
  before trusting a measurement taken across an edit.
- **`inspector.time.step()` is synchronous and drains no microtasks**, so a
  scene transition or any other promise chain queued during it stays queued.
  Use `time.stepUntil` / `time.stepAsync`, or the drive context's `step` /
  `until`. The sync `inspector.input.hold` / `tap` / `fireAction` step through
  `time.step` and carry the same limit; the drive context's versions are
  awaitable and drain between frames.
- **`time.setDelta(ms)` is milliseconds.** `setDelta(30)` means 30ms per frame,
  not 30 frames per second.
- **`inspector.input.mouseDown` / `mouseUp` carry no coordinates.** They act at
  the last position passed to `mouseMove`, or at `(0, 0)` when there was none.
  Releasing the last button on a touch pointer drops it from `getPointers()`; a
  mouse pointer stays.
- **A second `drive()` while one is in flight throws.** Await the running one.
