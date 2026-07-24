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
| `@yagejs/pathfinding` | Grid A* pathfinding, tilemap adapter                 |
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
- **Refactors mean rethinking, not reshuffling** — when moving to a different architecture or public API, don't preserve old access patterns for backward compatibility unless explicitly asked. The path of least resistance (minimal diff, keep old call sites working) often smuggles the old design into the new one. Question whether every existing abstraction still belongs. When in doubt, ask rather than defaulting to compatibility shims.
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
- **`ServiceKey<T>` for plugin-owned infrastructure** — never use string keys. Type-safe resolution via `Component.use(Key)` or `Component.service(Key)`. Some keys are per-scene (e.g. `PhysicsWorldKey`, `SceneRenderTreeKey`) — `use()` resolves the correct one automatically. ServiceKey is for infrastructure owned by plugins (renderer, physics world, input manager). Entity-hosted state is accessed through entity queries or direct references from `spawn()` — never registered as a service. If a Component self-registers into DI, that's a sign it should be found through the ECS instead.
- **Pixels everywhere** — all user-facing APIs work in pixels. Physics coordinate conversion is internal to `PhysicsWorld`.
- **Immutable `Vec2`, mutable `Transform`** — `Vec2` operations return new instances. `Transform` has mutating methods (`setPosition`, `translate`, etc.).
- **No pixi.js imports in `@yagejs/core`** — core has zero runtime dependencies.
- **No raw `pixi.js` type in an exported signature** — public fields, parameters, and return types (in `@yagejs/renderer` and downstream consumers: ui, particles, tilemap, ...) use `@yagejs/renderer`'s alias layer (`DisplayContainer`, `DisplaySprite`, `GraphicsContext`, `ColorValue`, ...) instead of a direct `pixi.js` type import, so consumer code never needs to import `pixi.js` for types. The aliases are transparent (`type DisplayContainer = Container`) — this covers discoverability, not encapsulation. Constructing the actual Pixi object still imports `pixi.js` directly; only type positions in public signatures go through the alias.
- **Export new public types from `index.ts`** — every package has a barrel export.
- **Plain objects for config** — plugin configs, action maps, collider shapes. No `Map`, no classes for config.
- **Entity subclasses with `setup()` for entity types** — preferred pattern for game entities. `defineBlueprint()` still works for simple parametric factories but is deprecated.
- **Entity events for game logic** — `defineEvent()` / `entity.on()` / `entity.emit()` for entity-scoped events. `EventBus` for global engine events.
- **`@serializable` for save/load** — decorate Component/Entity/Scene subclasses. Implement `serialize()` + `static fromSnapshot()` for auto-restore. Components with non-serializable state (Textures, Graphics) use `FrameSource` or `textureKey` string alternatives; when raw objects are used, `serialize()` returns `null` and the entity handles reconstruction in `afterRestore()`.
- **Attribute developer-supplied callbacks** — engine code that invokes a
  callback the game registered (event handlers, collision handlers, input
  listeners, process callbacks) runs it through `ErrorBoundary.wrapCallback`,
  and a `System`/`Component`'s own update call goes through
  `wrapSystem`/`wrapComponent`. All three record the culprit (readable via
  `Inspector.getErrors().callbackErrors`), log it through `Logger`, and
  rethrow — nothing is disabled, unsubscribed, muted, or cancelled. Scene
  lifecycle hooks (`onEnter`, `onExit`, `onPause`, `onResume`, `beforeEnter`)
  use `ErrorBoundary.wrapLifecycleHook` instead: a synchronous throw is
  reported and rethrown the same way, but a rejected async hook can only be
  reported — the call has already returned by the time the rejection settles,
  so there's no stack left to rethrow into. `Logger`'s own `output` sink
  guards itself the same way, since it can't route through the boundary it's
  reporting into. `GameLoop.tick()` is the one place that decides a failure is
  terminal: an error that escapes an entire frame unhandled stops the loop and
  rethrows so it reaches the host. A new dispatch site still needs the wrap —
  it's what attributes the throw to the actual callback instead of whatever
  caller happened to be on the stack when it escaped.

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

### Language & audience

Docs are for the **user of the API**, not its author. Focus on the available API, how to use it, and what it produces. Apply these when writing or editing any doc:

- **Internals are a black box — except to explain a limitation or a gotcha.** Keep an internal detail only when a user would hit it (state persists across plays; a timer runs on your clock; an unmapped action silently does nothing). Cut pure mechanism ("the session fans its stream", "a layout owner … so they never drift", "drain order"), packaging rationale (tree-shaking, "lives on the root entry"), and testing notes ("a test asserts …").
- **Don't document what isn't shipped.** No roadmap, "deferred", "future", "purely additive", or internal milestone names (v1, v1.1). Delete "what's deferred" sections — their useful positive bits usually live elsewhere. Exception: a limitation a user would 100% expect (rare).
- **Lead with the outcome, not the architecture.** Intros and section openers say what you get and what it's for before how it's built. Order sections the way a user moves: install → make it work → then reference, packaging, and extension.
- **No invented terms.** Never coin a label and reuse it as if it were real YAGE vocabulary ("seam", "the multi-instance story", "leader"). Left in the docs, agents parrot them as de-facto terms. Jargon (orthogonal, drain order, syntactic sugar) is usually a symptom of over-detailed internals — first ask whether the passage should exist, then plain-word what remains.
- **Plain language.** One idea per sentence; don't stack em-dashes and parentheticals; plain words over idioms ("for free" → automatically, "lands normally" → completes, "wire up" → connect); no nouns as verbs ("poke a variable" → set a variable); name the referent; no LLM-ese.
- **Method.** Read each file end-to-end — grep finds words, not buried problems or inaccuracies. Edits stay focused but are not only word-swaps: rework hard sentences, reorder sections, and cut paragraphs that fail the tests above. Surface structural moves (section reorders, large cuts) as proposals. Verify a suspicious factual claim against the source yourself rather than shipping it.
- **LLM docs (`docs/llms/`): same rules, terser bar.** Less hand-holding is fine (the audience is agents), but still clean the language and kill invented terms.

## Key Commands

```bash
npx turbo typecheck     # Type-check all packages
npx turbo lint          # Lint all packages
npx turbo test          # Run all unit tests
npx turbo build         # Build all packages
npx playwright test     # E2E tests (requires build first)
```

## Addons

`packages/addons/*` (npm scope `@yagejs-addons`) is the layer between engine plugins and the game: installable, opinionated implementations of common gameplay patterns (dialogue, inventory, combat). Addons are **independently versioned** (kept out of the engine's `fixed` changeset group) and declare engine packages as **peer dependencies**. Before adding or changing anything under `packages/addons/`, read `packages/addons/AGENTS.md` — the addon authoring guide (layer model L0–L3, capability channels, rules-in/consequences-out, the seven rules, naming/packaging, export split, save via `SnapshotContributor`).

## Reference

See `docs/AGENT_GUIDE.md` for the full architecture guide — package dependency graph, key files, common modification patterns, lifecycle details, and pitfalls.
