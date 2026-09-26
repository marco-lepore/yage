# @yagejs-tools/feedback

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

- Updated dependencies [[`a1d07ae`](https://github.com/marco-lepore/yage/commit/a1d07ae42d858cf8e94f4bb8414096bdd4a09c16), [`0c90d77`](https://github.com/marco-lepore/yage/commit/0c90d774bdbda47f5a95c92ab7aef11d7a19e7b9), [`ff80b80`](https://github.com/marco-lepore/yage/commit/ff80b80347c097092555ad0a6099bc14b62a7640), [`1f45e38`](https://github.com/marco-lepore/yage/commit/1f45e38d108b17e37a807c209b5d84159b88867c), [`6888d06`](https://github.com/marco-lepore/yage/commit/6888d06c6fdf2361f41c5521ebdda83dc833b6c4), [`a7fd74e`](https://github.com/marco-lepore/yage/commit/a7fd74e75347a7a1b56ab18fcfb55f2f5cf4da46), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`0f9d0bc`](https://github.com/marco-lepore/yage/commit/0f9d0bce27dd933d562fa6c9c66696b647574e69), [`8e2ea03`](https://github.com/marco-lepore/yage/commit/8e2ea031ab3dd93c2ae09177eb833e8ccd9a2681), [`908622a`](https://github.com/marco-lepore/yage/commit/908622adcf1a401251539e9edd081ad7ffc7e642), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`ba12b2f`](https://github.com/marco-lepore/yage/commit/ba12b2f0f851c2472abed23878b9598e57024d5f), [`851310c`](https://github.com/marco-lepore/yage/commit/851310c54e04f5cdb52819050ca0a50f36b8e4c3), [`ba12b2f`](https://github.com/marco-lepore/yage/commit/ba12b2f0f851c2472abed23878b9598e57024d5f), [`3bab027`](https://github.com/marco-lepore/yage/commit/3bab0271c916cd65f7e7dbe17388f7f7cedf20ff), [`5efe5f6`](https://github.com/marco-lepore/yage/commit/5efe5f6de138b71048e6f4752ed74647a9fc3e76), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`d6b8138`](https://github.com/marco-lepore/yage/commit/d6b813836696a1b8afd8f6cdf7ae1ddaf83f94e8), [`7ac9d9d`](https://github.com/marco-lepore/yage/commit/7ac9d9d0fd806e5ebd552b92ef9df7eb9b897210)]:
  - @yagejs/core@0.12.0
  - @yagejs/debug@0.12.0
  - @yagejs/renderer@0.12.0
  - @yagejs/input@0.12.0
