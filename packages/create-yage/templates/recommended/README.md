# my-yage-game

A YAGE game project.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173 and use `A`/`D` (or arrow keys) to move, `Space` to jump.

## Scripts

- `npm run dev` — start the Vite dev server with hot reload
- `npm run build` — type-check and produce a production build in `dist/`
- `npm run preview` — serve the production build locally

## What's in here

A playable platformer seed with an animated player, gravity, jumping, enemies,
coins, and a handful of platforms. Start modifying
`src/scenes/GameScene.ts` to build out your own level.

## Installable and offline

`npm run build` produces a Progressive Web App: players can install the game
and play it offline. Every file in the build is cached automatically, so new
assets in `public/` need no extra setup. Before you ship, set the game's name
in the `manifest` block of `vite.config.ts`, replace the icons in `public/`,
and serve the site over HTTPS. The dev server does not use a service worker;
test offline play with `npm run build` and `npm run preview`.

See `AGENTS.md` for project layout, conventions, and links to the full YAGE
documentation.
