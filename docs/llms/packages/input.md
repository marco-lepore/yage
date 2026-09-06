# @yagejs/input

Depends on `@yagejs/core`. Keyboard, mouse, gamepad, and pointer input with action maps.

## Setup

```ts yage-context="engine"
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

```ts yage-context="component"
import { SceneTimeKey } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";

const input = this.use(InputManagerKey);
const clock = this.use(SceneTimeKey);

// Raw input time (seconds). Scene pause and time scaling do not affect it.
input.getClockTime();

// Pressed state
input.isPressed("jump"); // currently held
input.isJustPressed("fire"); // press edge in the caller's window (see below)
input.isJustReleased("jump"); // release edge in the caller's window

// Hold duration (seconds)
input.getHoldDuration("fire"); // seconds held, 0 if not held
input.isHeldFor("fire", 0.5); // held >= 0.5s

// Tap vs hold — call-site thresholds in seconds, no per-action config
input.isJustHeldFor("fire", 0.5); // hold-start edge: true in the window hold crosses 0.5s
input.isJustTapped("fire", 0.2); // release window, held <= 0.2s (a tap)
input.isJustReleasedAfter("fire", 0.5); // release window, held >= 0.5s
input.getReleaseDuration("fire"); // seconds held, valid only in the release window
// "Release window" = the window in which the action's last held input
// releases — a bound key, mouse button, gamepad button, or synthetic press.
// A chord's partial release reports 0 / false.

// Every duration query takes an optional clock (see below)
input.getHoldDuration("fire", { clock }); // seconds of that scene's simulation time

// Buffered press — consuming query; true once per press within the window
input.consumeBufferedPress("jump", 0.12); // pressed within last 0.12s and unclaimed → claim + true

// Axis/vector
input.getAxis("left", "right"); // -1, 0, or 1
input.getVector("left", "right", "up", "down"); // Vec2 (not normalized)
```

**Edge-query windows.** The six edge queries (`isJustPressed`, `isJustReleased`,
`isJustHeldFor`, `isJustTapped`, `isJustReleasedAfter`, `getReleaseDuration`)
resolve against the caller's execution context. Called from frame code
(`update`, listeners, any non-fixed system) the window is the current rendered
frame. Called from fixed-step code (`fixedUpdate`, a `Phase.FixedUpdate`
system) it is the current fixed step: the edges that arrived since the previous
step began. Each context sees an edge exactly once at any display/step rate
ratio. When several steps run in one frame only the first sees it, and an edge
in a frame that runs no step is held for the next step.

The window and the clock (below) are separate choices: the clock decides how a
duration is measured, the calling context decides which window an edge falls in,
and both apply to `isJustHeldFor`, `getReleaseDuration`, `isJustTapped` and
`isJustReleasedAfter`. A scene clock advances once per frame, so a duration
measured on it does not change between the steps of one frame — a fixed-step
reader sees a crossing in the first step of the frame it lands in.

**Clocks.** Every duration query — the hold-duration family (`getHoldDuration`,
`isHeldFor`, `isJustHeldFor`, `isJustTapped`, `isJustReleasedAfter`,
`getReleaseDuration`) and the `consumeBufferedPress` window — counts on the raw
input clock (`getClockTime()`) by default, which ignores scene pause and time
scale: a charge keeps charging through a pause menu or a `freezeFor`. Pass a
scene's `SceneTime` as `clock` to count on that scene's simulation seconds
instead. The scene clock stops while the scene is stack-paused or frozen and
follows the scene's effective time scale, the same scale physics steps under. It
is scene-wide: an entity excluded from a scale request via `excludeUpdates`, or
with its own `entity.timeScale`, updates at a rate the scene clock does not
follow. Measure that entity's holds from the `dt` its own update receives — the
raw clock is no substitute, since it runs on real time and so ignores
`scene.timeScale` and stack pause too.

```ts yage-context="component"
import { SceneTimeKey } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
const input = this.use(InputManagerKey);

// Inside a Component or Scene subclass — `use` returns a non-optional clock.
// `scene.tryResolveScoped(SceneTimeKey)` returns `SceneTime | undefined`, which
// the `clock` option does not accept under exactOptionalPropertyTypes.
const clock = this.use(SceneTimeKey);
input.getHoldDuration("charge", { clock }); // simulation seconds charged
input.isJustHeldFor("charge", 0.5, { clock }); // crossing measured on the scene
input.isJustTapped("charge", 0.2, { clock }); // a tap in simulation seconds
input.consumeBufferedPress("jump", 0.12, { clock });
```

Each clock keeps its own readings, so the same press can be a tap on the scene
clock and a long press on the raw one. `isJustHeldFor` carries a separate
crossing baseline per clock and fires once on each. A hold that began before a
clock was registered starts from zero on that clock rather than reading as not
held, and its release reports only the part measured since — a long press begun
before the scene was entered can read as a tap on that scene's clock. A press
made before registration is not buffered on it at all, and a release that landed
before it carries no length there — `isJustTapped` and `isJustReleasedAfter` are
false rather than treating the missing length as 0.

**Gotcha — a frozen clock measures no hold.** A frozen scene still runs its
components, but its clock does not advance, so a press that starts and ends
inside a `freezeFor` hitstop measures 0 seconds on it: `isJustTapped` reads a
tap and `isJustReleasedAfter` never fires. Read charge releases on the raw clock
if they must work during a freeze.

The input plugin registers the `SceneTime` of every scene the engine enters, and
those are the only clocks accepted. Any other value — a hand-rolled `{ elapsed }`
object, or an exited scene's `SceneTime` — throws.

**Gotcha — a buffered press outlives a pause.** The scene clock stops while the
scene is paused, so a window measured on it never expires there: a jump pressed
just before the pause menu opens still fires on resume, however long the menu
was up. Presses made _during_ the pause are buffered too, unless the action's
group is disabled while the menu is up — an action in no group is always
enabled. The engine holds the press rather than guessing how long is too long.
Discard it in the scene's `onResume` by consuming it and ignoring the result.
One discard covers both cases, since the newest press replaces the stamp:

```ts
import { Scene, SceneTimeKey } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";

class GameScene extends Scene {
  readonly name = "game";
  onResume() {
    const input = this.use(InputManagerKey);
    // Re-enable first: consumeBufferedPress returns false without claiming when
    // the action is disabled, so the discard would silently do nothing.
    input.enableGroup("movement");
    input.consumeBufferedPress("jump", 0.12, { clock: this.use(SceneTimeKey) });
  }
}
```

## Pointer

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

input.getPointerPosition(); // Vec2 in world coords (if camera set)
input.getPointerScreenPosition(); // Vec2 in virtual-space coords
input.isPointerDown(); // primary pointer has any of buttons 0/1/2 held
```

Mouse buttons map to actions: `MouseLeft`, `MouseMiddle`, `MouseRight`. Touch / pen primary contacts fire `MouseLeft` (matches `PointerEvent.button === 0`), so existing click-handler bindings work for taps unchanged.

The singular getters above always report the **primary** pointer (the one the browser flagged `isPrimary`). Multi-touch state is available through `getPointers`.

### Multi-pointer / touch

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

const id = 1;
import type { PointerInfo } from "@yagejs/input";

input.getPointers(); // readonly PointerInfo[] — one per active mouse / pen / finger
input.getPointer(id); // PointerInfo | undefined — direct lookup by pointerId

// Down edges retained for the current rendered frame. Claimed presses are
// excluded unless `consumed` is `"include"` or `"only"`.
input.getPointerPresses({ button: 0 }); // readonly PointerPressInfo[]

// Per-pointer events. Each returns a disposer.
const off = input.onPointerDown((p: PointerInfo) => {
  /* ... */
});
input.onPointerUp((p) => {
  /* fires for pointer release AND pointercancel */
});
input.onPointerMove((p) => {
  /* ... */
});
off();
```

`PointerInfo` carries `{ id, generation, screenPos: Vec2, type: "mouse" | "pen" | "touch", isPrimary: boolean, buttons: ReadonlySet<number>, isDown: boolean, button: number }`. `generation` changes when the browser reuses an id for a new press cycle. Treat the object as an immutable snapshot.

`PointerPressInfo` adds `worldPos` and `consumed`. `getPointerPresses()` is the polling API for tap-driven gameplay and addons. It preserves a down edge even when its up or cancel arrives before the frame runs. `screenPos`, `worldPos`, `buttons`, and `isDown` describe the applied down edge; a later pointer move or camera move does not alter the record. The default query excludes consumed presses.

`button` is the edge that triggered the event: `0`/`1`/`2` for the pressed/released button in an `onPointerDown`/`onPointerUp` listener, `-1` for `onPointerMove`, `pointercancel`-driven up notifications, and `getPointers()`/`getPointer()` snapshots. **In a down/up listener, filter by `p.button`, not `p.buttons`** — down and up listeners run during input drain, before that edge changes `buttons`.

Touch / pen pointers are removed from `getPointers()` once their last button releases (or on `pointercancel`). Mouse pointers persist across click cycles. The `MouseLeft/Middle/Right` action codes are aggregate "any pointer holds this button" — two simultaneous taps holding button 0 emit one down edge, one up edge.

### Pointer coords under responsive fit

Register `RendererPlugin` **before** `InputPlugin`. `InputPlugin` auto-resolves `RendererAdapterKey` (exported from `@yagejs/core`) — the canonical renderer registers itself under that key, so pointer events target its canvas and coordinates route through `canvasToVirtual` with zero config. All downstream consumers (`getPointerScreenPosition`, `getPointerPosition` via camera) see virtual-space pixels regardless of `fit` mode or HiDPI scaling.

```ts yage-context="engine"
import { InputPlugin } from "@yagejs/input";

engine.use(
  new InputPlugin({
    actions: {
      /* … */
    },
  }),
);
```

If input installs before a renderer registers, the resolve silently returns `undefined` and input falls back to raw canvas-relative CSS pixels — correct only when canvas CSS size equals virtual size. Order matters; make sure `RendererPlugin` is used first.

Override `rendererKey` only when you ship a custom renderer registered under a different `ServiceKey<RendererAdapter>`:

```ts yage-context="engine"
import { InputPlugin } from "@yagejs/input";
import { ServiceKey, type RendererAdapter } from "@yagejs/core";
// Use the same key when registering your RendererAdapter implementation.
const MyCustomRendererKey = new ServiceKey<RendererAdapter>("game:renderer");

engine.use(
  new InputPlugin({
    rendererKey: MyCustomRendererKey,
    actions: {
      /* … */
    },
  }),
);
```

### Camera setup for world coordinates

`getPointerPosition()` returns screen coords by default. To get world coords, set the camera in your scene:

```ts
import { Scene } from "@yagejs/core";
import { CameraEntity } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";

class GameScene extends Scene {
  readonly name = "game";
  onEnter(): void {
    const cam = this.spawn(CameraEntity, {});
    const input = this.context.resolve(InputManagerKey);
    input.setCamera(cam); // CameraEntity satisfies CameraLike
  }

  onExit(): void {
    this.context.resolve(InputManagerKey).clearCamera();
  }
}
```

Any object implementing `CameraLike` (has `screenToWorld(x, y)`) works with `setCamera()`. `CameraEntity` satisfies this interface.

## Listener APIs

Disposer-returning hooks for keys, actions, wheel, and (already covered above) pointers. Use these instead of raw DOM listeners — they participate in the action map, group enable/disable, and `consumePointer` gating.

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";

const input = context.resolve(InputManagerKey);

// Keys: code-specific or `"*"` for any-key.
const offSpace = input.onKeyDown("Space", (code) => {
  /* fired once per press */
});
input.onKeyUp("Space", (code) => {
  /* once per release */
});
input.onKeyDown("*", (code) => {
  /* fired for every key, useful for rebinding UIs */
});

// Actions: name-based, fires for every binding (keyboard + gamepad + mouse).
input.onAction("fire", (name) => {
  /* rising edge */
});
input.onActionReleased("fire", (name) => {
  /* falling edge */
});

// All return disposers; call to detach.
offSpace();
```

Action listeners honor group enable/disable — a disabled group's actions don't fire, matching `isPressed` / `isJustPressed` behavior. DOM-driven events fire one frame after the browser dispatch (see [Frame deferral](#frame-deferral)); synthetic injection (`fireKeyDown` etc.) is sync.

## Scroll wheel

`wheel` events appear as one-frame action edges (`WheelUp`, `WheelDown`, `WheelLeft`, `WheelRight`) — rebindable like keys, never linger in `pressedKeys`. Direct callback access via `onWheel(fn)` for raw deltas.

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

import { InputPlugin } from "@yagejs/input";
const menu = document.createElement("div");

new InputPlugin({
  actions: {
    zoomIn: ["WheelUp", "Equal"],
    zoomOut: ["WheelDown", "Minus"],
  },
  wheelInvertY: false, // default; flip if your game wants positive dy = up
  preventDefaultWheel: false, // default; opt-in to swallow page scroll
});

// In a component
input.onWheel((dx, dy) => {
  input.consumeWheel(); // claim this event before its action edges are emitted
  menu.scrollBy(dx, dy);
});
```

`consumeWheel()` is valid only while an `onWheel` callback is running. It
throws outside that callback. Each wheel event has its own claim, including
when several wheel events drain in one frame. Wheel-bound actions also enter
the `consumeBufferedPress()` history.

## Frame deferral

DOM-originated keyboard, pointer, and wheel events buffer onto an internal queue and apply at `Phase.EarlyUpdate` via `InputPollSystem`. Action queries (`isJustPressed`, `isJustReleased`) see the edge on the frame _after_ the browser dispatch — single-frame latency, invisible to gameplay reading state at frame start.

```
F0:  browser dispatches `pointerdown`
     -> InputPlugin queues the event
F0:  rAF tick — InputPollSystem drains the queue
     -> UI hit-test
     -> pointer listeners (onPointerDown)
     -> action edges applied (justPressed / mouseAggregate)
F0:  user systems read state
```

Why: any listener that wants to claim the event (`consumePointer`, the renderer's UI hit-test fallback) gets a chance to run before action-map edges fire. Removes the assumption that Pixi must register listeners before YAGE.

Synthetic injection bypasses the queue and applies state synchronously — tests using `fireKeyDown` / `firePointerDown` / `fireGamepadButton` read updated state immediately. Tests that drive `dispatchEvent` directly need an explicit `manager._drainInputQueue()` (or a frame step) before assertions.

Window blur and page hide release held keyboard, gamepad, and pointer input
through the normal release paths, then discard browser events queued before
the focus boundary. Action-source holds are independent and remain held until
their owner releases them.

## Pointer / wheel consume

Primitives for handler code that wants to claim an event so it doesn't propagate to the action map. Listener notifications still fire (they're explicit user opt-ins); only the gameplay action edges (`MouseLeft`/`Middle`/`Right`, `WheelUp/Down/Left/Right`) are suppressed.

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

input.onPointerDown(({ id }) => {
  input.consumePointer(id); // claim a pointer for the rest of its event cycle
  input.isPointerConsumed(id); // boolean
});
input.onWheel(() => {
  input.consumeWheel();
});
```

`consumePointer` lifetime is per-pointer generation: cleared when that cycle's last button releases or on `pointercancel`. A reused browser pointer id starts a new, unclaimed generation. Calling `consumePointer` for an id that is not active throws.

`consumeWheel` is event-scoped and valid only inside the wheel callback that is
claiming the event. UI consume surfaces are checked before wheel action edges,
so scrolling a `UIScrollView` does not also fire wheel-bound gameplay actions.

`consumePointer` also covers **forwarding or replaying a synthetic pointer to the canvas**. A DOM overlay above the canvas (virtual joystick, accessibility overlay, input-replay tooling) that dispatches a synthetic `PointerEvent` so listeners underneath still receive it must pair the dispatch with `consumePointer`, or every forwarded tap leaks into the `MouseLeft/Middle/Right` action edge:

```ts
import type { InputManager } from "@yagejs/input";

function forwardPointer(
  overlayEl: HTMLElement,
  canvas: HTMLCanvasElement,
  input: InputManager,
) {
  overlayEl.addEventListener("pointerdown", (e) => {
    // Build the init explicitly — spreading `{ ...e }` drops pointerId/clientX/…
    // because PointerEvent fields are not own-enumerable properties.
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: e.pointerId,
        pointerType: e.pointerType, // else a forwarded touch/pen reads as mouse
        isPrimary: e.isPrimary, // drives primary-pointer reads
        clientX: e.clientX,
        clientY: e.clientY,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
    input.consumePointer(e.pointerId); // underneath listeners still fire; no action edge
  });
}
```

## UI auto-consume

Every primitive in `@yagejs/ui` (and `UIRoot` in `@yagejs/ui-react`) marks its underlying Pixi `Container` as a consume surface via a shared `WeakSet` in `@yagejs/core`. The renderer's optional `RendererAdapter.hitTestUI(x, y)` walks `EventBoundary.hitTest`'s parent chain looking for a marked ancestor. `@yagejs/input` checks it for pointer-down and wheel events. Clicks and scrolling on marked UI do not fire gameplay action edges.

`hitTestUI` only sees surfaces marked via `markPointerConsumeContainer` — `@yagejs/ui` primitives plus `Sprite` / `AnimatedSprite` components configured with `interactive: { consumeOnInteraction: true }` (a plain sprite is not a consume surface). Raw-Pixi UI drawn directly with `GraphicsComponent` / `TextComponent` (e.g. the `@yagejs-addons/dialogue` box) never marks its containers, so `hitTestUI` never detects it. Dialogue-aware callers should gate on `DialogueController.isActive()` / `isChoosing()` instead.

Per-component escape hatch via `consumeInput?: boolean` (default `true`):

```tsx
import { Panel } from "@yagejs/ui-react";
import { UIPanel } from "@yagejs/ui";

// React
<Panel consumeInput={false}>
  {/* This panel is transparent to the action map; clicks pass through. */}
</Panel>;

// Imperative
new UIPanel({ consumeInput: false /* … */ });
```

For custom Pixi containers that should also auto-consume, mark them yourself:

```ts
import { Container } from "pixi.js";

import {
  markPointerConsumeContainer,
  unmarkPointerConsumeContainer,
} from "@yagejs/core";

const container = new Container();
markPointerConsumeContainer(container); // also forces eventMode="static"
// later
unmarkPointerConsumeContainer(container);
```

Marking forces `eventMode = "static"` — required for Pixi's hit-test to report the container as the hit. Without that, `passive`-mode containers are skipped and the parent walk never sees the mark.

## SpriteComponent opt-in

Sprites are NOT marked by default — gameplay sprites usually want both Pixi events AND the action map. Opt in via `interactive`:

```ts
import { SpriteComponent } from "@yagejs/renderer";

new SpriteComponent({
  texture: "button.png",
  interactive: { eventMode: "static", consumeOnInteraction: true },
});
```

`consumeOnInteraction: true` adds the sprite to the consume registry for the
component's lifetime.

## Runtime Rebinding

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

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

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

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

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

const key = await input.listenForNextKey(); // "KeyZ" / "MouseLeft" / "GamepadA"
input.cancelListen();
```

## Gamepad

Gamepads are polled each frame from `navigator.getGamepads()` and routed
through the same key pipeline as keyboard/mouse, so `isPressed`,
`isJustPressed`, hold-duration, and `listenForNextKey` all work uniformly
across devices. Bind gamepad codes alongside keys in the action map:

```ts
import { InputPlugin } from "@yagejs/input";

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
`GamepadDPadUp/Down/Left/Right`, `GamepadHome`, and physical stick directions
`GamepadLeftStickUp/Down/Left/Right` and
`GamepadRightStickUp/Down/Left/Right`. Stick directions press at 0.5 and
release below 0.375 to avoid repeated edges near the boundary. Non-standard pads
(`mapping === ""`) expose `GamepadButtonN`, where `N` is the browser button
index (any non-negative integer the runtime emits, e.g. `GamepadButton0`,
`GamepadButton16`).

`GamepadLT`/`GamepadRT` fire as button edges when their analog value crosses
`triggerThreshold` (default 0.5). The analog value is independently available
via `getTrigger`.

### Analog API

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

const leftStick = input.getStick("left"); // Vec2 — radial deadzone, magnitude clamped to 1.0
const rightStick = input.getStick("right"); // Vec2
const leftTrigger = input.getTrigger("left"); // number, 0..1
const rightTrigger = input.getTrigger("right");

// Explicit per-pad lookup (couch-co-op style)
const player2Stick = input.getStick("left", { pad: 1 });
```

Reads from the active pad by default. Pass `{ pad: index }` to read only that
physical pad. An absent or idle explicit pad returns zero and never falls back
to synthetic axes.

### Active pad

A single pad is "active" at any time — the most-recently-used controller
auto-promotes via input activity (button press or stick/trigger above its
deadzone). The active pad's own activity keeps it from being reassigned, so
two players each pressing buttons doesn't bounce active back and forth.

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

const hud = document.createElement("p");

input.getActivePad(); // GamepadInfo | null
input.setActivePad(0); // manual switch (must be connected)
input.setActivePad(null); // clear; analog falls back to synthetic state

const dispose = input.onActivePadChanged((info) => {
  // Replays current state on subscribe; fires on every transition.
  hud.textContent = info ? `Player on pad ${info.index}` : "No controller";
});
```

### Connect / disconnect

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

const dispose = input.onGamepadConnected((info) => {
  // Replays currently-known pads on subscribe.
  console.log("Pad", info.index, info.id);
});

input.onGamepadDisconnected((info) => {
  console.log("Disconnected pad", info.index);
});

input.gamepads(); // synchronous: { index, id }[] from navigator.getGamepads()
```

Browsers gate `gamepadconnected` behind a first button press for security —
freshly-plugged pads won't fire until the user acts. Use `gamepads()` (or a
"press any button" UI hint) when you need ground truth.

### Config

```ts
import { InputPlugin } from "@yagejs/input";

new InputPlugin({
  deadzones: { stick: 0.15, trigger: 0.05 }, // defaults shown
  triggerThreshold: 0.5,
  pollGamepads: true,
});
```

Stick and trigger deadzones must be finite and in `[0, 1)`. The trigger
threshold must be finite and in `(0, 1]`. `fireGamepadAxis` accepts finite
stick values in `[-1, 1]` and trigger values in `[0, 1]`; invalid values throw
before input state changes.

### Synthetic injection (testing + virtual controls)

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

input.fireGamepadButton("GamepadA", true); // routes through real path
input.fireGamepadAxis("leftX", 0.7); // stored under synthetic pad

// Pointer injection accepts an optional opts arg for multi-pointer / touch tests.
input.firePointerMove(120, 80);
input.firePointerDown(0);
input.firePointerDown(0, { id: 5, type: "touch", isPrimary: false });
input.firePointerUp(0, { id: 5 });
```

Default `getStick`/`getTrigger` reads use synthetic axes when no pad is active or when the
active pad's own input rests inside its deadzone — an idle plugged-in
controller doesn't mask an actively-deflected virtual stick; a pad past the
deadzone always wins. Explicit `{ pad }` reads never use synthetic axes.
`applyRadialDeadzone(x, y, deadzone): Vec2` (exported)
is the exact dead-zone + rescale curve `getStick` applies — synthetic stick
sources use it to shape their own values with the same response.

### Synthetic action injection (by action name)

Use `fireAction` for a one-frame pulse. For a sustained synthetic device,
create one action source per independent owner. A source cannot release another
source's hold on the same action.

```ts yage-context="context"
import { InputManagerKey } from "@yagejs/input";
const input = context.resolve(InputManagerKey);

input.fireAction("attack"); // one-frame pulse: isJustPressed true for 1 frame

const touchControls = input.createActionSource();
touchControls.setHeld("attack", true); // idempotent sustained hold
touchControls.releaseAll(); // release every action owned by this source

input.hasAction("attack"); // is the name in the action map? Validate
//   config-sourced names up front instead of
//   catching the throw mid-gesture
```

`setHeld(action, true)` throws for an unknown action. Reasserting a hold is
idempotent. A down/up pair before frame clear preserves both edges. Call
`releaseAll()` when the synthetic device is disabled or destroyed.

Action bindings are captured when a physical or synthetic press starts. A map
change affects the next press; it does not retarget a held input. Every
contributing release makes `isJustReleased(action)` true. Duration helpers such
as `getReleaseDuration`, `isJustTapped`, and `isJustReleasedAfter` report only
the release that ends the action's final hold.

For deterministic inspector probes with a real controller plugged in, pair
`new InputPlugin({ pollGamepads: false })` with
`new DebugPlugin({ deterministicSeed: 42 })` so polling can't overwrite injected
state. `setPollingEnabled(false)` flips the same flag at runtime.
