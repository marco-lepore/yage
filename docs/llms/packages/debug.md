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

`deterministicSeed` is opt-in. Leave it unset for normal debug builds; set it from test fixtures so each `Inspector.setSeed(...)` call has a known starting state. Inspector frame stepping is synchronous by default:

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

`stepUntil` checks the predicate before stepping, resolving `0` immediately if it is already true, then again after each frame. It resolves with the number of frames it took. The clock must still be frozen first, same as `time.step`. Prefer `stepUntil`/`stepAsync` over `time.step(N)` whenever the sequence crosses a scene transition, an async dialogue or cutscene runner, or anything else that resolves off the synchronous call stack.

## Inspector test surface

`window.__yage__.inspector` exposes deterministic test controls in addition to the snapshot/query API:

```ts
inspector.setSeed(seed);                       // reseed every scene RNG
inspector.input.hold("ArrowRight", 30);        // press, step N frames, release (sync)
inspector.input.tap("Space", 1);
inspector.input.fireAction("jump", 1);
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

`time.isAdvancing(withinMs = 250)` reports whether the game loop actually ticked within the last `withinMs` milliseconds, independent of `time.isFrozen()`. A frozen clock that isn't being stepped reads `isAdvancing() === false`, but a manual `time.step`/`stepUntil`/`stepAsync` fires a real tick, so `isAdvancing()` reads `true` for `withinMs` after one. A game that has stalled without being frozen — a hung `await`, a runaway synchronous loop — also reads `false`. `isFrozen()` alone can't tell those two cases apart; `isAdvancing()` exists for that.

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
  await page.waitForFunction(() => window.__yage__?.inspector);

  const result = await page.evaluate(async () => {
    const i = window.__yage__.inspector;
    i.setSeed(42);
    i.time.freeze();
    await i.input.hold("ArrowRight", 30);
    await i.input.fireAction("jump", 1);
    i.time.step(45);
    return i.snapshotJSON();
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

Always advance via `inspector.time.step(N)` — it loops one fixed-timestep
frame at a time (see the `clock.step(bigDt)` guidance above). `step(bigDt)`
collapses the whole interval into one large frame, so `Component.update`,
tweens, and AI logic only see one update at the full `bigDt` and diverge from
real gameplay.

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
  private stopArrow: (() => void) | null = null;

  onAdd(): void {
    this.stopArrow = this.use(DebugRegistryKey).drawVector(
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
  are divided by the zoom, so they keep a constant on-screen size.
- The arrow starts at the entity's **world** position, so a child entity's
  arrow follows its parent.
- The callback runs only while the overlay is on and the `vectors` contributor's
  `arrows` flag is enabled — a `drawVector` call costs nothing with debug off.
  Toggle with `registry.setFlag("vectors", "arrows", false)`.
- The registration is dropped when the entity is destroyed. A dormant entity
  (`setActive(false)`) keeps it and stops drawing until it is active again.
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
