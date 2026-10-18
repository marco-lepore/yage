# my-yage-game

A YAGE game project (minimal template).

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173 to see a placeholder rectangle. Start editing
`src/scenes/MainScene.ts` and `src/entities/Placeholder.ts` to build your game.

## Scripts

- `npm run dev` — start the Vite dev server with hot reload
- `npm run build` — type-check and produce a production build in `dist/`
- `npm run preview` — serve the production build locally

## What's in here

Just the bare minimum: `@yagejs/core` for the engine and `@yagejs/renderer` for
drawing. Add more packages (`@yagejs/physics`, `@yagejs/input`, `@yagejs/audio`, etc.)
as you need them. See `AGENTS.md` for the install commands and links to the
full YAGE documentation.

## Desktop and mobile builds

The same source builds a desktop app with Electron and iOS and Android apps
with Capacitor. A project created with
`npm create yage -- --features electron,capacitor` has the packages installed.
For a project created without those features, the packaging guide lists the
packages to install. Then `yage-pack init` writes each target's entry file and
project configuration:

```bash
npx yage-pack init --target electron --target ios --target android --app-id com.example.mygame
```

See https://yage.dev/tooling/packaging for the build commands.
