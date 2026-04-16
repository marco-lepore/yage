# AGENTS.md

Universal guidelines for AI coding agents working on the YAGE codebase.

## Project Overview

YAGE is a 2D game engine built as a Turborepo monorepo.

| Package           | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `@yagejs/core`      | ECS, DI, game loop, scenes, events (zero runtime deps) |
| `@yagejs/renderer`  | PixiJS v8 rendering, sprites, camera                   |
| `@yagejs/physics`   | Rapier2D physics (pixel↔meter conversion is internal)  |
| `@yagejs/input`     | Keyboard/mouse/gamepad input + action maps             |
| `@yagejs/audio`     | Channel-based audio via @pixi/sound                    |
| `@yagejs/particles` | Particle emitters with pooling and presets             |
| `@yagejs/tilemap`   | Tiled map loading and rendering                        |
| `@yagejs/ui`        | Yoga flexbox-based UI components                       |
| `@yagejs/ui-react`  | React reconciler over the UI layer                     |
| `@yagejs/debug`     | Debug overlay, stats, world/HUD drawing                |
| `@yagejs/save`      | Save/load system with slot-based snapshots             |

## Design Philosophy

Read this before writing any code:

- **Simple APIs, internal complexity** — public interfaces should feel obvious and require minimal boilerplate. Hide implementation complexity behind clean abstractions.
- **Developer ergonomics first** — always consider how the end-developer will use an API. Fewer arguments, sensible defaults, discoverable names.
- **SOLID principles** — single responsibility, open/closed, etc. Apply pragmatically, not dogmatically.
- **Learn from existing code, but stay critical** — the codebase is WIP. Study existing patterns before writing new code, but don't blindly copy if you see something that could be better. Flag concerns.
- **Right tool for the job** — the engine offers multiple approaches (e.g., Scene subclass vs `defineInlineScene`). Choose based on the actual use case. A complex game scene belongs in a class; a quick prototype can use an inline setup.

## Coding Style

Enforced by tooling — match these conventions exactly:

- **TypeScript strict mode**: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- **Prettier**: double quotes, semicolons, 2-space indent, trailing commas
- **ESLint**: `typescript-eslint` strict config
- No `any` in public API signatures
- **Prefer `import type { Foo } from "./foo.js"` over inline `import("./foo.js").Foo`.** Inline `import()` type syntax is noisy and hard to read; use top-of-file `import type` statements. Only reach for inline `import()` when breaking an otherwise unavoidable circular type dependency — and add a comment explaining why.

## Architecture Rules

- **Components own game logic; Systems for engine internals** — `ComponentUpdateSystem` calls component `update(dt)`/`fixedUpdate(dt)`. Systems are for cross-cutting concerns (physics, rendering, audio).
- **`ServiceKey<T>` for DI** — never use string keys. Type-safe resolution via `EngineContext`.
- **Pixels everywhere** — all user-facing APIs work in pixels. Physics coordinate conversion is internal to `PhysicsWorld`.
- **Immutable `Vec2`, mutable `Transform`** — `Vec2` operations return new instances. `Transform` has mutating methods (`setPosition`, `translate`, etc.).
- **No pixi.js imports in `@yagejs/core`** — core has zero runtime dependencies.
- **Export new public types from `index.ts`** — every package has a barrel export.
- **Plain objects for config** — plugin configs, action maps, collider shapes. No `Map`, no classes for config.
- **Entity subclasses with `setup()` for entity types** — preferred pattern for game entities. `defineBlueprint()` still works for simple parametric factories but is deprecated.
- **Entity events for game logic** — `defineEvent()` / `entity.on()` / `entity.emit()` for entity-scoped events. `EventBus` for global engine events.
- **`@serializable` for save/load** — decorate Component/Entity/Scene subclasses. Implement `serialize()` + `static fromSnapshot()` for auto-restore. Components with non-serializable state (Textures, Graphics) use `FrameSource` or `textureKey` string alternatives; when raw objects are used, `serialize()` returns `null` and the entity handles reconstruction in `afterRestore()`.

## Testing

- **Unit tests**: co-located (`Foo.ts` → `Foo.test.ts` in the same directory)
- **E2E tests**: `e2e/` directory at repo root (Playwright)
- **Test utilities**: `createMockScene`, `createMockEntity`, `advanceFrames` from `@yagejs/core/test-utils`
- **E2E assertions**: use the Inspector API (`window.__yage__.inspector`), not screenshots

## Documentation

YAGE maintains two parallel documentation surfaces. When you ship a new public API, add a config option, or discover a gotcha worth warning about, make a reasonable effort to cover it in both where it makes sense:

- **LLM docs** — `docs/llms/` (source). Terse, signature-forward reference material optimised for context windows. **Never edit `docs/public/llms/` directly** — it's regenerated from `docs/llms/` by `docs/scripts/copy-llms.mjs` on every docs build and edits to the generated copy are silently overwritten.
- **Human docs (yage.dev)** — `docs/src/content/docs/` Astro + Starlight `.mdx` files. More narrative; can embed images, diagrams, and inline playable examples.

The two do NOT need 1:1 parity — human docs can be longer and more visual, LLM docs can skip prose that doesn't help an agent. But *something* should land in each surface when a feature becomes user-visible. A missing LLM entry makes agents write broken code against a feature that exists; a missing human entry makes humans fail to discover one.

Rebuild both after changes:

```bash
npx turbo run build --filter=@yagejs/docs
```

This runs `copy-llms.mjs` (regenerates `public/llms/`) then builds the Astro site.

## Key Commands

```bash
npx turbo typecheck     # Type-check all packages
npx turbo lint          # Lint all packages
npx turbo test          # Run all unit tests
npx turbo build         # Build all packages
npx playwright test     # E2E tests (requires build first)
```

## Reference

See `docs/AGENT_GUIDE.md` for the full architecture guide — package dependency graph, key files, common modification patterns, lifecycle details, and pitfalls.
