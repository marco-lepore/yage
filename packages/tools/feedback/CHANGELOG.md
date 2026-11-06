# @yagejs-tools/feedback

## 0.2.0

### Patch Changes

- Updated dependencies [[`e26bb25`](https://github.com/marco-lepore/yage/commit/e26bb252286c83cb6cec5a745420a1458b717bad), [`c3def87`](https://github.com/marco-lepore/yage/commit/c3def870a6be3e5f913eec8f8b5168dbd7809008), [`ba82273`](https://github.com/marco-lepore/yage/commit/ba822735627cf5350a844c7052e7c184bba0ac62), [`6dc14e6`](https://github.com/marco-lepore/yage/commit/6dc14e6aeea0b8d3e8fb17677017b44985971206), [`b804d22`](https://github.com/marco-lepore/yage/commit/b804d226cd8be730c6a2519d92789e929f7dc526), [`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`f3f2d71`](https://github.com/marco-lepore/yage/commit/f3f2d7163c1d8f3f67c402771a8ad297f64a0a83), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`590c7d2`](https://github.com/marco-lepore/yage/commit/590c7d2f0a024c27dc3c37e2272c90a59c8e1b0f), [`5b4ecaf`](https://github.com/marco-lepore/yage/commit/5b4ecaf3c19098e2f9d9e85c1246a3769994de7f), [`3aae2f1`](https://github.com/marco-lepore/yage/commit/3aae2f10761263a32d2790b86665941335566239), [`5ffc62f`](https://github.com/marco-lepore/yage/commit/5ffc62f0cb8a73c92880a09c2101d52cedfdaf03), [`207d373`](https://github.com/marco-lepore/yage/commit/207d373f73e3b6aff8a1cbe36b5ae4097a2ff5d1), [`20fb06e`](https://github.com/marco-lepore/yage/commit/20fb06e5c808da0c1ef42e45526432ed675765f2), [`bea7218`](https://github.com/marco-lepore/yage/commit/bea7218cd64809a68f77d9ac6dddb6e9ae059326), [`baf2d43`](https://github.com/marco-lepore/yage/commit/baf2d4317e36f284787de78422ecf20b9bdb3d75), [`bea7218`](https://github.com/marco-lepore/yage/commit/bea7218cd64809a68f77d9ac6dddb6e9ae059326), [`1bdcdc6`](https://github.com/marco-lepore/yage/commit/1bdcdc629ca5d6219baa95c4cc75e217f377fa07), [`cd014b8`](https://github.com/marco-lepore/yage/commit/cd014b818f2f97c10825552d6e4feccca77fb640), [`fdda394`](https://github.com/marco-lepore/yage/commit/fdda394efd47114e097a569e28b3952cd0b5305a), [`162ce3f`](https://github.com/marco-lepore/yage/commit/162ce3fe615dcb03e64a5dc6a050d32e734249ad), [`5b4ecaf`](https://github.com/marco-lepore/yage/commit/5b4ecaf3c19098e2f9d9e85c1246a3769994de7f), [`837fe35`](https://github.com/marco-lepore/yage/commit/837fe3579c5268ab591b380fcea23257ec919f68), [`28532d4`](https://github.com/marco-lepore/yage/commit/28532d4fe5c8d853d465c7e8f373783d4ab83bd6)]:
  - @yagejs/renderer@0.13.0
  - @yagejs/input@0.13.0
  - @yagejs/core@0.13.0
  - @yagejs/debug@0.13.0

## 0.1.0

### Minor Changes

- [#357](https://github.com/marco-lepore/yage/pull/357) [`6dd09b8`](https://github.com/marco-lepore/yage/commit/6dd09b87fcc3d3e070bd18ae255c50b55cd0f5d2) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add `@yagejs-tools/feedback`, runtime feedback for YAGE games.

  Freeze the running game, comment on the whole view, on entities, or on an
  area, and read each comment back from the `yage-feedback` CLI together with
  its screenshot and inspector snapshot. Made for handing observations to a
  coding agent: the gallery copies a ready-made instruction for Codex or Claude,
  and `ingest`, `address`, `resolve`, and `reopen` track what the agent did.

  ```ts
  // vite.config.ts
  import { yageFeedback } from "@yagejs-tools/feedback/vite";
  export default defineConfig({ plugins: [yageFeedback()] });

  // game
  import { FeedbackPlugin } from "@yagejs-tools/feedback";
  engine.use(new FeedbackPlugin({ enabled: import.meta.env.DEV }));
  ```

  ```sh
  npx yage-feedback list --status open --server http://localhost:5173/__yage/feedback/api/
  ```

  Three entry points: `FeedbackPlugin` for the game, `./vite` for the dev-server
  plugin that hosts the API and gallery on the game's port, and `./server` for
  the standalone server the CLI also starts with `yage-feedback serve`. Engine
  packages are peer dependencies; `@yagejs/input` and `vite` are optional
  peers. The standalone server accepts cross-origin requests from Vite's
  default origins, `http://localhost:5173` and `http://127.0.0.1:5173`, unless
  `--origin` is given.

### Patch Changes

- [#392](https://github.com/marco-lepore/yage/pull/392) [`ce75bb9`](https://github.com/marco-lepore/yage/commit/ce75bb9f245266f5f382232c25b9e77b66c25b0a) Thanks [@marco-lepore](https://github.com/marco-lepore)! - The feedback host reads the Inspector through `InspectorKey`, since the engine no longer exposes `engine.inspector`.

- Updated dependencies [[`a1d07ae`](https://github.com/marco-lepore/yage/commit/a1d07ae42d858cf8e94f4bb8414096bdd4a09c16), [`0c90d77`](https://github.com/marco-lepore/yage/commit/0c90d774bdbda47f5a95c92ab7aef11d7a19e7b9), [`ff80b80`](https://github.com/marco-lepore/yage/commit/ff80b80347c097092555ad0a6099bc14b62a7640), [`1f45e38`](https://github.com/marco-lepore/yage/commit/1f45e38d108b17e37a807c209b5d84159b88867c), [`6888d06`](https://github.com/marco-lepore/yage/commit/6888d06c6fdf2361f41c5521ebdda83dc833b6c4), [`a7fd74e`](https://github.com/marco-lepore/yage/commit/a7fd74e75347a7a1b56ab18fcfb55f2f5cf4da46), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`1520781`](https://github.com/marco-lepore/yage/commit/15207819383c8f9ea7ea299bf46aba07a0ee1a53), [`1520781`](https://github.com/marco-lepore/yage/commit/15207819383c8f9ea7ea299bf46aba07a0ee1a53), [`1520781`](https://github.com/marco-lepore/yage/commit/15207819383c8f9ea7ea299bf46aba07a0ee1a53), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`8e2ea03`](https://github.com/marco-lepore/yage/commit/8e2ea031ab3dd93c2ae09177eb833e8ccd9a2681), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`082897e`](https://github.com/marco-lepore/yage/commit/082897ef31a1e663dea482c77848101cbc0c5af1), [`ce75bb9`](https://github.com/marco-lepore/yage/commit/ce75bb9f245266f5f382232c25b9e77b66c25b0a), [`ce75bb9`](https://github.com/marco-lepore/yage/commit/ce75bb9f245266f5f382232c25b9e77b66c25b0a), [`ce75bb9`](https://github.com/marco-lepore/yage/commit/ce75bb9f245266f5f382232c25b9e77b66c25b0a), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`ba12b2f`](https://github.com/marco-lepore/yage/commit/ba12b2f0f851c2472abed23878b9598e57024d5f), [`851310c`](https://github.com/marco-lepore/yage/commit/851310c54e04f5cdb52819050ca0a50f36b8e4c3), [`ba12b2f`](https://github.com/marco-lepore/yage/commit/ba12b2f0f851c2472abed23878b9598e57024d5f), [`847ce80`](https://github.com/marco-lepore/yage/commit/847ce80baad0ed2a18569db9f28f185c61ab7c35), [`847ce80`](https://github.com/marco-lepore/yage/commit/847ce80baad0ed2a18569db9f28f185c61ab7c35), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`5efe5f6`](https://github.com/marco-lepore/yage/commit/5efe5f6de138b71048e6f4752ed74647a9fc3e76), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`7ac9d9d`](https://github.com/marco-lepore/yage/commit/7ac9d9d0fd806e5ebd552b92ef9df7eb9b897210), [`7aba1d9`](https://github.com/marco-lepore/yage/commit/7aba1d91bef7d4172a18cb8e88092cbebab3d09b), [`7aba1d9`](https://github.com/marco-lepore/yage/commit/7aba1d91bef7d4172a18cb8e88092cbebab3d09b)]:
  - @yagejs/core@0.12.0
  - @yagejs/debug@0.12.0
  - @yagejs/renderer@0.12.0
  - @yagejs/input@0.12.0
