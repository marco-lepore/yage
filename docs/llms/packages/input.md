# @yagejs/input

Depends on `@yagejs/core`. Keyboard, mouse, gamepad, and pointer input with action maps.

## Setup

```ts
import { InputPlugin } from "@yagejs/input";

engine.use(
  new InputPlugin({
    actions: {
      jump: ["Space", "KeyW"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      fire: ["MouseLeft"],
    },
    groups: {
      gameplay: ["jump", "left", "right", "fire"],
      menu: ["confirm", "cancel"],
    },
    preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown"],
  }),
);
```

Registers `InputManagerKey` in `EngineContext`.

## InputManager Queries

```ts
import { InputManagerKey } from "@yagejs/input";

const input = context.resolve(InputManagerKey);

// Pressed state
input.isPressed("jump"); // held this frame
input.isJustPressed("fire"); // pressed this frame (edge)
input.isJustReleased("jump"); // released this frame (edge)

// Hold duration
input.getHoldDuration("fire"); // ms held, 0 if not held
input.isHeldFor("fire", 500); // held >= 500ms

// Axis/vector
input.getAxis("left", "right"); // -1, 0, or 1
input.getVector("left", "right", "up", "down"); // Vec2 (not normalized)
```

## Pointer

```ts
input.getPointerPosition(); // Vec2 in world coords (if camera set)
input.getPointerScreenPosition(); // Vec2 in virtual-space coords
input.isPointerDown(); // any pointer button held
```

Mouse buttons map to actions: `MouseLeft`, `MouseMiddle`, `MouseRight`.

### Pointer coords under responsive fit

Register `RendererPlugin` **before** `InputPlugin`. `InputPlugin` auto-resolves `RendererAdapterKey` (exported from `@yagejs/core`) — the canonical renderer registers itself under that key, so pointer events target its canvas and coordinates route through `canvasToVirtual` with zero config. All downstream consumers (`getPointerScreenPosition`, `getPointerPosition` via camera) see virtual-space pixels regardless of `fit` mode or HiDPI scaling.

```ts
import { InputPlugin } from "@yagejs/input";

engine.use(new InputPlugin({ actions: { /* … */ } }));
```

If input installs before a renderer registers, the resolve silently returns `undefined` and input falls back to raw canvas-relative CSS pixels — correct only when canvas CSS size equals virtual size. Order matters; make sure `RendererPlugin` is used first.

Override `rendererKey` only when you ship a custom renderer registered under a different `ServiceKey<RendererAdapter>`:

```ts
import { InputPlugin } from "@yagejs/input";
import { MyCustomRendererKey } from "./my-renderer.js";

engine.use(new InputPlugin({ rendererKey: MyCustomRendererKey, actions: { /* … */ } }));
```

### Camera wiring for world coordinates

`getPointerPosition()` returns screen coords by default. To get world coords, wire the camera in your scene:

```ts
import { CameraEntity } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";

onEnter(): void {
  const cam = this.spawn(CameraEntity, {});
  const input = this.context.resolve(InputManagerKey);
  input.setCamera(cam); // CameraEntity satisfies CameraLike
}

onExit(): void {
  this.context.resolve(InputManagerKey).clearCamera();
}
```

Any object implementing `CameraLike` (has `screenToWorld(x, y)`) works with `setCamera()`. `CameraEntity` satisfies this interface.

## Runtime Rebinding

```ts
// Simple rebind
input.rebind("jump", "KeyZ");

// With conflict resolution (only between actions in the same group)
input.rebind("jump", "KeyA", { conflict: "replace" }); // steals from other action
input.rebind("jump", "KeyA", { conflict: "reject" }); // fails if conflict (default)

// Slot-based (replace binding at index)
input.rebind("jump", "KeyZ", { slot: 0 });

// Query bindings
input.getBindings("jump"); // readonly string[]
input.getActionsForKey("Space"); // string[]

// Persistence
const saved = input.exportBindings(); // ActionMapDefinition
input.loadBindings(saved);
input.resetBindings(); // restore defaults
input.resetBindings("jump"); // restore single action
```

## Action Groups

```ts
input.setGroups({
  gameplay: ["jump", "left", "right", "fire"],
  menu: ["confirm", "cancel"],
});

input.disableGroup("gameplay"); // gameplay actions return false
input.enableGroup("gameplay");
input.setActiveGroups(["menu"]); // only menu active, all others disabled
input.isGroupEnabled("gameplay");
```

Ungrouped actions are always active. An action active in any enabled group remains active.

## Important

Always use `InputManagerKey` for all game input. Do not use raw DOM event listeners (`window.addEventListener("keydown", ...)`) or manual key-tracking sets. The InputPlugin handles action mapping, rebinding, group enable/disable, hold detection, and automatic cleanup. Raw listeners bypass all of this and leak when scenes change.

## Key Listening

For rebinding UI -- intercept the next physical key. Works for keyboard, mouse,
**and gamepad buttons** (polling routes through the same interception path):

```ts
const key = await input.listenForNextKey(); // "KeyZ" / "MouseLeft" / "GamepadA"
input.cancelListen();
```

## Gamepad

Gamepads are polled each frame from `navigator.getGamepads()` and routed
through the same key pipeline as keyboard/mouse, so `isPressed`,
`isJustPressed`, hold-duration, and `listenForNextKey` all work uniformly
across devices. Bind gamepad codes alongside keys in the action map:

```ts
new InputPlugin({
  actions: {
    jump: ["Space", "GamepadA"],
    left: ["ArrowLeft", "GamepadDPadLeft"],
    fire: ["MouseLeft", "GamepadRT"],
  },
});
```

### Standard-mapping codes

`GamepadA/B/X/Y`, `GamepadLB/RB/LT/RT`, `GamepadSelect/Start`,
`GamepadLeftStick/RightStick` (clicking the stick),
`GamepadDPadUp/Down/Left/Right`, `GamepadHome`. Non-standard pads
(`mapping === ""`) only expose `GamepadButton{0..15}`.

`GamepadLT`/`GamepadRT` fire as button edges when their analog value crosses
`triggerThreshold` (default 0.5). The analog value is independently available
via `getTrigger`.

### Analog API

```ts
input.getStick("left"): Vec2;     // radial deadzone, magnitude clamped to 1.0
input.getStick("right"): Vec2;
input.getTrigger("left"): number; // 0..1
input.getTrigger("right"): number;
```

Across multiple connected pads, `getStick` returns the largest-magnitude
vector and `getTrigger` returns the maximum value (single-player default).

### Connect / disconnect

```ts
const dispose = input.onGamepadConnected((info) => {
  // Replays currently-known pads on subscribe.
  console.log("Pad", info.index, info.id);
});

input.onGamepadDisconnected((info) => /* pause game / show prompt */);

input.gamepads(); // synchronous: { index, id }[] from navigator.getGamepads()
```

Browsers gate `gamepadconnected` behind a first button press for security —
freshly-plugged pads won't fire until the user acts. Use `gamepads()` (or a
"press any button" UI hint) when you need ground truth.

### Config

```ts
new InputPlugin({
  deadzones: { stick: 0.15, trigger: 0.05 }, // defaults shown
  triggerThreshold: 0.5,
  pollGamepads: true,
});
```

### Synthetic injection (testing)

```ts
input.fireGamepadButton("GamepadA", true);   // routes through real path
input.fireGamepadAxis("leftX", 0.7);         // stored under synthetic pad
```

For deterministic inspector probes with a real controller plugged in, pair
`new InputPlugin({ pollGamepads: false })` with
`new DebugPlugin({ deterministicSeed: 42 })` so polling can't clobber injected
state. `setPollingEnabled(false)` flips the same flag at runtime.
