# @yage/input

Depends on `@yage/core`. Keyboard, mouse, and pointer input with action maps.

## Setup

```ts
import { InputPlugin } from "@yage/input";

engine.use(new InputPlugin({
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
}));
```

Or via `createGame({ input: true })` for defaults, or `createGame({ input: { actions: {...} } })`.

Registers `InputManagerKey` in `EngineContext`.

## InputManager Queries

```ts
import { InputManagerKey } from "@yage/input";

const input = context.resolve(InputManagerKey);

// Pressed state
input.isPressed("jump");       // held this frame
input.isJustPressed("fire");   // pressed this frame (edge)
input.isJustReleased("jump");  // released this frame (edge)

// Hold duration
input.getHoldDuration("fire"); // ms held, 0 if not held
input.isHeldFor("fire", 500);  // held >= 500ms

// Axis/vector
input.getAxis("left", "right");             // -1, 0, or 1
input.getVector("left", "right", "up", "down"); // Vec2 (not normalized)
```

## Pointer

```ts
input.getPointerPosition();       // Vec2 in world coords (if camera set)
input.getPointerScreenPosition(); // Vec2 in screen coords
input.isPointerDown();            // any pointer button held
```

Mouse buttons map to actions: `MouseLeft`, `MouseMiddle`, `MouseRight`.

## Runtime Rebinding

```ts
// Simple rebind
input.rebind("jump", "KeyZ");

// With conflict resolution (only between actions in the same group)
input.rebind("jump", "KeyA", { conflict: "replace" }); // steals from other action
input.rebind("jump", "KeyA", { conflict: "reject" });  // fails if conflict (default)

// Slot-based (replace binding at index)
input.rebind("jump", "KeyZ", { slot: 0 });

// Query bindings
input.getBindings("jump");       // readonly string[]
input.getActionsForKey("Space"); // string[]

// Persistence
const saved = input.exportBindings();  // ActionMapDefinition
input.loadBindings(saved);
input.resetBindings();                 // restore defaults
input.resetBindings("jump");           // restore single action
```

## Action Groups

```ts
input.setGroups({
  gameplay: ["jump", "left", "right", "fire"],
  menu: ["confirm", "cancel"],
});

input.disableGroup("gameplay");  // gameplay actions return false
input.enableGroup("gameplay");
input.setActiveGroups(["menu"]); // only menu active, all others disabled
input.isGroupEnabled("gameplay");
```

Ungrouped actions are always active. An action active in any enabled group remains active.

## Important

Always use `InputManagerKey` for all game input. Do not use raw DOM event listeners (`window.addEventListener("keydown", ...)`) or manual key-tracking sets. The InputPlugin handles action mapping, rebinding, group enable/disable, hold detection, and automatic cleanup. Raw listeners bypass all of this and leak when scenes change.

## Key Listening

For rebinding UI -- intercept the next physical key:

```ts
const key = await input.listenForNextKey(); // "KeyZ", or null if cancelled
input.cancelListen();
```
