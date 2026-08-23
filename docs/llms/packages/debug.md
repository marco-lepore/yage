# @yagejs/debug

Depends on `@yagejs/core`, `@yagejs/renderer`. Debug overlay and performance tools.

## Setup

```ts
import { DebugPlugin } from "@yagejs/debug";

engine.use(new DebugPlugin({
  startEnabled: true,       // show on launch (default false)
  toggleKey: "Backquote",   // key to toggle (default backtick)
  stepKey: "Period",        // advance one frozen frame
  maxGraphics: 256,         // graphics pool size
  maxHudLines: 32,
  flags: { "walls.show-walls": true },  // format: "contributorName.flagName"
  deterministicSeed: 0x00c0ffee,        // optional: pin every scene RNG to this seed
  eventLog: true,                       // record bus + entity events (default true)
}));
```

`deterministicSeed` is opt-in. Leave it unset for normal debug builds; set it from test fixtures so each `Inspector.setSeed(...)` call has a known starting state.

### The debug global

An engine built with `debug: true` publishes `window.__yage__` as `start()` begins, carrying `inspector`, `logger` and `ready`. `DebugPlugin` adds `clock` from its `onStart` hook.

```ts
await window.__yage__.ready;   // start() finished: plugins installed, loop running, onStart done
```

`ready` is what an out-of-page driver waits on after a page load or reload. The global appears before startup work, so its presence alone does not mean the engine got anywhere; a boot failure rejects `ready` with the error that stopped it, instead of leaving a poller to time out.

The host pushes the first scene after `await engine.start()`, so `ready` does not cover it. Wait for a scene separately. The clock is running at this point unless `DebugPlugin` was given `startFrozen`, so poll rather than step — `stepUntil` and `step` throw on a clock that is not frozen:

```ts
await window.__yage__.ready;
await page.waitForFunction(
  () => window.__yage__.inspector.getSceneStack().length > 0,
);
```

Inspector frame stepping is synchronous by default:

```ts
window.__yage__.inspector.time.freeze();
window.__yage__.inspector.time.step();           // advance 1 frame at the configured dt
window.__yage__.inspector.time.step(30);         // advance 30 frames at the configured dt
window.__yage__.inspector.time.setDelta(30);     // change configured dt to 30ms
window.__yage__.inspector.time.thaw();
```

`inspector.time.step(N)` advances `N` frames at the configured dt — each frame is its own full pass through the SystemScheduler, so tweens, AI, and `Component.update(dt)` see one normal-sized frame at a time. To change the per-frame dt, call `inspector.time.setDelta(ms)` first.

The lower-level `window.__yage__.clock` exposes a custom-dt API: `clock.step(dtMs)` (one frame at `dtMs`) and `clock.stepFrames(count, dtMs?)` (loops `clock.step` `count` times). Avoid `clock.step(bigDt)` to "fast-forward" — it collapses everything into a single large frame. Physics still runs the right number of fixed sub-steps, but `Component.update(dt)`, tweens, and AI logic only see one update at the full `bigDt`, which diverges from real gameplay. Always advance frame-by-frame when simulating gameplay sequences.

### Async stepping (`stepUntil` / `stepAsync`)

`time.step(N)` is fully synchronous. A `SceneManager` transition, or any other logic that resolves through a promise chain, queues its continuation as a microtask. A plain, synchronous `step()` call never drains that queue, so a script waiting on the transition sees stale state and looks stuck. `stepUntil`/`stepAsync` yield to a real macrotask after every frame instead, which lets pending microtasks run before the next frame steps:

```ts
// Advance until a condition holds, or throw after too many frames:
const frames = await inspector.time.stepUntil(
  () => inspector.getSceneStack().some((s) => s.name === "level2"),
  { maxFrames: 300 },   // default 600 (10s at 60fps); throws if never satisfied
);

// Advance a known number of frames, still draining async work between them:
await inspector.time.stepAsync(45);
await inspector.time.stepAsync(10, { dtMs: 32 });   // custom per-frame dt
```

`stepUntil` checks the predicate before stepping, resolving `0` immediately if it is already true, then again after each frame. It resolves with the number of frames it took. The clock must be frozen first, same as `time.step` — `inspector.drive()` below does that for you. Prefer `stepUntil`/`stepAsync` over `time.step(N)` whenever the sequence crosses a scene transition, an async dialogue or cutscene runner, or anything else that resolves off the synchronous call stack.

## Inspector test surface

`window.__yage__.inspector` exposes deterministic test controls in addition to the snapshot/query API:

```ts
inspector.setSeed(seed);                       // reseed every scene RNG
inspector.input.hold("ArrowRight", 30);        // press, step N frames, release (sync)
inspector.input.tap("Space", 1);                // sync; steps through time.step()
inspector.input.fireAction("jump", 1);          // sync; one-frame pulse per frame
inspector.events.getLog();                     // EventLogEntry[] (bus + entity events)
inspector.events.setCapacity(1_000);           // ring buffer size (default 500)
inspector.events.setEnabled(false);            // stop recording (zero per-event allocation)
inspector.events.isEnabled();                  // current on/off state
await inspector.events.waitFor("scene:pushed", { withinFrames: 30 });
inspector.snapshotJSON();                      // stable, sorted JSON for diffing
inspector.snapshotScene("level2");             // one scene's snapshot, by name or by id
inspector.time.isAdvancing();                  // true if a real frame ticked within the last 250ms
```

A logged `payload` is plain data. Class instances in a payload are stored as a compact ref instead of a deep copy — `Entity` as `{ id, name }`, `Component` as `{ component: "Health" }`, `Scene` as `{ name }`, `Vec2` as `{ x, y }`, anything else as `{ _type: "ClassName" }`.

A `component:added` payload:

```json
{ "entity": { "id": 4, "name": "player" }, "component": { "component": "Health" } }
```

Engine events carry live objects — `component:added` passes the `Component` itself — so the ref is what keeps a log entry from copying the whole object graph reachable from it. Read a component's fields from the entity snapshot, not from the log. Subscribers (`engine.events.on`, `entity.on`) receive the live object either way; only the log's copy is a ref.

`snapshotScene(nameOrId)` tries the public `scene.name` first, then falls back to the inspector-assigned id from `snapshot().scenes[].id` / `getSceneStack()[].id`. If more than one active scene shares the name it throws rather than guessing — pass the id instead.

`getInputState()` returns the input snapshot on its own — `{ keys, actions, mouse, pointers, gamepad }`, the same object `snapshot().input` carries. Use it to read what is held without paying for a full `snapshot()`, which walks every scene and entity. With no `InputPlugin` active it returns the empty shape rather than throwing.

`time.isAdvancing(withinMs = 250)` reports whether the game loop actually ticked within the last `withinMs` milliseconds, independent of `time.isFrozen()`. A frozen clock that isn't being stepped reads `isAdvancing() === false`, but a manual `time.step`/`stepUntil`/`stepAsync` fires a real tick, so `isAdvancing()` reads `true` for `withinMs` after one. A game that has stalled without being frozen — a hung `await`, a runaway synchronous loop — also reads `false`. `isFrozen()` alone can't tell those two cases apart; `isAdvancing()` exists for that.

### `inspector.drive(fn, opts?)` — one probe, frozen and cleaned up

`drive` runs a callback against the running game with the clock held still, hands it awaitable play verbs, and reports what happened as one object. It freezes the clock for the duration and returns it to the state it found it in, and releases every synthetic input afterwards, so no key stays held.

```ts
const run = await window.__yage__.inspector.drive(async (ctx) => {
  const i = window.__yage__.inspector;
  ctx.input.keyDown("KeyD");
  const frames = await ctx.until(() => i.getEntityPosition("player").x > 950, {
    maxFrames: 240,
  });
  ctx.input.clearAll();
  await ctx.step(10);
  return { frames, spent: ctx.framesUsed, x: i.getEntityPosition("player").x };
});
// { ok: true, value: { frames, spent, x }, framesUsed, durationMs, captures, state }
```

The context carries `step(frames?, { dtMs? })`, `until(predicate, { maxFrames?, dtMs? })`, `input`, `events`, `capture(label?)` and a live `framesUsed` — frames the drive has spent so far, counting frames issued through `ctx.step`/`ctx.until` as well as a direct `inspector.time.step()` call inside the callback. Read it off the context (`ctx.framesUsed`) rather than destructuring it — it is a getter, so a destructured copy freezes at the value it had when the run started. Every frame-advancing call is awaitable and drains async work between frames, including `input.tap`, `input.hold` and `input.fireAction` — which the sync `inspector.input` versions do not.

Nothing the callback throws escapes: a throw, including a failed assertion, comes back as `{ ok: false, error, timedOut }`, and the clock is restored either way. A missing `DebugPlugin` throws from the `drive()` call itself.

Every result carries a `state` readout — `{ keys, actions, scenes }` — captured at the moment the run ended, before its cleanup releases synthetic input. Read it to see what the callback left held, rather than re-deriving it from a snapshot taken afterward.

Pass `opts.maxFrames` to bound the run: the budget is checked before each frame-advancing call, and once it is spent the drive ends with `ok: false`, `error`, and `timedOut: true`. A single call asking for more frames than the budget still runs them all, so `framesUsed` can end above `maxFrames` — the budget stops a loop, it does not truncate one call. Omit it and a default of 10,000 frames applies; pass `Infinity` to disable the cap entirely. Derive a tighter budget from the game's own numbers rather than guessing: a 900px gap at 300px/s is 3 seconds, so 180 frames at 1/60 — drive it with `until(pred, { maxFrames: 240 })` and let the predicate decide when to move on, or pass `{ maxFrames: 240 }` to `drive()` itself as a backstop for the whole run.

### `input.whileHolding(codes, fn)` — a scoped hold for a maneuver

`whileHolding` holds `codes` for the duration of `fn`, then restores what was held before — including when `fn` throws. A code already down on entry is left alone at both ends, so nested calls compose by lexical scope even when their code sets overlap, and a key a plain `input.keyDown` is holding survives too. It never calls `input.clearAll()`, which would drop the caller's keys along with its own.

```ts
await ctx.input.whileHolding(["KeyD"], async () => {
  while (ctx.framesUsed < 900 && !atExit()) {
    if (gapAhead()) {
      await ctx.input.whileHolding(["Space"], () => ctx.step(6));
      continue;
    }
    await ctx.step(1);
  }
});
// "KeyD" releases here; the nested jump released "Space" on its own way out
// without touching "KeyD".
```

This is the building block for a policy loop that reads state and picks an input every frame — an `if`/`else` chain with `continue` for priority, an ordinary async function for a maneuver with phases, and `whileHolding` for "keep holding this while a nested maneuver runs." `input.keyDown`/`keyUp` still work for a hold with no natural scope.

`@yagejs-tools/lab` builds the same verbs for a scenario's `drive`, adding `scene`, `controls` and `expect`, so a probe worth keeping moves into a scenario file with little edited. Four things do change on the way:

- A scenario's `drive` returns `void`. Assert inside the callback with `expect` instead of returning a measurement.
- `fireAction` differs: this one pulses the action once per frame, while the lab holds it down for the whole span. A hold-to-charge move behaves differently under each.
- `pressAction`/`releaseAction` exist only on the lab's context — core's input contract has no sustained-action calls.
- A scenario's own `drive`, run through `yage-lab test` or the lab panel's Run button, gets no frame budget — the test runner (or the panel) owns that timeout instead. The budget applies only to an ad-hoc `LabApi.drive()` call.

### Component state reflection

`snapshot()` and `getComponentData()` read a component's `serialize()` result if it defines one. A component with no `serialize()` still reports state. Both a snapshot's `components[].state` and `getComponentData()` fall back to the component's own enumerable fields plus its public getters (`get isReady()`, `get health()`, and similar), read straight off the instance. Fields and getters starting with `_` are excluded. Functions and non-plain-object values are excluded too — Pixi/Rapier handles and other class instances would either fail to serialize or leak meaningless object identities. A getter that throws is skipped rather than failing the whole snapshot. Define `serialize()` when a component needs a specific shape, such as renamed keys or a derived value that shouldn't be recomputed on every read. Otherwise the reflected state is enough to inspect a component with no configuration.

### Render facet — rendered geometry / visibility

`snapshot()` / `snapshotScene()` report each graphical component's *rendered*
state alongside its `serialize()` output, under `facets.render`
(`RenderFacetSnapshot` from `@yagejs/renderer`). This is computed on demand from
the live display object — never from `serialize()` — so it reflects what is
actually painted, not the declared/persisted state. The facet only appears when
`RendererPlugin` is active (it registers the contributor that produces the facet).

```ts
const scene = inspector.snapshot().scenes[0];
const e = scene.entities.find((ent) => ent.id === "3");

// Entity-level facet (first painted component the entity added):
e.facets?.render;            // { bounds: { x, y, width, height } | null, visible }

// Per-component facet (read this for entities with several graphical components):
e.components.find((c) => c.type === "SpriteComponent")?.facets?.render;
```

`bounds` are **world-space** pixels — the same coordinate space as
`entity.transform`, before the camera and responsive `fit` transform are
applied. They are measured from the geometry itself, so a sized-but-hidden
object still reports its real box. `bounds` is `null` only when there is no
geometry to measure (an empty `Graphics`, a zero-area object) — never merely
because the object is hidden. Read `visible` for the hidden/shown state.

`SplitTextComponent` adds per-glyph reporting, so a typewriter reveal is
observable without touching Pixi internals — where `serialize()` reports the
full declared string, the facet reports only what is on screen:

```ts
const split = e.components.find((c) => c.type === "SplitTextComponent")
  ?.facets?.render;
split?.glyphs;        // [{ visible }, ...] in reading order
split?.visibleText;   // painted glyphs joined, e.g. "Hel"
```

`glyphs` / `visibleText` cover only rendered glyph segments — `SplitText.chars`
excludes whitespace, so a fully-revealed `"Hello world"` reports `"Helloworld"`.
Compare *which glyphs* are visible, not the verbatim string. `visible` is the
component's own (local) flag; Pixi v8 has no world-resolved getter, so a hidden
ancestor's state is not reflected.

**How it connects (no core↔renderer coupling).** `@yagejs/core`'s Inspector is
renderer-agnostic: it exposes a generic extension point — `registerFacetContributor()`
attaches namespaced `facets` to component/entity snapshots — with no
rendering-specific code. `RendererPlugin` registers a `RenderFacetContributor` (the same
contributor pattern as `DebugContributor` / save's `SnapshotContributor`) that
owns the `render` namespace: it duck-types `inspectRender()` off each graphical
component and picks the first painted one for the entity-level facet. `bounds` /
`visible` are the shared fields; a component reports richer, mode-specific state
by widening `RenderFacetSnapshot<Extra>` (as `SplitTextComponent` does with
`glyphs` / `visibleText`). The built-in graphical components (`SpriteComponent`,
`AnimatedSpriteComponent`, `GraphicsComponent`, `TextComponent`,
`SplitTextComponent`) all implement `inspectRender()`.

Renderer-aware diagnostics live under the inspector extension namespace `debug`
(only present while `DebugPlugin` is installed). Pass `DebugDiagnostics` as the
type parameter so the returned methods are typed:

```ts
import type { DebugDiagnostics } from "@yagejs/debug";

const debug = window.__yage__.inspector.getExtension<DebugDiagnostics>("debug");
debug?.getCameraStack();                       // every CameraComponent across the scene stack
debug?.getLayerTransform("game", "world");
debug?.isHudVisible();
debug?.setHudVisible(false); // hide HUD text readouts (FPS, timings); world-space
                             // debug graphics stay visible. Re-renders synchronously,
                             // so it works under a frozen clock — use before canvas
                             // captures to keep wall-clock text out of screenshots.
```

Plugins can publish their own inspector helpers the same way:

```ts
import { InspectorKey } from "@yagejs/core";
import type { DebugDiagnostics } from "@yagejs/debug";

const inspector = context.resolve(InspectorKey);

inspector.addExtension("inventory", {
  listItems: () => this.inventory.snapshot(),
  grantItem: (id: string) => this.inventory.grant(id),
});

const inventory = window.__yage__.inspector.getExtension<{
  listItems(): string[];
  grantItem(id: string): void;
}>("inventory");
```

## Agent-driven debugging: throwaway Inspector specs

The Inspector + frozen clock + scripted input together make a fast feedback loop
for LLM-assisted debugging and gameplay validation. The intended workflow is a
**throwaway Playwright spec**: write it, run it, delete it. Not a CI fixture.

Minimal template:

```ts
import { test, expect } from "@playwright/test";

test("can the player jump onto the ledge?", async ({ page }) => {
  await page.goto("/platformer.html");
  await page.waitForFunction(() => window.__yage__ !== undefined);
  await page.evaluate(() => window.__yage__.ready);
  await page.waitForFunction(
    () => window.__yage__.inspector.getSceneStack().length > 0,
  );

  const result = await page.evaluate(async () => {
    const i = window.__yage__.inspector;
    i.setSeed(42);
    const run = await i.drive(async ({ input, step }) => {
      await input.hold("ArrowRight", 30);
      await input.fireAction("jump", 1);
      await step(45);
      return i.snapshotJSON();
    });
    if (!run.ok) throw new Error(run.error);
    return run.value;
  });

  // Optionally also: await page.screenshot({ path: "/tmp/probe.png" });
  expect(result).toContain('"name":"player"');
});
```

Use it when:

- Validating a gameplay change you just made.
- Troubleshooting a reported bug ("does the door open after 30 frames of holding the lever?").
- Spot-checking emergent behavior in a scratch session.

Do **not** commit these to a CI suite. Magic frame counts tied to balance
constants make these specs brittle — when the player accelerates 5% faster, every
spec with `step(45)` breaks. Keep the spec for the duration of one debugging
session, then delete it.

Advance one frame at a time, through the drive context's `step`/`until` or
`inspector.time.step(N)` (see the `clock.step(bigDt)` guidance above).
`clock.step(bigDt)` collapses the whole interval into one large frame, so
`Component.update`, tweens, and AI logic only see one update at the full
`bigDt` and diverge from real gameplay.

Known limitations:

- **Visuals**: `snapshotJSON()` covers structural state (positions, components, scene stack), not pixel output. `page.screenshot()` helps, but an agent's interpretation of the pixels is imperfect — combine both for confidence.
- **Audio**: no introspection surface, and WebAudio doesn't pause in step mode.
- **Wall-clock leaks**: `setTimeout`, `Date.now()`, and raw `performance.now()` reads bypass the frame clock. None in core YAGE today, but custom plugins might.
- **`step(bigDt)` ≠ `stepFrames(N)`** for variable-update logic — always prefer the latter in probes.

## Built-In Debug Views

- Physics collider outlines (green=dynamic, gray=static, blue=kinematic, yellow=sensor)
- FPS counter
- Entity count
- System timing breakdown
- Vector arrows registered with `drawVector`

## Vector Arrows

An arrow on an entity for a vector read fresh every frame — velocity, aim
direction, knockback, steering output. No retained vector state: you register a
callback, the overlay calls it each frame.

```ts
import { DebugRegistryKey } from "@yagejs/debug/api";

class AgentVisual extends Component {
  private stopArrow?: () => void;

  onAdd(): void {
    // tryResolve, not use(): use() throws when DebugPlugin isn't installed.
    this.stopArrow = this.context
      .tryResolve(DebugRegistryKey)
      ?.drawVector(
        this.entity,
        () => this.agent.velocity,      // return null to skip a frame
        { scale: 0.35, color: 0x4ade80, minLength: 1 },
      );
  }

  onDestroy(): void {
    this.stopArrow?.();
  }
}
```

```ts
drawVector(
  entity: Entity,
  vector: () => Vec2Like | null | undefined,
  options?: DebugVectorOptions,
): () => void;                       // disposer, idempotent
```

| Option | Default | Description |
|---|---|---|
| `scale` | `1` | Pixels of arrow per unit of the vector |
| `color` | `0xffffff` | Arrow color |
| `alpha` | `0.9` | Arrow opacity |
| `origin` | `{ x: 0, y: 0 }` | World-space offset from the entity's position (not rotated by the entity) |
| `minLength` | `0` | Draw nothing below this length |
| `width` | `2` | Shaft thickness, in screen pixels |
| `headSize` | `8` | Arrowhead length, in screen pixels |

- `minLength` is measured before `scale`, in the vector's own units. A
  zero-length vector never draws — it has no direction.
- Arrow length is world-space (scales with camera zoom); `width` and `headSize`
  are divided by the zoom, so they keep a constant on-screen size. `headSize` is
  clamped to the arrow's length — a very short arrow is all head, no shaft.
- The arrow starts at the entity's **world** position, so a child entity's
  arrow follows its parent.
- The callback runs only while the overlay is on and the `vectors` contributor's
  `arrows` flag is enabled — a `drawVector` call costs nothing with debug off.
  Toggle with `registry.setFlag("vectors", "arrows", false)`.
- Resolve the registry with `tryResolve`, not `use`, in code that must run
  without `DebugPlugin` — `use` throws on an unregistered service.
- The registration is dropped when the entity's life ends: destroyed, or a pool
  member whose lease ended. A dormant entity (`setActive(false)`) keeps it and
  stops drawing until it is active again.
- Registering per lease in `onAcquire` never accumulates (a new lease retires
  the previous one's), but pair it with the disposer in `onRelease` — otherwise
  the last lease's registration is held until the next lease or pool disposal.
- Arrows draw from the shared `Graphics` pool (`maxGraphics`, default 256).
  Arrows past the pool limit are skipped for that frame.

## Custom Contributors

```ts
interface DebugContributor {
  readonly name: string;
  readonly flags?: readonly string[];
  drawWorld?(api: WorldDebugApi): void;
  drawHud?(api: HudDebugApi): void;
  dispose?(): void;
}

// WorldDebugApi
api.acquireGraphics();          // pooled Graphics | undefined
api.cameraZoom;                 // scale line widths by 1/zoom
api.isFlagEnabled("flag");

// HudDebugApi
api.addLine("text");            // add HUD line
api.isFlagEnabled("flag");
api.screenWidth; api.screenHeight;
```

Register:
```ts
const registry = this.service(DebugRegistryKey);
registry.register(new MyContributor());
```

## DebugRegistry

```ts
registry.toggle();                               // show/hide
registry.enabled;                                 // boolean
registry.setFlag("contributor", "flag", true);    // toggle specific flags
```

## StatsStore

```ts
import { StatsStore } from "@yagejs/debug";

const stats = new StatsStore();
stats.push("updateTime", value);     // add sample
stats.average("updateTime");         // rolling average
stats.latest("updateTime");          // most recent
```
