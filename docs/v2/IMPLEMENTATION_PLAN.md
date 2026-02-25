# YAGE v2 -- Implementation Plan

## Overview

This document describes the phased build order for YAGE v2, from empty monorepo to polished release. Each phase has clear entry criteria, deliverables, and gate criteria that must be satisfied before proceeding.

**Estimated phases**: 10 (0-9)
**Dependencies**: Each phase lists which prior phases must be complete.

---

## Dependency Graph

```
Phase 0: Project Setup
    │
    v
Phase 1: Core Kernel
    │
    v
Phase 2: Renderer Plugin ──────────────────────────────────┐
    │         │              │              │                │
    │         v              v              v                │
    │    Phase 3:       Phase 6: UI    Phase 5: Audio,      │
    │    Input Plugin     Plugin       Particles, Tilemap   │
    │         │                                             │
    v         v                                             │
Phase 4: Physics Plugin                                     │
    │                                                       │
    v                                                       v
Phase 7: Debug Plugin                                  (all above)
    │                                                       │
    └───────────────────────┬───────────────────────────────┘
                            v
                      Phase 8: E2E Tests + Examples
                            │
                            v
                      Phase 9: Polish & Release
```

---

## Phase 0 -- Project Setup

**Depends on**: Nothing
**Goal**: Scaffolded monorepo with build, lint, test, and CI infrastructure. Zero application code.

### Deliverables

1. **Monorepo root**
   - `package.json` with `workspaces` field
   - `turbo.json` for Turborepo task orchestration (build, test, lint, typecheck)
   - `tsconfig.base.json` shared TypeScript config (strict mode, ESNext target, NodeNext module resolution)
   - `.eslintrc.js` (flat config) with TypeScript + Prettier integration
   - `.prettierrc`
   - `.gitignore`

2. **Package stubs** (empty `src/index.ts` + `package.json` + `tsconfig.json` for each):
   - `packages/core`
   - `packages/renderer`
   - `packages/physics`
   - `packages/input`
   - `packages/audio`
   - `packages/particles`
   - `packages/tilemap`
   - `packages/ui`
   - `packages/debug`
   - `packages/yage` (meta-package)

3. **Build configuration**
   - `tsup.config.ts` per package (ESM + CJS + .d.ts)
   - `turbo.json` pipeline: `lint` > `typecheck` > `test` > `build`

4. **Test configuration**
   - `vitest.workspace.ts` pointing at all packages
   - `playwright.config.ts` for E2E tests
   - `e2e/` directory stub

5. **CI**
   - `.github/workflows/ci.yml`: lint > typecheck > unit tests > build > e2e tests
   - Run on every PR and push to `main`

6. **Dev server**
   - Vite dev server for examples
   - `examples/` directory with index page listing all examples
   - Vite config with WASM support (for Rapier) and example routing

### Gate Criteria

- [ ] `npm install` succeeds from clean clone
- [ ] `turbo lint` passes on all packages
- [ ] `turbo typecheck` passes on all packages
- [ ] `turbo test` runs (no tests yet, but the runner works)
- [ ] `turbo build` produces ESM + CJS + .d.ts for every package
- [ ] CI pipeline runs green on a test PR
- [ ] Dev server starts and serves the example index page

---

## Phase 1 -- Core Kernel

**Depends on**: Phase 0
**Goal**: Complete `@yage/core` with full unit test coverage. The kernel is functional but has no visual output -- all testing is via Vitest in Node.js.

### Deliverables (in implementation order)

1. **Vec2, Transform, MathUtils**
   - `Vec2` immutable value type with all operations
   - `Transform` component (mutable position, rotation, scale)
   - `MathUtils` namespace (lerp, clamp, remap, randomRange, etc.)
   - Tests: Vec2 arithmetic, edge cases (zero vectors, normalization of zero)

2. **EventBus**
   - Typed pub/sub with `on()`, `once()`, `emit()`, `clear()`
   - Returns unsubscribe function
   - Tests: subscribe, emit, unsubscribe, once, clear, ordering

3. **Logger**
   - Structured logging with levels, categories, ring buffer
   - `formatRecentLogs()` for agent consumption
   - Tests: log levels, category filtering, buffer overflow, formatting

4. **EngineContext**
   - Service registration and resolution
   - `ServiceKey<T>` typed keys
   - Tests: register, resolve, tryResolve, has, duplicate registration error

5. **Component**
   - Base class with `enabled`, `entity` reference, lifecycle hooks
   - Tests: enabled flag, onAdd/onRemove/onDestroy callbacks

6. **Entity**
   - Component add/get/tryGet/has/remove with Map-based O(1) lookup
   - Name, tags, destroy
   - Tests: component CRUD, name/tag queries, destroy lifecycle

7. **QueryCache**
   - Register queries by component signature
   - Incremental update on component add/remove
   - Tests: registration, entity matching, updates on add/remove, multi-component filters

8. **System + SystemScheduler**
   - `System` base class with phase, priority, enabled
   - `SystemScheduler` with ordered execution per phase
   - Tests: registration, ordering, phase dispatch, enabled toggle

9. **ErrorBoundary**
   - Wraps system and component execution
   - Disables offending system/component on throw
   - Tests: catch and disable, error logging, game loop continues

10. **GameLoop**
    - Fixed timestep with accumulator
    - Phase dispatch: earlyUpdate > fixedUpdate > update > lateUpdate > render > endOfFrame
    - `requestAnimationFrame` fallback (no PixiJS Ticker yet)
    - Tests: phase ordering, fixed step accumulation, max steps per frame, start/stop

11. **Scene + SceneManager**
    - Scene with entity ownership, spawn/destroy, lifecycle hooks
    - SceneManager stack with push/pop/replace, pauseBelow/transparentBelow
    - Tests: push/pop/replace, lifecycle hook ordering, pause semantics, entity isolation

12. **Process / Tween / Sequence**
    - Process coroutine with duration, loop, cancel, toPromise
    - Tween.to, Tween.custom, Tween.vec2
    - Sequence with then/wait/call/parallel
    - Tests: duration, loop, cancel, promise resolution, easing accuracy, sequence ordering

13. **ProcessSystem** *(follow-up — primitives exist but lack auto-driving)*
    - `ProcessComponent` for entity-scoped processes (auto-cancel on entity destroy)
    - Scene-level `ProcessRegistry` for global processes (screen fades, transitions)
    - `ProcessSystem` in `Phase.Update` at priority ~500 (before `ComponentUpdateSystem` at 1000) ticks both
    - Tests: auto-tick, completion removal, entity destroy cancellation, scene-level lifecycle

14. **Prefab** *(SPIKE — current API insufficient, needs exploration)*
    - Current: static template with fixed constructor args and class-keyed overrides
    - Problem: real entity creation patterns are parametric factories where shared params (e.g. width/height) feed multiple components, post-construction methods (`.draw()`, `.onCollision()`) can't be expressed as constructor args, and runtime-computed closures reference entity instances
    - Spike needed to evaluate: (a) redesign into `Prefab<P>` with typed params + post-construction hooks, (b) remove in favor of plain factory functions, or (c) narrow scope to truly static entities only
    - Tests: build and spawn, overrides, nested children

15. **Inspector**
    - snapshot(), getEntityByName(), getEntityPosition(), hasComponent(), getComponentData()
    - Tests: snapshot accuracy, entity queries, component inspection

16. **Engine**
    - Orchestrates all of the above: plugin registration, start/destroy
    - Tests: engine lifecycle, plugin install order, context wiring

### Gate Criteria

- [ ] 100% statement coverage on `@yage/core` (Vitest + `--coverage`)
- [ ] All public APIs have TSDoc comments
- [ ] Zero `any` in public type signatures
- [ ] `@yage/core` has zero runtime dependencies (verify `package.json`)
- [ ] All tests pass in CI

---

## Phase 2 -- Renderer Plugin

**Depends on**: Phase 1
**Goal**: PixiJS v8 integration. First visual output. Entities with `Transform` + `SpriteComponent` render on screen.

### Deliverables

1. **RendererPlugin**
   - Creates PixiJS v8 `Application`, attaches Ticker to `GameLoop`
   - Registers service keys: `RendererKey`, `StageKey`, `CameraKey`
   - Virtual resolution support (scale stage to fit canvas)

2. **SpriteComponent**
   - Wraps PixiJS `Sprite`. Accepts texture alias or `Texture` object.
   - Auto-adds to/removes from stage on entity add/destroy.

3. **GraphicsComponent**
   - Wraps PixiJS `Graphics`. Provides `draw(fn)` for fluent drawing.

4. **AnimatedSpriteComponent**
   - Wraps PixiJS `AnimatedSprite`. `play()`, `stop()`, animation state.

5. **Camera**
   - Follow, deadzone, zoom, shake, bounds
   - `screenToWorld()` / `worldToScreen()`

6. **DisplaySystem**
   - Render phase. Syncs `Transform` to PixiJS display objects.
   - Applies camera transform.

7. **RenderLayer**
   - Named layers with draw order.

8. **First example**: Static sprites rendering on screen.

### Gate Criteria

- [ ] A simple example renders sprites at correct positions
- [ ] Camera follow/zoom/shake visually work
- [ ] Virtual resolution scales correctly on window resize
- [ ] DisplaySystem properly syncs Transform to PixiJS objects
- [ ] Unit tests for Camera math (follow, shake, worldToScreen)
- [ ] No PixiJS types leak into `@yage/core`

---

## Phase 3 -- Input Plugin

**Depends on**: Phase 2 (input needs the renderer's canvas for pointer coordinate conversion; keyboard can fall back to `document`)
**Goal**: Full multi-device input with action maps.

### Deliverables

1. **InputPlugin** + **InputManager**
   - Keyboard, mouse, touch, gamepad support
   - Action map as plain object
   - `isPressed()`, `isJustPressed()`, `isJustReleased()`, `getAxis()`, `getVector()`
   - `getPointerPosition()` with camera-aware world coordinate conversion
   - Configurable `preventDefaultKeys`

2. **InputSystem**
   - EarlyUpdate: poll gamepad, update state
   - EndOfFrame: clear per-frame flags

3. **Input example**: Character moves with keyboard/mouse, gamepad debug display

### Gate Criteria

- [ ] Keyboard actions work (pressed, just-pressed, just-released, hold duration)
- [ ] Mouse position returns correct world coordinates
- [ ] Touch input works on mobile browsers
- [ ] Gamepad connection/disconnection handled gracefully
- [ ] `preventDefaultKeys` only blocks specified keys
- [ ] Unit tests for action map resolution, state transitions, axis calculation

---

## Phase 4 -- Physics Plugin

**Depends on**: Phase 2 (needs renderer for visual verification)
**Goal**: Rapier2D integration with zero user-facing coordinate conversion. First playable example.

### Deliverables

1. **PhysicsPlugin** + **PhysicsWorld**
   - Rapier2D initialization (async WASM load)
   - Internal pixel-to-meter conversion (users work in pixels)
   - Body/collider creation and destruction

2. **RigidBodyComponent**
   - `applyForce()`, `applyImpulse()`, `setVelocity()`, `getVelocity()` -- all in pixels
   - Types: dynamic, static, kinematic

3. **ColliderComponent**
   - Shapes: box, circle, capsule, polygon
   - `onCollision()`, `onTrigger()` event handlers
   - Sensor support

4. **CollisionLayers**
   - Named layer definitions, bitmask API

5. **PhysicsSystem** (FixedUpdate)
   - Transform sync, Rapier step, collision event dispatch

6. **PhysicsInterpolationSystem** (LateUpdate)
   - Smooth rendering between physics steps

7. **Bouncing ball example**: Complete, <10 lines of user code
8. **Platformer example**: Player with physics movement, platforms, collectibles

### Gate Criteria

- [ ] Bouncing ball works with gravity and restitution
- [ ] Collision events fire correctly (start/end)
- [ ] Sensor triggers work (enter/exit)
- [ ] Collision layers filter correctly
- [ ] No `pu()` or Rapier types in user code
- [ ] Physics interpolation produces smooth rendering at variable FPS
- [ ] Rapier WASM only loads when `@yage/physics` is installed
- [ ] Unit tests for coordinate conversion, collision layer bitmasks

---

## Phase 5 -- Audio, Particles, Tilemap

**Depends on**: Phase 2 (renderer, for particles/tilemap rendering). Tilemap optionally integrates with Phase 4 (physics) for collision shapes, but this is not a hard dependency. Audio depends only on Phase 1 (core). These plugins are grouped into a single phase because they are independent of each other and can be built in parallel.
**Goal**: Secondary plugins that round out the feature set.

### Deliverables

1. **Audio Plugin** (`@yage/audio`)
   - `AudioManager` with channels (sfx, music)
   - `SoundComponent` for entity-bound audio
   - Volume, mute, pause per channel
   - Audio example: music playback with SFX triggers

2. **Particles Plugin** (`@yage/particles`)
   - `ParticleEmitterComponent` with common presets
   - `ParticleSystem` updates emitters each frame
   - Particles example: fire, smoke, sparks

3. **Tilemap Plugin** (`@yage/tilemap`)
   - Load Tiled JSON maps
   - Render tile layers via PixiJS
   - Extract collision shapes for physics (optional integration)
   - Tilemap example: simple scrolling level

### Gate Criteria

- [ ] Audio plays with correct channel routing and volume
- [ ] Particle emitters create visual effects
- [ ] Tiled JSON maps render correctly
- [ ] Tilemap collision shapes integrate with physics (when both plugins installed)
- [ ] Each plugin works independently (no mandatory cross-dependencies except where documented)

---

## Phase 6 -- UI Plugin

**Depends on**: Phase 2 (renderer)
**Goal**: Layout system for menus, HUDs, and in-game UI.

### Deliverables

1. **UIPlugin**
   - UI root with anchor points
   - Flex-inspired layout (row, column, gap, padding)

2. **UI Elements**
   - `UITextElement`, `UIButtonElement`, `UIPanelElement`
   - Responsive to virtual resolution changes

3. **UISystem**
   - Layout calculation in LateUpdate phase

4. **UI example**: Main menu with buttons, HUD overlay with score

### Gate Criteria

- [ ] Text renders with correct positioning and style
- [ ] Buttons respond to click/touch with visual feedback
- [ ] Layout reflows on resolution change
- [ ] Panel nesting works (panels containing panels with different directions)

---

## Phase 7 -- Debug Plugin

**Depends on**: Phase 4 (physics shapes to render), Phase 2 (renderer)
**Goal**: Developer overlay for debugging games.

### Deliverables

1. **DebugPlugin**
   - FPS counter
   - Entity count
   - System timing breakdown
   - Physics collider shape rendering
   - Entity name labels
   - Toggle via hotkey (F12)

2. **Inspector integration**
   - `window.__yage__` exposure in debug mode
   - Inspector API accessible from browser console and Playwright

### Gate Criteria

- [ ] Debug overlay toggles on/off with F12
- [ ] Physics shapes render correctly over game entities
- [ ] FPS and entity count are accurate
- [ ] System timing shows per-system ms cost
- [ ] `window.__yage__` is available and returns correct data

---

## Phase 8 -- E2E Tests + Examples

**Depends on**: All plugin phases (5, 6, 7)
**Goal**: Comprehensive Playwright test suite and polished examples.

### Deliverables

1. **Playwright test suite**
   - Bouncing ball: verify ball falls and bounces
   - Input: verify keyboard actions trigger correctly
   - Physics: verify collision events fire
   - Scene transitions: verify push/pop/replace lifecycle
   - UI: verify button click triggers callback
   - Inspector: verify snapshot returns correct state

2. **Examples** (6+)
   - Bouncing ball (physics)
   - Platformer (physics + input + camera)
   - Top-down movement (input + camera + tilemap)
   - Input demo (all input devices visualized)
   - Particles demo (various emitter presets)
   - Scene stack demo (game + HUD + pause menu)

3. **Example index page**
   - Lists all examples with thumbnails/descriptions
   - URL routing for easy access

### Gate Criteria

- [ ] All Playwright tests pass in CI (headless Chromium)
- [ ] All examples run without errors
- [ ] Examples cover every installed plugin
- [ ] Examples demonstrate v2's DX improvement over v1 equivalents
- [ ] Tests use Inspector API (not screenshots) for assertions

---

## Phase 9 -- Polish & Release

**Depends on**: Phase 8
**Goal**: Release-ready meta-package, documentation, and migration guide.

### Deliverables

1. **Meta-package** (`yage`)
   - Re-exports all packages for convenience
   - Single `npm install yage` gets everything

2. **API documentation**
   - TypeDoc generated from TSDoc comments
   - Hosted on project website or GitHub Pages

3. **Migration guide**
   - v1 → v2 mapping for every class and utility
   - Before/after code comparisons
   - Breaking changes list

4. **README.md**
   - Quick-start guide
   - Feature list with links to docs
   - Example code

5. **CHANGELOG.md**
   - v2.0.0 release notes

6. **npm publish**
   - All packages published to npm under `@yage/*` scope
   - Semantic versioning from 2.0.0

### Gate Criteria

- [ ] `npm install yage` works and exposes all public APIs
- [ ] TypeDoc generates clean documentation for all packages
- [ ] Migration guide covers every v1 API
- [ ] README quick-start example runs without modification
- [ ] All CI checks pass on the release commit
- [ ] Packages published to npm (or ready to publish)

---

## Summary Table

| Phase | Name | Depends On | Key Output |
|---|---|---|---|
| 0 | Project Setup | -- | Monorepo, build, CI |
| 1 | Core Kernel | 0 | `@yage/core` with 100% test coverage |
| 2 | Renderer | 1 | First visual output (PixiJS v8) |
| 3 | Input | 2 | Multi-device input |
| 4 | Physics | 2 | Rapier2D, first playable example |
| 5 | Audio, Particles, Tilemap | 1 (audio), 2 (particles/tilemap) | Secondary plugins |
| 6 | UI | 2 | Layout system |
| 7 | Debug | 4, 2 | Debug overlay, inspector |
| 8 | E2E Tests + Examples | 5, 6, 7 | Playwright suite, 6+ examples |
| 9 | Polish | 8 | Meta-package, docs, release |

---

## References

- [PRD.md](./PRD.md) -- Product requirements driving this plan
- [TDD.md](./TDD.md) -- Technical design being implemented
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) -- Testing approach for each phase
- [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md) -- Plugin system guiding Phase 1 design
- [AGENT_GUIDE.md](./AGENT_GUIDE.md) -- Agent workflow for implementing phases
