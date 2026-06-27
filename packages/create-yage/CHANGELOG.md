# create-yage

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
