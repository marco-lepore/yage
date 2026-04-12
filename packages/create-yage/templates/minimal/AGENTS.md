# Agent Guide

This is a [YAGE](https://yage.dev) 2D game engine project (TypeScript + Vite).

## Run locally

- `npm install`
- `npm run dev` — start Vite dev server on http://localhost:5173
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build

## What's in the starter

A minimal starter — just `@yage/core` + `@yage/renderer`, one empty scene
with a placeholder rectangle. `src/main.ts` has commented-out blocks showing
how to wire up `@yage/physics`, `@yage/input`, `@yage/audio`, and
`@yage/debug`; uncomment whichever you need and run the install command
listed above each block.

## Project layout

```
src/
├── main.ts             # Engine boot, plugins, scene push
└── scenes/
    └── MainScene.ts    # edit this to build your game
```

Add folders as your project grows. The suggested structure:

```
src/
├── main.ts
├── scenes/             # one file per scene
├── entities/           # entity subclasses (simple: single file; complex: folder)
└── components/         # components shared across multiple entities
```

See https://yage.dev/patterns/project-layout for the full convention writeup.
**Short version:** one scene per file; simple entity → single file, complex
entity → folder with `index.ts`; entity-specific components live next to
their entity, `components/` is only for components shared across entities;
keep `main.ts` short.

## Key conventions

- `Vec2` is immutable — operations return new instances
- `Transform` is mutable — mutate in place for performance
- Pixels are the primary unit across every public API
- Components own game logic; systems are for engine internals only
- Spawn entities with `scene.spawn(EntityClass, params)` — YAGE calls `setup(params)` automatically
- Resolve services with `this.service(Key)` or `this.use(Key)` inside components

## If you add `@yage/save` later

The Vite config already has `oxc.decorator.legacy: true` so `@serializable`
decorators on your own classes will work immediately. You'll also want to
add `build.rollupOptions.output.keepNames: true` at that point so the save
system can match classes by name after minification.

## Full YAGE documentation

- Short index: https://yage.dev/llms.txt
- Full reference (for long LLM contexts): https://yage.dev/llms-full.txt
- Getting started tutorial: https://yage.dev/getting-started/your-first-game
- Project layout conventions: https://yage.dev/patterns/project-layout
- GitHub: https://github.com/marco-lepore/yage
