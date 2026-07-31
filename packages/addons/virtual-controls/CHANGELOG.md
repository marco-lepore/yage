# @yagejs-addons/virtual-controls

## 0.2.0

### Minor Changes

- [#217](https://github.com/marco-lepore/yage/pull/217) [`87f4923`](https://github.com/marco-lepore/yage/commit/87f4923ad71f3d6096907b54c3f16d806fe57a3f) Thanks [@marco-lepore](https://github.com/marco-lepore)! - The touch overlay now follows entity activeness. Deactivating its host entity — or setting `controls.enabled = false` — hides the views and releases every engaged control, so a dormant HUD entity leaves no painted controls on screen and no stuck action holds.

  `visible` stores what you set and reads it back unchanged; the views are on screen when the overlay is on and the component is running. A hand-set `setVisible(false)` survives a deactivate/reactivate cycle.

- [#215](https://github.com/marco-lepore/yage/pull/215) [`ccd86c6`](https://github.com/marco-lepore/yage/commit/ccd86c660c3d0b3fe6795d8cceed6a9b4eb2723b) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add runtime visibility and enabled state for individual virtual buttons.

### Patch Changes

- Updated dependencies [[`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`34d45fd`](https://github.com/marco-lepore/yage/commit/34d45fd690d747b7d8dd36a5972ef20d21d574da), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`f48983d`](https://github.com/marco-lepore/yage/commit/f48983dbb4e43c25b455ac3f96e7d8684266bbc3), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`042755b`](https://github.com/marco-lepore/yage/commit/042755b5649a90e99c8840747349255fbb3f95be), [`f1048ab`](https://github.com/marco-lepore/yage/commit/f1048ab756feee84e593609521c3a58fcfc1c1a7), [`4a5b3b6`](https://github.com/marco-lepore/yage/commit/4a5b3b639ddcbb285b6a4733b89d27bcee14c50c), [`d459026`](https://github.com/marco-lepore/yage/commit/d4590265b9aa5297fb99d20b92bb5a2f19cac0c5), [`8400b55`](https://github.com/marco-lepore/yage/commit/8400b5519cb3401a0ad91ab1be511e3d885cc203), [`81eafe0`](https://github.com/marco-lepore/yage/commit/81eafe04c3b362832e2dc873bea996f36f4601fd)]:
  - @yagejs/core@0.10.0
  - @yagejs/input@0.10.0
  - @yagejs/renderer@0.10.0

## 0.1.0

### Minor Changes

- [#163](https://github.com/marco-lepore/yage/pull/163) [`da97f10`](https://github.com/marco-lepore/yage/commit/da97f10ba7cb7627f48efccf3bfe1836bfac3dbc) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `@yagejs-addons/virtual-controls` — a mobile touch overlay addon: virtual joystick(s) + on-screen action buttons that drive the game through `InputManager`, so gameplay code reads ordinary actions and `getStick()` and never knows the overlay exists.
  - **Headless core** (root entry `.`): `VirtualStick` (fixed / floating / follow modes, dead-zone rescale, magnitude clamp, digital 4-way with hysteresis), `VirtualButton` (slide-off release, opt-in slide-in press), `VirtualControlsModel` (multi-touch routing — one pointer owns one control, buttons claim before sticks), pure layout resolution (edge-relative placements, viewport-fraction zones, viewport-relative size defaults), entity events, `prefersTouchControls()`, and the presenter contracts. The root entry never transitively imports `pixi.js` or `@yagejs/renderer`.
  - **`VirtualControls` component**: mirrors buttons onto actions via the synthetic hold API (`setActionHeld` — real press/release edges, `getHoldDuration`, group gating), the stick onto four digital actions (edge-diffed, so holds owned by other systems survive) plus the synthetic gamepad axes (`fireGamepadAxis`, so `getStick("left")` reads the virtual stick — a pad deflected past its deadzone wins, an idle plugged-in pad doesn't mask it), and `consumePointer`s every claimed touch **before** the frame's drain — a joystick drag or button tap never leaks a `MouseLeft` action edge into gameplay. Pointers on `@yagejs/ui` surfaces are skipped (`hitTestUI` wins); paused scenes take no new claims; action names are re-validated live (`hasAction`) so unknown ones warn instead of throwing mid-gesture and runtime `setActionMap` swaps just work.
  - **Smart defaults**: `visible: "auto"` shows the overlay only when the device's primary pointer is coarse; buttons without placements auto-cluster (1 corner button, 2 diagonal pair, 3 corner arc, 4 A/B/X/Y diamond, N ring) around a `cluster` anchor — a corner keyword (`"bottom-left"`) keeps the size-derived inset and mirrors the arrangement toward its corner; stick bindings take a tuple shorthand (`actions: ["left", "right", "up", "down"]`) and `side: "right"` flips a stick's placement/zone/axes defaults in one word; sizes derive from the viewport; layout re-resolves on resize/orientation/fit changes — mid-gesture too, replaying each engaged control against its new geometry; the presenter auto-provisions its screen-space layer.
  - **Presenters** (`./presenters` subpath): zero-asset Graphics presenter (`createControlsPresenter(theme?)`) with a flat `ControlsTheme`, knob return animation and idle/active fades; swap the whole look via the two pixi-free `ControlsPresenter` / `ControlView` interfaces — or omit the presenter and run the controls invisibly.

  Independently versioned (not part of the `@yagejs/*` fixed group). Ships ESM + CJS with type declarations for both entry points.

- [#169](https://github.com/marco-lepore/yage/pull/169) [`fa3619e`](https://github.com/marco-lepore/yage/commit/fa3619e331be0841598c57bcf7bb385341b92663) Thanks [@marco-lepore](https://github.com/marco-lepore)! - The overlay's screen-space layer (`"virtual-controls"`) moved from order 1050 to 1080: above the inventory addon's layers (1050–1070), below the dialogue addon's chrome (1100). Order 1050 collided with the inventory panel layer, so which drew on top depended on insertion order. Scenes that pin the layer by spreading `VIRTUAL_CONTROLS_LAYERS` pick up the new order automatically; only code that hardcoded `order: 1050` needs updating.
