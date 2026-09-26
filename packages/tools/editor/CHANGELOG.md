# @yagejs-tools/editor

## 0.2.0

### Patch Changes

- [#363](https://github.com/marco-lepore/yage/pull/363) [`a1d07ae`](https://github.com/marco-lepore/yage/commit/a1d07ae42d858cf8e94f4bb8414096bdd4a09c16) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Show authored collider footprints in the level editor.
  - Use collider footprints for invisible placements, including picking, bounds, framing and transform handles. Distinguish sensors and arrange remaining component icons around nearby groups, editing controls and viewport edges with consistent hover and click targets.

- [#367](https://github.com/marco-lepore/yage/pull/367) [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Support editing tilemaps in Tiled with automatic preview refresh.

  Add Open in Tiled beside local map assets, with native launchers for macOS, Windows and Linux and optional source-file mappings. Automatically refresh configured assets after external saves while preserving level edits, selection and undo history.

- Updated dependencies [[`a1d07ae`](https://github.com/marco-lepore/yage/commit/a1d07ae42d858cf8e94f4bb8414096bdd4a09c16), [`0c90d77`](https://github.com/marco-lepore/yage/commit/0c90d774bdbda47f5a95c92ab7aef11d7a19e7b9), [`1f45e38`](https://github.com/marco-lepore/yage/commit/1f45e38d108b17e37a807c209b5d84159b88867c), [`6888d06`](https://github.com/marco-lepore/yage/commit/6888d06c6fdf2361f41c5521ebdda83dc833b6c4), [`a7fd74e`](https://github.com/marco-lepore/yage/commit/a7fd74e75347a7a1b56ab18fcfb55f2f5cf4da46), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`8e2ea03`](https://github.com/marco-lepore/yage/commit/8e2ea031ab3dd93c2ae09177eb833e8ccd9a2681), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`1cc4061`](https://github.com/marco-lepore/yage/commit/1cc4061bc81d509a799feb2210c7e74513dd6e94), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`851310c`](https://github.com/marco-lepore/yage/commit/851310c54e04f5cdb52819050ca0a50f36b8e4c3), [`ba12b2f`](https://github.com/marco-lepore/yage/commit/ba12b2f0f851c2472abed23878b9598e57024d5f), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`5efe5f6`](https://github.com/marco-lepore/yage/commit/5efe5f6de138b71048e6f4752ed74647a9fc3e76), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`7ac9d9d`](https://github.com/marco-lepore/yage/commit/7ac9d9d0fd806e5ebd552b92ef9df7eb9b897210)]:
  - @yagejs/core@0.12.0
  - @yagejs/renderer@0.12.0
  - @yagejs/level@0.12.0
  - @yagejs/tilemap@0.12.0

## 0.1.0

### Minor Changes

- [#342](https://github.com/marco-lepore/yage/pull/342) [`72c2d67`](https://github.com/marco-lepore/yage/commit/72c2d6752afd33de8e616626d436b4b85d4512bf) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Raise the PixiJS peer floor from `^8.5.0` to `^8.8.0`.

  **Breaking:** a game on PixiJS 8.5 to 8.7 must upgrade to 8.8 or newer.

  `textureSpace`, the Graphics fill property that selects how a texture or a
  gradient maps onto a shape, does not exist before PixiJS 8.8.0. Older versions
  ignore it, so the `space` option on `linearGradient` and `radialGradient` has
  no effect there and the gradient renders in whichever mapping that version
  applies. The old floor admitted versions the engine has never supported.

### Patch Changes

- [#338](https://github.com/marco-lepore/yage/pull/338) [`6d286f7`](https://github.com/marco-lepore/yage/commit/6d286f7173c62d4facf0ad74fbb1f3fc41622294) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `yage-editor init`, which sets a project up for the editor.

  It writes `editor/config.ts`, `editor/harness.ts` and `src/levelProject.ts` under the project's Vite root, and adds an `"editor"` script to `package.json`. What the command can read off the project is prefilled: a plugin for each `@yagejs/*` package the project declares that has one (`save`, `level`, `pathfinding` and `effects` contribute none), level globs naming the directories that already hold `*.yage-level.json` files, `../src/layers.ts` when that module exists and default-exports, and `public/**/*.png` when that directory exists. A `src/layers.ts` that default-exports nothing is not the render layers — the name also belongs to a physics `CollisionLayers` module — so no glob names it and the report says so. The placeable entity classes and `gamePage` are left for the developer, since neither can be read off a project.

  The generated harness is a plain default-exported `{ engine, plugins }` object that imports neither this package nor `@yagejs-tools/lab`. A project that already has a scenario lab harness gets a one-line re-export of it rather than a second plugin list.

  A file that is already there is kept and named in the output; `--force` rewrites it.

- [#338](https://github.com/marco-lepore/yage/pull/338) [`1b73921`](https://github.com/marco-lepore/yage/commit/1b73921cb964f2fd4c55aecafecf8b66d4110fc1) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `yage-editor validate`, which checks every level file against the project's entity declarations without a browser.

  It reads the editor config, imports the project module through the project's own Vite config with Vite's SSR loader, builds the catalog, and runs `readLevel` and `validateLevel` over every file the level globs match. Nothing is rendered and no `setup()` runs.

  Problems print grouped by file, each naming the placement, the parameter path, the diagnostic code and the message, followed by a count line. The command exits 1 on any catalog problem, structural error, import failure or diagnostic, and 0 when every level is clean — including when the globs match no file, which it says. A catalog problem is reported against the project module and stops the run, since there is no catalog to check a level against.

  The `@yagejs/*` packages the project's modules import are transformed by Vite as well, rather than loaded by Node, so a module that imports `@yagejs/physics` (whose `@dimforge/rapier2d` Node cannot resolve) or `@yagejs/audio` is checked like any other. An import that reads `window` or `document` while it is evaluated fails, and the error says to move that import out of the entity modules or into the code that uses it.

  `--config` names a config file other than `editor/config.ts`.

- Updated dependencies [[`d2adfed`](https://github.com/marco-lepore/yage/commit/d2adfedb0e5d15269fe941a3a24f23ddb0126aa4), [`d951322`](https://github.com/marco-lepore/yage/commit/d951322da3dff3adfc532732f1578cc6f1149fa7), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`56570ae`](https://github.com/marco-lepore/yage/commit/56570ae539b98d2eefa000898c71eabea28df571), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`1b12043`](https://github.com/marco-lepore/yage/commit/1b120433e9570b21f5748c8cfaaf98bc781c4a62), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`47bf729`](https://github.com/marco-lepore/yage/commit/47bf7297056a506d5d21cbedaa3568a363d22051), [`9b9fe07`](https://github.com/marco-lepore/yage/commit/9b9fe07d7f32219c0e9aa37265b526cdc5924ce8), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`56570ae`](https://github.com/marco-lepore/yage/commit/56570ae539b98d2eefa000898c71eabea28df571), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`72c2d67`](https://github.com/marco-lepore/yage/commit/72c2d6752afd33de8e616626d436b4b85d4512bf), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aa5b78e`](https://github.com/marco-lepore/yage/commit/aa5b78e18b56d17bdca4ffb8299c8ea83979e05a), [`439d0e2`](https://github.com/marco-lepore/yage/commit/439d0e205228bee15d8d79607abdba5731b0873b), [`1b12043`](https://github.com/marco-lepore/yage/commit/1b120433e9570b21f5748c8cfaaf98bc781c4a62), [`56570ae`](https://github.com/marco-lepore/yage/commit/56570ae539b98d2eefa000898c71eabea28df571), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`b64cd45`](https://github.com/marco-lepore/yage/commit/b64cd453a65a83899b9e8d5fecf4ad43bf1eb3d4), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/renderer@0.11.0
  - @yagejs/core@0.11.0
  - @yagejs/level@0.11.0
