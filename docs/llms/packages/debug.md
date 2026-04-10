# @yage/debug

Depends on `@yage/core`, `@yage/renderer`. Debug overlay and performance tools.

## Setup

```ts
import { DebugPlugin } from "@yage/debug";

engine.use(new DebugPlugin({
  startEnabled: true,       // show on launch (default false)
  toggleKey: "Backquote",   // key to toggle (default backtick)
  manualClock: false,       // frame-step mode
  stepKey: "Period",        // advance one frame in manual mode
  maxGraphics: 256,         // graphics pool size
  maxHudLines: 32,
  flags: { "walls.show-walls": true },  // format: "contributorName.flagName"
}));
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
import { StatsStore } from "@yage/debug";

const stats = new StatsStore();
stats.push("updateTime", value);     // add sample
stats.average("updateTime");         // rolling average
stats.latest("updateTime");          // most recent
```
