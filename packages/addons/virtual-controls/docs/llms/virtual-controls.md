# @yagejs-addons/virtual-controls

Mobile touch overlay for YAGE — virtual joystick(s) + on-screen action buttons
(`@yagejs-addons` scope, independently versioned, NOT in the engine `fixed`
group). Headless model + a `@yagejs/core` Component + a pixi Graphics presenter.
Controls drive the game THROUGH `InputManager` — gameplay code reads ordinary
actions and `getStick()` and never knows the overlay exists.

## Install

```bash
npm install @yagejs-addons/virtual-controls
# engine peers (single install, reused — not bundled):
npm install @yagejs/core @yagejs/input @yagejs/renderer
```

`@yagejs/core` + `@yagejs/input` are required peers; `@yagejs/renderer` is an
optional peer (only the `./presenters` subpath needs it).

## Two entry points (export split — load-bearing)

- **`.`** (root) — headless. `VirtualControls` (a `@yagejs/core` Component),
  the model (`VirtualControlsModel` / `VirtualStick` / `VirtualButton`),
  config + layout types, entity events, `prefersTouchControls()`,
  and the presenter CONTRACTS (`ControlsPresenter` / `ControlView`).
  **MUST NOT transitively import pixi / renderer.**
- **`./presenters`** — everything pixi (via `@yagejs/renderer`, never raw
  pixi): `createControlsPresenter(theme?)`, `defaultControlsTheme()`,
  `GraphicsStickView` / `GraphicsButtonView`, `VIRTUAL_CONTROLS_LAYER(S)`.

```ts
import { VirtualControls, prefersTouchControls } from "@yagejs-addons/virtual-controls";
import { createControlsPresenter } from "@yagejs-addons/virtual-controls/presenters";
```

## 5-minute setup (zero assets, zero placement config)

Bound action names must exist in the `InputPlugin` action map — the overlay
drives existing actions, it does not define them (an unknown name warns and
is skipped until it exists):

```ts
engine.use(
  new InputPlugin({
    actions: {
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      up: ["KeyW", "ArrowUp"],
      down: ["KeyS", "ArrowDown"],
      jump: ["Space"],
      dash: ["ShiftLeft"],
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

Defaults: floating stick bottom-left (engagement zone = bottom 70% of the left
half), buttons auto-clustered bottom-right (1 = single, 2 = diagonal pair,
3 = corner arc, 4 = A/B/X/Y diamond, other counts = ring), sizes relative to
the viewport (stick 11% / button 6.5% of min(w, h)), overlay
`visible: "auto"`. Left-handed flips are one keyword each:
`cluster: "bottom-left"` moves the button cluster (inset stays derived),
`stick: { side: "right" }` flips the stick's placement/zone/axes defaults.
The presenter auto-provisions its screen-space layer (`"virtual-controls"`,
order 1080) — no `Scene.layers` declaration needed; declare
`...VIRTUAL_CONTROLS_LAYERS` only to pin ordering. The control set is fixed
at construction, but individual buttons can be shown, hidden, enabled, or
disabled at runtime. To add/remove buttons or change bindings, destroy the
host entity and add a fresh component.

## Runtime visibility and button availability

- `"auto"` (default): on iff the device's primary pointer is coarse
  (`prefersTouchControls()` — `(pointer: coarse)`, falls back to
  `maxTouchPoints`). Phones/tablets show, desktops (touch-screen laptops
  included) don't.
- `true` / `false`: decide yourself (e.g. a saved setting).
- `controls.setVisible(bool)` at runtime. Hiding releases every engaged
  control: mirrored actions get a real release edge, axes reset, views hide.
  While hidden nothing is claimed or consumed.
- `controls.enabled = false` and `entity.setActive(false)` do the same,
  independently of `visible`: the views hide and every hold is released. The
  requested `visible` value is kept and applies again on reactivation, so a
  HUD entity you turn off and back on returns to the state you set.

Change one configured button without rebuilding the overlay:

```ts
controls.setButtonVisible("restart", gameOver);
controls.setButtonEnabled("jump", canJump);
```

`controls.enabled` controls the whole overlay. `setButtonEnabled` affects only
the named button.

A hidden button does not draw or claim pointers. It keeps its layout slot, so
the other buttons do not move. A disabled button remains visible but does not
claim pointers; the built-in presenter dims it. Hiding or disabling a held
button releases its pointer and mirrored action before the setter returns.
Both methods throw for an unknown button id.

## How input flows (the consumption contract)

Pointers arrive in virtual px from `InputManager.onPointerDown/Move/Up`. On
down, the model routes: buttons claim first (they may sit inside a stick
zone), then sticks; each pointer owns at most one control. Every claimed
pointer is `consumePointer`ed BEFORE the frame's drain applies action edges,
so **a touch on the overlay never fires `MouseLeft/…` gameplay actions** — an
unclaimed touch passes through untouched. Pointers that land on `@yagejs/ui`
surfaces are skipped (`hitTestUI` wins over control zones). While the scene
`isPaused`, no NEW claims happen; in-flight releases still process.

Mirroring (all idempotent, per pointer event):

- Button ↔ `setActionHeld(action, pressed)` — press/release edges,
  `isPressed`, `getHoldDuration`, `onAction(Released)` all behave like a
  physical key (charge/hold mechanics work).
- Stick → 4 digital actions via `setActionHeld` when deflection crosses
  `threshold` (0.5, releases at 0.75× — hysteresis); reads back through
  `getVector`/`getAxis`.
- Stick → `fireGamepadAxis(leftX/leftY …)` (raw, PRE-deadZone), so
  `input.getStick("left")` returns the virtual stick. A physical pad
  deflected past its deadzone wins; an idle plugged-in pad does NOT mask
  the virtual stick. First stick defaults `axes: "left"`, second `"right"`;
  pass `axes: false` to opt out.
- Analog escape hatch: `controls.stick().value` (dead-zoned, -1..1, +y down)
  and `.rawValue`. `value` and `getStick()` use the SAME response curve
  (input's exported `applyRadialDeadzone`), but each applies its own
  deadzone number: the stick's `deadZone` option shapes `value` and the
  digital mirror; `getStick()` applies `InputConfig.deadzones.stick`, same
  as for physical pads.

Action names are re-validated LIVE on every mirror (`InputManager.hasAction`
— the action map can be swapped at runtime): unknown names warn once and are
skipped instead of throwing mid-gesture, and start working the moment they
exist.

## Config surface

```ts
new VirtualControls({
  stick:  { // or sticks: [ … ] for twin-stick
    id: "left",                    // default: side, else by position
    mode: "floating",              // "fixed" | "floating" | "follow"
    actions: ["left", "right", "up", "down"],  // L/R/U/D tuple (null skips a
                                   //   direction); object form also accepted:
                                   //   { left: "left", right: "right", … }
    side: "left",                  // or "right": flips placement/zone/axes/id
                                   //   defaults without hand-written geometry
    threshold: 0.5, deadZone: 0.1,
    axes: "left",                  // or "right" | false; defaults from side/position
    radius: 66,                    // virtual px; default 11% of min(vw, vh)
    placement: { left: 106, bottom: 106 },  // center, from edges (one h + one v)
    zone: { x: 0, y: 0.3, width: 0.5, height: 0.7 },  // viewport FRACTIONS
  },
  buttons: [{
    id: "a", action: "jump", label: "A",   // label defaults to id.toUpperCase()
    radius: 39, placement: { right: 55, bottom: 55 },  // omit both → auto cluster
    pressOnEnter: false,           // arcade thumb-roll: press on slide-in
    releaseOnLeave: true,          // release past 1.15 × radius
  }],
  cluster: "bottom-left",          // corner keyword keeps the size-derived inset
                                   //   (left-handed layouts); or pin exactly:
                                   //   { right: 140, bottom: 140 }
  visible: "auto",
  presenter: createControlsPresenter({ buttonPressedColor: 0xf472b6 }),  // Partial<ControlsTheme>; null = intentionally invisible (omitting warns)
  viewport: { x: 0, y: 0, width: 800, height: 600 },  // override; default = the adapter's visibleVirtualRect, tracked per frame
});
```

Stick modes: `"fixed"` (base pinned; grab circle = 1.5×radius; deflects
immediately), `"floating"` (base recenters under the touch anywhere in the
zone; returns to anchor on release), `"follow"` (floating + base drags along
past full deflection). Config errors (duplicate ids, malformed placements,
both `stick` and `sticks`, out-of-range deadZone/threshold) throw at
construction.

## Events (entity → scene bubble)

`VirtualButtonPressEvent` / `VirtualButtonReleaseEvent` (`{ id, action }`) and
`VirtualStickEngageEvent` / `VirtualStickReleaseEvent` (`{ id }`) — the hook
for haptics, UI sounds, tutorials, or buttons with no `action`. Per-frame
stick values are polled (`controls.stick().value`), not evented. Destroying
the host entity resets all mirrored input state but emits NO release events
(entity events no-op mid-destroy) — don't rely on balanced engage/release
pairs across a destroy.

## Custom presenters

Implement two pixi-free contracts from the root entry and hit-testing/routing
stays in the model (views only draw):

```ts
interface ControlsPresenter {
  mount(scene: Scene): void;
  createStickView(stick: VirtualStick): ControlView;   // poll stick.basePos/knobPos/active/layout
  createButtonView(button: VirtualButton): ControlView; // poll button.pressed/visible/enabled/layout/label
  dispose(): void;
}
interface ControlView { update(dt): void; setVisible(v): void; dispose(): void; }
```

Pass `presenter: null` for intentionally invisible controls (a DOM overlay or
custom render path draws them) — omitting the option entirely warns once,
since active-but-invisible controls are usually a forgotten import. The
built-in theme knobs live on `ControlsTheme`
(colors/alphas/border widths, `knobScale`, `labelScale`, `idleAlpha` /
`activeAlpha`, `layer`, `fontFamily`).

## Gotchas

- Coordinates are ALWAYS virtual px (what `PointerInfo.screenPos` reports);
  zones are viewport FRACTIONS. Layout re-resolves automatically on
  resize/orientation/fit changes (the component polls the on-screen virtual
  rect each frame).
- Set `touch-action: none` on the canvas container or the browser hijacks
  the second finger for scroll/zoom.
- `getStick()` reads the virtual stick only while NO physical gamepad is
  active — the pad wins by design.
- Two `VirtualControls` instances both listen for pointers; the
  first-registered claims first. One instance per scene is the intended
  shape.
- `controls.model.buttons` / `controls.model.sticks` are readonly ARRAYS of
  `VirtualButton` / `VirtualStick`. Buttons expose `.id`, `.layout`, `.pressed`,
  `.visible`, and `.enabled`; sticks expose `.id` and `.layout`. There is no
  id-keyed layout object. To read one control's resolved geometry (a tutorial
  highlight, a HUD hint), look it up by id: `controls.button(id)?.layout` /
  `controls.stick(id)?.layout`.
