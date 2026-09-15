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
