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
}));
```

`deterministicSeed` is opt-in. Leave it unset for normal debug builds; set it from test fixtures so each `Inspector.setSeed(...)` call has a known starting state. Inspector frame stepping is synchronous:

```ts
window.__yage__.inspector.time.freeze();
window.__yage__.inspector.time.step();           // advance 1 frame at the configured dt
window.__yage__.inspector.time.step(30);         // advance 30 frames at the configured dt
window.__yage__.inspector.time.setDelta(30);     // change configured dt to 30ms
window.__yage__.inspector.time.thaw();
```

`inspector.time.step(N)` advances `N` frames at the configured dt — each frame is its own full pass through the SystemScheduler, so tweens, AI, and `Component.update(dt)` see one normal-sized frame at a time. To change the per-frame dt, call `inspector.time.setDelta(ms)` first.

The lower-level `window.__yage__.clock` exposes a custom-dt API: `clock.step(dtMs)` (one frame at `dtMs`) and `clock.stepFrames(count, dtMs?)` (loops `clock.step` `count` times). Avoid `clock.step(bigDt)` to "fast-forward" — it collapses everything into a single fat frame. Physics still runs the right number of fixed sub-steps, but `Component.update(dt)`, tweens, and AI logic only see one update at the full `bigDt`, which diverges from real gameplay. Always advance frame-by-frame when simulating gameplay sequences.

## Inspector test surface

`window.__yage__.inspector` exposes deterministic test controls in addition to the snapshot/query API:

```ts
inspector.setSeed(seed);                       // reseed every scene RNG
inspector.input.hold("ArrowRight", 30);        // press, step N frames, release (sync)
inspector.input.tap("Space", 1);
inspector.input.fireAction("jump", 1);
inspector.events.getLog();                     // EventLogEntry[] (bus + entity events)
inspector.events.setCapacity(1_000);           // ring buffer size (default 500)
await inspector.events.waitFor("scene:pushed", { withinFrames: 30 });
inspector.snapshotJSON();                      // stable, sorted JSON for diffing
```

Renderer-aware diagnostics live under the inspector extension namespace `debug`
(only present while `DebugPlugin` is installed). Pass `DebugDiagnostics` as the
type parameter so the returned methods are typed:

```ts
import type { DebugDiagnostics } from "@yagejs/debug";

const debug = window.__yage__.inspector.getExtension<DebugDiagnostics>("debug");
debug?.getCameraStack();                       // every CameraComponent across the scene stack
debug?.getLayerTransform("game", "world");
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

## Built-In Debug Views

- Physics collider outlines (green=dynamic, gray=static, blue=kinematic, yellow=sensor)
- FPS counter
- Entity count
- System timing breakdown

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
