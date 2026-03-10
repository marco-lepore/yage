# AGENTS.md

Universal guidelines for AI coding agents working on the YAGE codebase.

## Project Overview

YAGE is a 2D game engine built as a Turborepo monorepo.

| Package | Description |
|---|---|
| `@yage/core` | ECS, DI, game loop, scenes, events (zero runtime deps) |
| `@yage/renderer` | PixiJS v8 rendering, sprites, camera |
| `@yage/physics` | Rapier2D physics (pixel↔meter conversion is internal) |
| `@yage/input` | Keyboard/mouse/gamepad input + action maps |
| `@yage/audio` | Channel-based audio via @pixi/sound |
| `@yage/particles` | Particle emitters with pooling and presets |
| `@yage/tilemap` | Tiled map loading and rendering |
| `@yage/ui` | Yoga flexbox-based UI components |
| `@yage/ui-react` | React reconciler over the UI layer |
| `@yage/debug` | Debug overlay, stats, world/HUD drawing |
| `yage` | Meta-package: re-exports all + `createGame()` factory |

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

## Architecture Rules

- **Components own game logic; Systems for engine internals** — `ComponentUpdateSystem` calls component `update(dt)`/`fixedUpdate(dt)`. Systems are for cross-cutting concerns (physics, rendering, audio).
- **`ServiceKey<T>` for DI** — never use string keys. Type-safe resolution via `EngineContext`.
- **Pixels everywhere** — all user-facing APIs work in pixels. Physics coordinate conversion is internal to `PhysicsWorld`.
- **Immutable `Vec2`, mutable `Transform`** — `Vec2` operations return new instances. `Transform` has mutating methods (`setPosition`, `translate`, etc.).
- **No pixi.js imports in `@yage/core`** — core has zero runtime dependencies.
- **Export new public types from `index.ts`** — every package has a barrel export.
- **Plain objects for config** — plugin configs, action maps, collider shapes. No `Map`, no classes for config.
- **`defineBlueprint()` for entity factories** — parametric and composable. Use `Prefab` only for truly static templates.
- **Entity events for game logic** — `defineEvent()` / `entity.on()` / `entity.emit()` for entity-scoped events. `EventBus` for global engine events.

## Testing

- **Unit tests**: co-located (`Foo.ts` → `Foo.test.ts` in the same directory)
- **E2E tests**: `e2e/` directory at repo root (Playwright)
- **Test utilities**: `createMockScene`, `createMockEntity`, `advanceFrames` from `@yage/core/test-utils`
- **E2E assertions**: use the Inspector API (`window.__yage__.inspector`), not screenshots

## Key Commands

```bash
npx turbo typecheck     # Type-check all packages
npx turbo lint          # Lint all packages
npx turbo test          # Run all unit tests
npx turbo build         # Build all packages
npx playwright test     # E2E tests (requires build first)
```

## Reference

See `docs/v2/AGENT_GUIDE.md` for the full architecture guide — package dependency graph, key files, common modification patterns, lifecycle details, and pitfalls.
