# create-yage

## 0.11.0

### Patch Changes

- [#338](https://github.com/marco-lepore/yage/pull/338) [`cbce01f`](https://github.com/marco-lepore/yage/commit/cbce01f44d4f21a13839bce5a1ab04f5c022eadd) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add an `editor` entry to `--features`. `npx create-yage my-game --features editor` puts `@yagejs/level` in the project's dependencies and `@yagejs-tools/editor` in its devDependencies, adds an `"editor": "yage-editor"` script, and prints `npx yage-editor init` among the next steps — that command writes the editor's config, harness and project files itself.

  A feature can now carry `scripts` and `nextSteps` alongside its dependencies. Feature scripts are appended after the template's own, which keep their order.

- [#338](https://github.com/marco-lepore/yage/pull/338) [`cbce01f`](https://github.com/marco-lepore/yage/commit/cbce01f44d4f21a13839bce5a1ab04f5c022eadd) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Take `Oscillate`'s centre on its first update instead of in `onAdd`, so a coin or a hazard placed by a level bobs around where the level put it. A level applies a placement's transform after `setup()` returns, so the position `onAdd` read was the one the entity had before it was placed, and the first update wrote that position back.

- [#311](https://github.com/marco-lepore/yage/pull/311) [`aa5b78e`](https://github.com/marco-lepore/yage/commit/aa5b78e18b56d17bdca4ffb8299c8ea83979e05a) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Turn on `pixelArtPreset` in the scaffolded renderer config. The template's
  sprites are pixel art, and sheet slicing no longer forces nearest sampling on
  its own.

- [#304](https://github.com/marco-lepore/yage/pull/304) [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Template guidance describes the explicit save-root model, and the vite config
  comments explain the decorator and `keepNames` options on their own terms.

- [#317](https://github.com/marco-lepore/yage/pull/317) [`cfd041d`](https://github.com/marco-lepore/yage/commit/cfd041db1ad682f13f633852b9bbb55f2c91008d) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Fix create-yage scaffolding across supported environments.
  - Resolve bundled templates on Windows and when the install path contains spaces.
  - Preserve an existing `.git` directory during forced overwrite and report file targets accurately.
  - Update generated guidance, sprite anchors, and Node.js requirements.

## 0.10.4

## 0.10.3

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
