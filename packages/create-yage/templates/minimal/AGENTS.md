# Agent Guide

This is a [YAGE](https://yage.dev) 2D game engine project (TypeScript + Vite).

## Run locally

- `npm install`
- `npm run dev` — start Vite dev server on http://localhost:5173
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build

## What's in the starter

The starter installs `@yagejs/core` and `@yagejs/renderer` only. It contains
one empty scene with a placeholder rectangle. `src/main.ts` has commented-out
blocks that register `@yagejs/physics`, `@yagejs/input`, `@yagejs/audio`, and
`@yagejs/debug`. Uncomment the blocks you need, and run the install command
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

See https://yage.dev/patterns/project-layout for the full conventions.
**Short version:**

- One scene per file.
- A simple entity is a single file. A complex entity is a folder with an
  `index.ts`.
- Entity-specific components live next to their entity. Use `components/` only
  for components shared across entities.
- Keep `main.ts` short.

## Key conventions

- `Vec2` is immutable — operations return new instances
- `Transform` is mutable — mutate in place for performance
- Pixels are the primary unit across every public API
- Put game logic in components. Systems are for engine internals only
- Spawn entities with `scene.spawn(EntityClass, params)` — YAGE calls `setup(params)` automatically
- Resolve services with `this.service(Key)` or `this.use(Key)` inside components

## Save state

Use `@yagejs/save` with an explicit `Serializable<TEncoded>` state root. Save
files contain only the state you choose. YAGE does not serialize the live ECS
world automatically.

## Full YAGE documentation

- Short index: https://yage.dev/llms.txt
- Full reference (for long LLM contexts): https://yage.dev/llms-full.txt
- Getting started tutorial: https://yage.dev/getting-started/your-first-game
- Project layout conventions: https://yage.dev/patterns/project-layout
- GitHub: https://github.com/marco-lepore/yage
