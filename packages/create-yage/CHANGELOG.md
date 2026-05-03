# create-yage

## 0.5.0

## 0.4.0

## 0.1.1

### Patch Changes

- [#21](https://github.com/marco-lepore/yage/pull/21) [`32b35dc`](https://github.com/marco-lepore/yage/commit/32b35dcc89b5e28fdb852a08127f0a6f06ded819) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Rework the camera system into an entity + layer-binding model, and give every scene its own container.
  - Template scenes (`minimal` and `recommended`) migrated to the new `CameraEntity` API.

- [#17](https://github.com/marco-lepore/yage/pull/17) [`6b6df0f`](https://github.com/marco-lepore/yage/commit/6b6df0f5b0c288ad45b14226716fd36f0503c851) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fix `bin` path in `package.json`.

- [#20](https://github.com/marco-lepore/yage/pull/20) [`6143e03`](https://github.com/marco-lepore/yage/commit/6143e0346820dd74d78b1d345ac4ebc5e4294769) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Adopt scene-scoped DI.
  - Template `PlayerController` uses `PhysicsWorldKey` instead of `PhysicsWorldManagerKey.getOrCreateWorld(scene)`.
  - Template `main.ts` awaits `engine.scenes.push(...)` to match the async scene-manager API.
