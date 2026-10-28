# @yagejs-addons/hotbar

## 0.1.0

### Minor Changes

- [#416](https://github.com/marco-lepore/yage/pull/416) [`75b4388`](https://github.com/marco-lepore/yage/commit/75b438863b82259c70ba035c436b4116e856b4c1) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add hotbars for abilities, consumables and game actions.
  - Bind typed action IDs to slots. Each binding reads availability, rejection reasons, quantities and cooldowns from the owner of the action.
  - Bind an `Abilities` component or an `Inventory` item action with `hotbarAbility()` and `hotbarItem()`, with no package dependency on either addon.
  - Hold a slot's key or press it with a mouse or finger for actions such as charged abilities. Letting go calls the binding's `release()`.
  - Turn on drag-to-swap for an edit mode, at setup or while the game runs, to rearrange slots by dragging.
  - Assign, clear, swap, save and restore slot layouts through the headless model. A restore leaves unknown or out-of-range entries empty and reports them.
  - Use the controller's keyboard, gamepad, mouse and touch controls, customize the default view with a partial theme, or supply a presenter. The view stays on screen when the entity that owns the bar moves.
  - Inspect assignments and activation outcomes through the Inspector and entity events.

### Patch Changes

- [#430](https://github.com/marco-lepore/yage/pull/430) [`41d025d`](https://github.com/marco-lepore/yage/commit/41d025db4dce4ab2dd2037ac355ad00f296b72ba) Thanks [@marco-lepore](https://github.com/marco-lepore)! - `HotbarView` adds its layer through the render tree of the scene it mounts on (`SceneRenderTreeKey`). It does not resolve the tools-only `SceneRenderTreeProviderKey`.

- Updated dependencies [[`e26bb25`](https://github.com/marco-lepore/yage/commit/e26bb252286c83cb6cec5a745420a1458b717bad), [`c3def87`](https://github.com/marco-lepore/yage/commit/c3def870a6be3e5f913eec8f8b5168dbd7809008), [`ba82273`](https://github.com/marco-lepore/yage/commit/ba822735627cf5350a844c7052e7c184bba0ac62), [`6dc14e6`](https://github.com/marco-lepore/yage/commit/6dc14e6aeea0b8d3e8fb17677017b44985971206), [`b804d22`](https://github.com/marco-lepore/yage/commit/b804d226cd8be730c6a2519d92789e929f7dc526), [`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`5b4ecaf`](https://github.com/marco-lepore/yage/commit/5b4ecaf3c19098e2f9d9e85c1246a3769994de7f), [`3aae2f1`](https://github.com/marco-lepore/yage/commit/3aae2f10761263a32d2790b86665941335566239), [`207d373`](https://github.com/marco-lepore/yage/commit/207d373f73e3b6aff8a1cbe36b5ae4097a2ff5d1), [`20fb06e`](https://github.com/marco-lepore/yage/commit/20fb06e5c808da0c1ef42e45526432ed675765f2), [`bea7218`](https://github.com/marco-lepore/yage/commit/bea7218cd64809a68f77d9ac6dddb6e9ae059326), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07), [`cd014b8`](https://github.com/marco-lepore/yage/commit/cd014b818f2f97c10825552d6e4feccca77fb640), [`fdda394`](https://github.com/marco-lepore/yage/commit/fdda394efd47114e097a569e28b3952cd0b5305a), [`162ce3f`](https://github.com/marco-lepore/yage/commit/162ce3fe615dcb03e64a5dc6a050d32e734249ad), [`5b4ecaf`](https://github.com/marco-lepore/yage/commit/5b4ecaf3c19098e2f9d9e85c1246a3769994de7f), [`837fe35`](https://github.com/marco-lepore/yage/commit/837fe3579c5268ab591b380fcea23257ec919f68), [`28532d4`](https://github.com/marco-lepore/yage/commit/28532d4fe5c8d853d465c7e8f373783d4ab83bd6)]:
  - @yagejs/renderer@0.13.0
  - @yagejs/input@0.13.0
  - @yagejs/core@0.13.0
