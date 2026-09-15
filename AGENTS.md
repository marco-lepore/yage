# AGENTS.md

Universal guidelines for AI coding agents working on the YAGE codebase.

## Project Overview

YAGE is a 2D game engine built as a Turborepo monorepo.

## Task-specific Workflows

- **YAGE level editor:** Before planning, implementing, reviewing, or
  continuing level-editor work, read
  [`docs/AGENT_LEVEL_EDITOR_WORKFLOW.md`](docs/AGENT_LEVEL_EDITOR_WORKFLOW.md).
  That workflow defines how to locate and claim the local execution queue,
  which documents are authoritative, and which gates must pass before the next
  slice begins.

| Package               | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `@yagejs/core`        | ECS, DI, game loop, scenes, events (zero runtime deps)  |
| `@yagejs/renderer`    | PixiJS v8 rendering, sprites, camera                    |
| `@yagejs/lighting`    | Radial lights, light-level queries, render backends     |
| `@yagejs/physics`     | Rapier2D physics (pixel↔meter conversion is internal)   |
| `@yagejs/input`       | Keyboard/mouse/gamepad input + action maps              |
| `@yagejs/audio`       | Channel-based audio via @pixi/sound                     |
| `@yagejs/particles`   | Particle emitters with pooling and presets              |
| `@yagejs/tilemap`     | Tiled map loading and rendering                         |
| `@yagejs/pathfinding` | Grid A\* pathfinding, tilemap adapter                   |
| `@yagejs/ui`          | Yoga flexbox-based UI components                        |
| `@yagejs/ui-react`    | React reconciler over the UI layer                      |
| `@yagejs/debug`       | Debug overlay, stats, world/HUD drawing                 |
| `@yagejs/save`        | Controlled state documents, migrations, and named slots |
| `@yagejs/level`       | Level documents: read, validate, prepare, load          |

## Design Rules

- **No compatibility shims in a refactor.** When moving to a different
  architecture or public API, do not keep old access patterns working unless
  explicitly asked. Why: keeping old call sites working preserves the old
  design inside the new one. When in doubt, ask.
- **Extend the shared mechanism; never add a second one beside it.** No
  parallel registry, index, or cache next to an existing abstraction. The
  check: if a fix has to re-derive an invariant the existing mechanism already
  maintains (membership, activation state, teardown timing), it is rebuilding
  that mechanism, and every case where the two disagree is a defect. One
  workaround is a local fix; the same limitation in three places means the
  mechanism has to change. Take the fix that removes the cause, across as many
  packages as it needs, and describe the behaviour change in the changeset.
- **Scene subclass for a full scene, `defineInlineScene` for a prototype.**
  Choose by the actual use case.
- **Study the existing pattern before writing a new one, and report it if it
  looks wrong.** The codebase is work in progress. Existing code shows what
  was done, not that it was right.

## Coding Style

Enforced by tooling — match these conventions exactly:

- **TypeScript strict mode**: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- **Prettier**: double quotes, semicolons, 2-space indent, trailing commas
- **ESLint**: `typescript-eslint` strict config
- No `any` in public API signatures
- **Prefer `import type { Foo } from "./foo.js"` over inline `import("./foo.js").Foo`.** Inline `import()` type syntax is noisy and hard to read; use top-of-file `import type` statements. Use inline `import()` only to break an otherwise unavoidable circular type dependency, and add a comment explaining why.

## Architecture Rules

- **Components own game logic; Systems for engine internals** — `ComponentUpdateSystem` calls component `update(dt)`/`fixedUpdate(dt)`. Systems are for cross-cutting concerns (physics, rendering, audio).
- **`ServiceKey<T>` for plugin-owned infrastructure only** (renderer, physics world, input manager); never string keys. Keys with the same id string resolve the same service; a package that re-declares an id to avoid an optional runtime dependency adds a comment naming the owning package. Resolve with `Component.use(Key)` or `Component.service(Key)`; per-scene keys (`PhysicsWorldKey`, `SceneRenderTreeKey`) resolve to the current scene automatically. Entity-hosted state is reached through entity queries or references from `spawn()`, never registered as a service. A Component that self-registers into DI should be found through the ECS instead.
- **Pixels everywhere** — all user-facing APIs work in pixels. Physics coordinate conversion is internal to `PhysicsWorld`.
- **Immutable `Vec2`, mutable `Transform`** — `Vec2` operations return new instances. `Transform` has mutating methods (`setPosition`, `translate`, etc.).
- **No pixi.js imports in `@yagejs/core`** — core has zero runtime dependencies.
- **No raw `pixi.js` type in an exported signature.** Public fields, parameters, and return types in `@yagejs/renderer` and its consumers (ui, particles, tilemap, ...) use the renderer's aliases (`DisplayContainer`, `DisplaySprite`, `GraphicsContext`, `ColorValue`, ...). Why: consumer code never imports `pixi.js` for types. The aliases are transparent (`type DisplayContainer = Container`); constructing a Pixi object still imports `pixi.js` directly.
- **Export new public types from `index.ts`** — every package has a barrel export.
- **Plain objects for config** — plugin configs, action maps, collider shapes. No `Map`, no classes for config.
- **Entity subclasses with `setup()` for entity types** — preferred pattern for game entities. `defineBlueprint()` still works for simple parametric factories but is deprecated.
- **Entity events for game logic** — `defineEvent()` / `entity.on()` / `entity.emit()` for entity-scoped events. `EventBus` for global engine events.
- **Controlled save state** — only explicit state roots persist through `@yagejs/save`: a root implements `Serializable<TEncoded>` or comes from a core state factory. Runtime ECS objects, renderer resources, callbacks, and plugin internals are never traversed. Addons expose domain `snapshot()` / `restore()` so a game can include them in a root.
- **Every dispatch of game-registered code is wrapped**: event, collision, input, and process callbacks through `ErrorBoundary.wrapCallback`; `System`/`Component` updates through `wrapSystem`/`wrapComponent`; scene `onEnter`/`onExit`/`onPause`/`onResume` through `wrapLifecycleHook`. The wrap records the failing callback on `Inspector.getErrors().callbackErrors`, logs, and rethrows; nothing is disabled or unsubscribed. A new dispatch site needs the wrap. Full model: the Error-Handling Model section of `docs/AGENT_GUIDE.md`.
- **A throwing hook ends the sequence.** When developer code throws inside an engine-owned sequence (scene teardown, destroy cascade, pool disposal, event fan-out), the later steps do not run. Never add a collector that runs the remaining steps or a `try`/`finally` that forces the remaining teardown steps to run. The only fixes in scope: attribution (`wrapCallback`) and the reporting channel (`reportLifecycleError`, where a documented contract says the operation continues). The two shipped exceptions: the Error-Handling Model section of `docs/AGENT_GUIDE.md`.
- **Predictable failures throw an authored error at the entry.** When a
  failure is knowable at the call (unknown sound alias, missing asset key,
  out-of-range argument), validate at the entry and throw naming the offending
  input before anything mutates. This is edge validation, not mid-operation
  recovery.
- **No non-finite number (`NaN`, `Infinity`) enters engine state unguarded.** A game-supplied number written into simulation state (setter, config, callback return) throws at the write site with `Context.method: constraint, got ${x}`. Two legal inputs that combine into a non-finite result (a documented `Infinity` times a `dt` of `0`) get a defined result plus a one-shot `devWarn` when it is lossy. A read-only query stays unguarded and documents that the result is undefined. Full cases: the Error-Handling Model section of `docs/AGENT_GUIDE.md`.

## Testing

- **Unit tests**: co-located (`Foo.ts` → `Foo.test.ts` in the same directory)
- **E2E tests**: `e2e/` directory at repo root (Playwright)
- **Test utilities**: `createMockScene`, `createMockEntity`, `advanceFrames` from `@yagejs/core/test-utils`
- **E2E assertions**: use the Inspector API (`window.__yage__.inspector`), not screenshots

## Documentation

Two sets of docs. A new public API, config option, or gotcha goes into both, not necessarily with equal depth. Why: a missing LLM entry makes agents write broken code against a feature that exists; a missing human entry makes humans fail to discover one.

- **LLM docs** — `docs/llms/` (source). Terse reference that leads with signatures. **Never edit `docs/public/llms/`**: `docs/scripts/copy-llms.mjs` regenerates it on every docs build and overwrites edits.
- **Human docs (yage.dev)** — `docs/src/content/docs/` Astro + Starlight `.mdx` files. Narrative; may embed images, diagrams, and playable examples.

A new human docs page must be mapped to its Markdown counterpart in `docs/scripts/llm-docs.mjs` (or listed as having none in `docs/scripts/llm-docs.test.mjs`), and every served Markdown file must be linked from `docs/llms.txt`, or the docs tests fail.

Rebuild both after changes:

```bash
npx turbo run build --filter=@yagejs/docs
```

This runs `copy-llms.mjs` (regenerates `public/llms/`) then builds the Astro site.

### Language & audience

Docs are for the **user of the API**, not its author: the available API, how to use it, what it produces. Checks for any doc edit:

- **Internals are not described unless they explain a limitation or a gotcha** a user would hit (state persists across plays; a timer runs on your clock; an unmapped action silently does nothing). Cut pure mechanism, packaging rationale (tree-shaking, "lives on the root entry"), and testing notes.
- **Only shipped behavior.** No roadmap, "deferred", "future", "purely additive", or milestone names (v1, v1.1).
- **Outcome before architecture.** Section openers say what you get and what it is for. Order sections the way a user needs them: install, make it work, then reference, packaging, extension.
- **No invented terms.** A label that is not real YAGE vocabulary ("seam", "leader", "the multi-instance story") gets replaced by the behavior. Why: left in the docs, agents repeat it as a real term. Jargon (orthogonal, drain order, syntactic sugar) usually marks a passage of over-detailed internals.
- **Plain language.** One idea per sentence; no stacked em-dashes and parentheticals; literal words over idioms ("for free" → automatically, "wire up" → connect); no nouns as verbs; name the referent.
- **Read the whole file before editing it.** Grep finds words, not buried inaccuracies. Propose structural moves (section reorders, large cuts) rather than making them silently. Verify a suspicious claim against the source.
- **LLM docs in `docs/llms/` follow the same checks** with less hand-holding, since the audience is agents.

## Key Commands

```bash
npx turbo typecheck     # Type-check all packages
npx turbo lint          # Lint all packages
npm run format          # Format the repo with Prettier (CI runs format:check)
npx turbo test          # Run all unit tests
npx turbo build         # Build all packages
npx playwright test     # E2E tests (requires build first)
```

## Addons

`packages/addons/*` (npm scope `@yagejs-addons`) is the layer between engine plugins and the game: installable, opinionated implementations of common gameplay patterns (dialogue, inventory, combat). Addons are **independently versioned** (kept out of the engine's `fixed` changeset group) and declare engine packages as **peer dependencies**. Before adding or changing anything under `packages/addons/`, read `packages/addons/AGENTS.md` — the addon authoring guide (layer model L0–L3, capability channels, rules-in/consequences-out, the seven rules, naming/packaging, export split, controlled save state).

## Reference

See `docs/AGENT_GUIDE.md` for the full architecture guide — package dependency graph, key files, common modification patterns, lifecycle details, and pitfalls.
