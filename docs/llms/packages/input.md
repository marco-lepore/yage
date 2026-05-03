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
input.isPointerDown(); // primary pointer has any of buttons 0/1/2 held
```

Mouse buttons map to actions: `MouseLeft`, `MouseMiddle`, `MouseRight`. Touch / pen primary contacts fire `MouseLeft` (matches `PointerEvent.button === 0`), so existing click-handler bindings work for taps unchanged.

The singular getters above always report the **primary** pointer (the one the browser flagged `isPrimary`). Multi-touch state lives behind `getPointers`.

### Multi-pointer / touch

```ts
import type { PointerInfo } from "@yagejs/input";

input.getPointers();      // readonly PointerInfo[] — one per active mouse / pen / finger
input.getPointer(id);     // PointerInfo | undefined — direct lookup by pointerId

// Per-pointer events. Each returns a disposer.
const off = input.onPointerDown((p: PointerInfo) => {/* ... */});
input.onPointerUp((p) => {/* fires for pointer release AND pointercancel */});
input.onPointerMove((p) => {/* ... */});
off();
```

`PointerInfo` carries `{ id, screenPos: Vec2, type: "mouse" | "pen" | "touch", isPrimary: boolean, buttons: ReadonlySet<number>, isDown: boolean }`. Treat as an immutable snapshot — don't retain across frames.

Touch / pen pointers are removed from `getPointers()` once their last button releases (or on `pointercancel`); mouse pointers persist across click cycles. The `MouseLeft/Middle/Right` action codes are aggregate "any pointer holds this button" — two simultaneous taps holding button 0 emit one down edge, one up edge.

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

## Listener APIs

Disposer-returning hooks for keys, actions, wheel, and (already covered above) pointers. Use these instead of raw DOM listeners — they participate in the action map, group enable/disable, and `consumePointer` gating.

```ts
import { InputManagerKey } from "@yagejs/input";

const input = context.resolve(InputManagerKey);

// Keys: code-specific or `"*"` for any-key.
const offSpace = input.onKeyDown("Space", (code) => {/* fired once per press */});
input.onKeyUp("Space", (code) => {/* once per release */});
input.onKeyDown("*", (code) => {/* fired for every key, useful for rebinding UIs */});

// Actions: name-based, fires for every binding (keyboard + gamepad + mouse).
input.onAction("fire", (name) => {/* rising edge */});
input.onActionReleased("fire", (name) => {/* falling edge */});

// All return disposers; call to detach.
offSpace();
```

Action listeners honor group enable/disable — a disabled group's actions don't fire, matching `isPressed` / `isJustPressed` behavior. DOM-driven events fire one frame after the browser dispatch (see [Frame deferral](#frame-deferral)); synthetic injection (`fireKeyDown` etc.) is sync.

## Scroll wheel

`wheel` events surface as one-frame action edges (`WheelUp`, `WheelDown`, `WheelLeft`, `WheelRight`) — rebindable like keys, never linger in `pressedKeys`. Direct callback access via `onWheel(fn)` for raw deltas.

```ts
new InputPlugin({
  actions: {
    zoomIn: ["WheelUp", "Equal"],
    zoomOut: ["WheelDown", "Minus"],
  },
  wheelInvertY: false,         // default; flip if your game wants positive dy = up
  preventDefaultWheel: false,  // default; opt-in to swallow page scroll
});

// In a component
input.onWheel((dx, dy) => {
  // raw deltas (already inverted if wheelInvertY)
});
input.consumeWheel(); // suppress WheelUp/Down/Left/Right action edges this frame
```

## Frame deferral

DOM-originated keyboard, pointer, and wheel events buffer onto an internal queue and apply at `Phase.EarlyUpdate` via `InputPollSystem`. Action queries (`isJustPressed`, `isJustReleased`) see the edge on the frame *after* the browser dispatch — single-frame latency, invisible to gameplay reading state at frame start.

```
F0:  browser dispatches `pointerdown`
     -> InputPlugin queues the event
     -> pointer listeners (onPointerDown) fire synchronously
F0:  rAF tick — InputPollSystem drains the queue
     -> action edges applied (justPressed / mouseAggregate)
F0:  user systems read state
```

Why: any listener that wants to claim the event (`consumePointer`, the renderer's UI hit-test fallback) gets a chance to run before action-map edges fire. Removes the "Pixi must register listeners before YAGE" load-bearing assumption.

Synthetic injection bypasses the queue and applies state synchronously, so existing tests using `fireKeyDown` / `firePointerDown` / `fireGamepadButton` need no changes. Tests that drive `dispatchEvent` directly need an explicit `manager._drainInputQueue()` (or a frame step) before assertions.

## Pointer / wheel consume

Primitives for handler code that wants to claim an event so it doesn't propagate to the action map. Listener notifications still fire (they're explicit user opt-ins); only the gameplay action edges (`MouseLeft`/`Middle`/`Right`, `WheelUp/Down/Left/Right`) are suppressed.

```ts
input.consumePointer(id);          // claim a pointer for the rest of its event cycle
input.isPointerConsumed(id);       // boolean
input.consumeWheel();              // suppress wheel action edges for this frame
```

`consumePointer` lifetime is per-pointer-event-cycle: cleared when the pointer's last button releases (drained `pointerUp`) or on `pointercancel`. So a tap-and-drag pattern works naturally — claim on `pointerdown`, the matching `pointerup` is also gated, and a fresh down later starts unmarked.

## UI auto-consume

Every primitive in `@yagejs/ui` (and `UIRoot` in `@yagejs/ui-react`) marks its underlying Pixi `Container` as a "consume surface" via a shared `WeakSet` in `@yagejs/core`. The renderer's optional `RendererAdapter.hitTestUI(x, y)` walks `EventBoundary.hitTest`'s parent chain looking for a marked ancestor; `@yagejs/input`'s drain step calls it on each `pointerdown` and auto-claims the pointer when the press lands on UI. Result: clicks on UI panels, buttons, decorative text, layout containers — **none of them fire gameplay actions** by default, with no per-component handler boilerplate.

Per-component escape hatch via `consumeInput?: boolean` (default `true`):

```tsx
// React
<UIPanel consumeInput={false}>
  {/* This panel is transparent to the action map; clicks pass through. */}
</UIPanel>

// Imperative
new UIPanel({ consumeInput: false, /* … */ });
```

For custom Pixi containers that should also auto-consume, mark them yourself:

```ts
import { markPointerConsumeContainer, unmarkPointerConsumeContainer } from "@yagejs/core";

const container = new Container();
markPointerConsumeContainer(container);  // also forces eventMode="static"
// later
unmarkPointerConsumeContainer(container);
```

Marking forces `eventMode = "static"` — required for Pixi's hit-test to report the container as the hit. Without that, `passive`-mode containers are skipped and the parent walk never sees the mark.

## SpriteComponent opt-in

Sprites are NOT marked by default — gameplay sprites usually want both Pixi events AND the action map. Opt in via `interactive`:

```ts
new SpriteComponent({
  texture: "button.png",
  interactive: { eventMode: "static", consumeOnInteraction: true },
});
```

`consumeOnInteraction: true` adds the sprite to the consume registry. The setting persists across save/load via `SpriteData.interactive`.

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
(`mapping === ""`) expose `GamepadButtonN`, where `N` is the browser button
index (any non-negative integer the runtime emits, e.g. `GamepadButton0`,
`GamepadButton16`).

`GamepadLT`/`GamepadRT` fire as button edges when their analog value crosses
`triggerThreshold` (default 0.5). The analog value is independently available
via `getTrigger`.

### Analog API

```ts
const leftStick = input.getStick("left");      // Vec2 — radial deadzone, magnitude clamped to 1.0
const rightStick = input.getStick("right");    // Vec2
const leftTrigger = input.getTrigger("left");  // number, 0..1
const rightTrigger = input.getTrigger("right");

// Explicit per-pad lookup (couch-co-op style)
const player2Stick = input.getStick("left", { pad: 1 });
```

Reads from the active pad by default. Pass `{ pad: index }` to read from a
specific pad regardless of active.

### Active pad

A single pad is "active" at any time — the most-recently-used controller
auto-promotes via input activity (button press or stick/trigger above its
deadzone). The active pad's own activity protects it from being stolen, so
two players each pressing buttons doesn't bounce active back and forth.

```ts
input.getActivePad();              // GamepadInfo | null
input.setActivePad(0);             // manual switch (must be connected)
input.setActivePad(null);          // clear; analog falls back to synthetic state

const dispose = input.onActivePadChanged((info) => {
  // Replays current state on subscribe; fires on every transition.
  hud.show(info ? `Player on pad ${info.index}` : "No controller");
});
```

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

// Pointer injection accepts an optional opts arg for multi-pointer / touch tests.
input.firePointerMove(120, 80);
input.firePointerDown(0);
input.firePointerDown(0, { id: 5, type: "touch", isPrimary: false });
input.firePointerUp(0, { id: 5 });
```

For deterministic inspector probes with a real controller plugged in, pair
`new InputPlugin({ pollGamepads: false })` with
`new DebugPlugin({ deterministicSeed: 42 })` so polling can't clobber injected
state. `setPollingEnabled(false)` flips the same flag at runtime.
