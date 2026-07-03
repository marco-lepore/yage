# @yagejs-addons/virtual-controls

Mobile touch overlay for [YAGE](https://yage.dev): a virtual joystick and
on-screen action buttons that drive the game through the input system —
gameplay code reads ordinary actions (`isPressed`, `getVector`,
`getHoldDuration`) and `getStick()`, and never knows the overlay exists.

- **Smart defaults** — floating stick bottom-left, buttons auto-clustered
  bottom-right (1 button, a diagonal pair, or an A/B/X/Y diamond), sizes
  relative to the viewport, shown automatically on touch-first devices
  (`visible: "auto"`).
- **No input leaks** — every touch a control claims is consumed
  (`consumePointer`), so joystick drags and button taps never fire gameplay
  `MouseLeft` actions or tap-to-move handlers underneath.
- **Real action semantics** — buttons hold actions via the synthetic action
  API (`setActionHeld`), so press/release edges, hold durations, and charge
  mechanics behave exactly like a physical key; the stick also feeds
  `getStick("left")` when no physical gamepad is active.
- **Customizable to fully custom** — placements, zones, stick modes
  (fixed / floating / follow), thresholds, a flat theme for the built-in
  Graphics presenter, or your own presenter behind a two-interface contract.
  The headless model is usable with no renderer at all.

## Install

```bash
npm install @yagejs-addons/virtual-controls @yagejs/core @yagejs/input @yagejs/renderer
```

`@yagejs/renderer` is optional — only the `/presenters` entry needs it.

## Quick start

The bound action names must exist in your `InputPlugin` action map — the
overlay drives existing actions (unknown names warn and are skipped):

```ts
import { VirtualControls } from "@yagejs-addons/virtual-controls";
import { createControlsPresenter } from "@yagejs-addons/virtual-controls/presenters";

engine.use(
  new InputPlugin({
    actions: {
      left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"],
      jump: ["Space"], dash: ["ShiftLeft"],
    },
  }),
);

class GameScene extends Scene {
  onEnter() {
    this.spawn("touch-controls").add(
      new VirtualControls({
        stick: { actions: ["left", "right", "up", "down"] }, // L/R/U/D order
        buttons: [
          { id: "a", action: "jump" },
          { id: "b", action: "dash" },
        ],
        presenter: createControlsPresenter(),
      }),
    );
  }
}
```

The overlay appears on touch-first devices and stays hidden on desktops; pass
`visible: true | false` or call `setVisible()` to decide yourself.

Docs: [yage.dev/addons/virtual-controls](https://yage.dev/addons/virtual-controls)
— runnable demo in the repo's `examples/virtual-controls.html`.
