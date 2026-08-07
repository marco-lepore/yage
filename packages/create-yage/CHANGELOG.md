# create-yage

## 0.10.2

### Patch Changes

- [#244](https://github.com/marco-lepore/yage/pull/244) [`e30b114`](https://github.com/marco-lepore/yage/commit/e30b114d416a211144463540fc6577e6abc6c1e9) Thanks [@marco-lepore](https://github.com/marco-lepore)! - The starter template's camera cuts back to the spawn point on a respawn.
  - Touching a hazard teleports the player to the spawn point. The camera follows at `smoothing: 0.12`, so a death at the far end of the level showed the camera easing the whole way back across it. The respawn handler calls `snapToTarget()` after the teleport, so the camera cuts.
  - The camera also passes `snap: true`. Under the bounds the template ships, the opening frame was already framed correctly; the option keeps it correct once the world constants are changed, which is among the first edits a starter project gets.

## 0.10.1

## 0.10.0

## 0.9.0

### Minor Changes

- [#159](https://github.com/marco-lepore/yage/pull/159) [`9b637bc`](https://github.com/marco-lepore/yage/commit/9b637bcd832476a6c47eb4dacb8cf33e9c5139b0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Update the scaffolded template for the seconds-based engine time unit.

  The `Oscillate` component in the recommended template integrates `dt` directly; `Component.update(dt)` now delivers seconds, so it accumulates `dt` without the old millisecond conversion.

## 0.8.0

## 0.7.0

### Minor Changes

- [#67](https://github.com/marco-lepore/yage/pull/67) [`a6dda59`](https://github.com/marco-lepore/yage/commit/a6dda59d9328666980c17c937f1ec7bd023efc40) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Scaffolder DX polish — `--features` flag and stricter defaults.
  - New `--features <list>` CLI flag (e.g. `--features ui,save,effects`) layers optional `@yagejs/*` deps onto the chosen template. `ui` also adds React (`react`, `react-dom`, `@yagejs/ui-react`, `@types/react`) and turns on `jsx: react-jsx` in `tsconfig.json`.
  - `templates/recommended/vite.config.ts` now ships `build.rollupOptions.output.keepNames: true` by default so dropping in `@yagejs/save` later Just Works without an extra config tweak.
  - Both `templates/recommended/tsconfig.json` and `templates/minimal/tsconfig.json` now set `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true` to match the engine's own strictness, so scaffolded projects get the same guarantees from day one.

## 0.6.0

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
