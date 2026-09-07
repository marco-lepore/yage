# Local engine checkout

Running a game against an unreleased engine build: link `@yagejs/*` from a
local clone of the engine repo instead of installing published versions. Four
rules decide whether it works; all four are npm's or Playwright's, not the
engine's.

## Recipe

```bash
# in the clone
npm install && npx turbo run build
```

In the game's `package.json`, point every `@yagejs/*`, `@yagejs-addons/*` and
`@yagejs-tools/*` dependency at the clone by `file:` path, and point the
`pixi.js` entry at the clone's own copy (add the entry if the game has none):

```json
{
  "dependencies": {
    "@yagejs/core": "file:../yage/packages/core",
    "@yagejs/renderer": "file:../yage/packages/renderer",
    "pixi.js": "file:../yage/node_modules/pixi.js"
  }
}
```

```bash
# in the game
npm install --ignore-scripts
npx playwright install chromium   # only for `yage-lab test`
```

Paths are relative to the game's `package.json`; absolute paths work too.
Addons live at `packages/addons/<name>`, tools at `packages/tools/<name>`.

## Rules

- **Build the clone first.** Every package serves its `dist/` folder and the
  repo commits no built output, so a link into an unbuilt clone resolves to a
  package with no entry point. Rebuild after every engine edit —
  `npx turbo run build --filter=@yagejs/renderer`, or
  `npx turbo run dev --filter=@yagejs/renderer` in the clone to rebuild on save.
  Run `npm install` in the game again only when a link is added or removed.
- **Link `pixi.js` too.** A game that imports Pixi itself lists `pixi.js` as its
  own dependency, and npm resolves that entry from the registry independently of
  the clone — often at a newer version — while the linked renderer keeps
  resolving the clone's copy through the link's real path. Two installs mean two
  module identities: `instanceof` fails, and every Pixi type the game imports
  (`Container`, `Graphics`, `Texture`) is a different type from the one the
  engine's signatures use. Pointing that entry at the clone's copy leaves one
  install. A game with no `pixi.js` entry of its own gets no second copy; the
  linked entry is harmless there. A dev build prints
  `[yage] Multiple copies of @yagejs/renderer are loaded` for the renderer case.
  Vite's `resolve.dedupe` is not a substitute: it changes what Vite bundles,
  while TypeScript resolves `node_modules` on its own and still sees two copies.
- **Install with `--ignore-scripts`.** npm runs the `prepare` script of a
  package linked by path, and Pixi's `prepare` runs husky, which a published
  copy does not have — the install fails on it. No `@yagejs/*` package has an
  install script, so the flag skips nothing on the engine side. It does skip
  Playwright's browser download; run `npx playwright install chromium` after the
  install, and `npm rebuild <package>` for anything else that needs its script.
- **Playwright browsers are per pinned build.** Each Playwright release pins a
  browser build, and the download is keyed to that build. `@playwright/test` is
  an optional peer of `@yagejs-tools/lab`, so the game installs its own copy at
  whatever the range resolves to; a release pinning a build not yet downloaded
  makes `yage-lab test` fail with a missing executable. Install browsers again
  after a Playwright upgrade, or pin `@playwright/test` to the version the clone
  has so both reuse one download.

## Going back to a release

Replace the `file:` entries with version ranges — `pixi.js` included, or remove
that entry if it was added only for the link — and run `npm install`.
