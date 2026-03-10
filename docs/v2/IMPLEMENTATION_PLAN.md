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

## Phase 0 -- Project Setup ✅ Complete

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

## Phase 1 -- Core Kernel ✅ Complete

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

## Phase 2 -- Renderer Plugin ✅ Complete

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

## Phase 3 -- Input Plugin ✅ Complete

**Depends on**: Phase 2 (input needs the renderer's canvas for pointer coordinate conversion; keyboard can fall back to `document`)
**Goal**: Multi-device input with action maps. Keyboard, mouse, and touch are implemented. Gamepad is planned but not yet implemented.

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

## Phase 4 -- Physics Plugin ✅ Complete

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

## Phase 5 -- Audio, Particles, Tilemap ✅ Complete

**Depends on**: Phase 2 (renderer, for particles/tilemap rendering). Tilemap optionally integrates with Phase 4 (physics) for collision shapes, but this is not a hard dependency. Audio depends only on Phase 1 (core). These plugins are grouped into a single phase because they are independent of each other and can be built in parallel.
**Goal**: Secondary plugins that round out the feature set.

### Deliverables

1. **Audio Plugin** (`@yage/audio`)
   - `AudioManager` with channels (sfx, music)
   - `SoundComponent` for entity-bound audio
   - Volume, mute, pause per channel
   - `sound()` asset handle factory for typed asset loading
   - Audio example: music playback with SFX triggers

2. **Particles Plugin** (`@yage/particles`)
   - `ParticleEmitterComponent` with configurable emitter properties
   - `ParticleSystem` updates emitters each frame
   - `ParticlePool` for allocation-free particle recycling
   - `ParticlePresets` with built-in presets: fire, smoke, sparks, rain
   - Particles example: fire, smoke, sparks

3. **Tilemap Plugin** (`@yage/tilemap`)
   - Load Tiled JSON maps via `tiledMap()` asset handle factory
   - Render tile layers via PixiJS (`TilemapRenderSystem`)
   - Extract collision shapes for physics (optional integration via `extractCollisionShapes()`)
   - Object extraction utilities: `extractObjects()`, `getProperty()`, `getPropertyArray()`, `resolveObjectRef()`, `resolveObjectRefArray()`
   - Tilemap example: simple scrolling level

### Gate Criteria

- [x] Audio plays with correct channel routing and volume
- [x] Particle emitters create visual effects
- [x] Tiled JSON maps render correctly
- [x] Tilemap collision shapes integrate with physics (when both plugins installed)
- [x] Each plugin works independently (no mandatory cross-dependencies except where documented)

---

## Phase 6 -- UI Plugin ✅ Complete

**Depends on**: Phase 2 (renderer)
**Goal**: Layout system for menus, HUDs, and in-game UI. Exceeded original scope with React integration.

### Deliverables

1. **UIPlugin** (`@yage/ui`)
   - Yoga flex layout engine integration
   - UI root with anchor points
   - Flex-inspired layout (row, column, gap, padding)
   - `BackgroundRenderer` for colored/textured panel backgrounds

2. **UI Elements** (`@yage/ui`)
   - `UIPanel` — layout container with Yoga flexbox
   - `UIText` — text rendering
   - `UIButton` — interactive button with hover/press states
   - `UIImage` — texture display
   - `UINineSlice` — 9-slice scaled sprites
   - `UIProgressBar` — progress indicator
   - `UICheckbox` — toggle checkbox
   - @pixi/ui wrappers: `PixiFancyButton`, `PixiCheckbox`, `PixiProgressBar`, `PixiSlider`, `PixiInput`, `PixiScrollBox`, `PixiSelect`, `PixiRadioGroup`

3. **React UI Plugin** (`@yage/ui-react`) — *added beyond original scope*
   - Custom React reconciler over Yoga + PixiJS
   - `UIRoot` component for hosting React trees in UI layer
   - Hooks: `useEngine()`, `useScene()`, `useQuery()`, `useStore()`, `useSceneSelector()`
   - Reactive state via `createStore()` / `Store<T>`
   - JSX wrappers: `Panel`, `Text`, `Button`, `Image`, `NineSlice`, `ProgressBar`, `Checkbox`
   - @pixi/ui JSX wrappers for advanced widgets

4. **UISystem**
   - Layout calculation in LateUpdate phase

5. **Examples**: `ui` (non-React), `ui-react` (React hooks/store), `pixi-ui-kitchen-sink` (@pixi/ui components)

### Gate Criteria

- [x] Text renders with correct positioning and style
- [x] Buttons respond to click/touch with visual feedback
- [x] Layout reflows on resolution change
- [x] Panel nesting works (panels containing panels with different directions)
- [x] React reconciler renders JSX into game UI layer
- [x] React hooks correctly read engine/scene state

---

## Phase 7 -- Debug Plugin ✅ Complete

**Depends on**: Phase 4 (physics shapes to render), Phase 2 (renderer)
**Goal**: Developer overlay for debugging games.

### Deliverables

1. **DebugPlugin**
   - `DebugRegistryImpl` — contributor registration, flag toggling, global enable/disable
   - `WorldDebugApiImpl` — world-space debug drawing via `GraphicsPool` (allocation-free)
   - `HudDebugApiImpl` — screen-space debug text via `TextPool` (allocation-free)
   - `StatsStore` — rolling-window statistics with Float64Array ring buffers (120-frame window)
   - Built-in contributors: FPS counter, entity count, system timing, physics shape rendering
   - Toggle via hotkey (F12)

2. **Inspector integration**
   - `window.__yage__` exposure in debug mode
   - Inspector API accessible from browser console and Playwright

### Gate Criteria

- [x] Debug overlay toggles on/off with F12
- [x] Physics shapes render correctly over game entities
- [x] FPS and entity count are accurate
- [x] System timing shows per-system ms cost
- [x] `window.__yage__` is available and returns correct data

---

## Phase 8 -- E2E Tests + Examples 🟡 Partial

**Depends on**: All plugin phases (5, 6, 7)
**Goal**: Comprehensive Playwright test suite and polished examples.

### Phase 8a -- Examples ✅ Complete

13 examples covering all major features:

1. `hello-world` — basic rendering with shapes and rotation
2. `camera` — camera follow, shake, bounds
3. `physics-basics` — rigid bodies and colliders
4. `physics-collisions` — collision events and triggers
5. `platformer` — character controller + tilemap + physics
6. `particles` — particle emitter presets
7. `audio` — sound playback and audio manager
8. `tilemap` — Tiled map rendering and collision
9. `ui` — UI panel components (non-React)
10. `ui-react` — React hooks, store, JSX components
11. `pixi-ui-kitchen-sink` — @pixi/ui component showcase
12. `debug` — debug HUD and profiling
13. `shooter` — player shooting, enemy AI

Example index page with URL routing for easy access.

### Phase 8b -- E2E Tests ❌ Not Started

Planned Playwright test suite (not yet implemented):
- Bouncing ball: verify ball falls and bounces
- Input: verify keyboard actions trigger correctly
- Physics: verify collision events fire
- Scene transitions: verify push/pop/replace lifecycle
- UI: verify button click triggers callback
- Inspector: verify snapshot returns correct state

### Gate Criteria

- [ ] All Playwright tests pass in CI (headless Chromium)
- [x] All examples run without errors
- [x] Examples cover every installed plugin
- [ ] Tests use Inspector API (not screenshots) for assertions

---

## Phase 9 -- Polish & Release 🟡 Partial

**Depends on**: Phase 8
**Goal**: Release-ready meta-package, documentation, and npm publish.

### Deliverables

1. **Meta-package** (`yage`) ✅ Complete
   - Re-exports all packages for convenience
   - `createGame()` ergonomic factory with `GameHandle`
   - `defineInlineScene()` for inline scene creation with pre-resolved `SceneServices`
   - Single `npm install yage` gets everything

2. **API documentation** ❌ Not started
   - TypeDoc generated from TSDoc comments
   - Hosted on project website or GitHub Pages

3. **README.md** ❌ Not started
   - Quick-start guide
   - Feature list with links to docs
   - Example code

4. **npm publish** ❌ Not started
   - All packages published to npm under `@yage/*` scope
   - Semantic versioning from 2.0.0

### Gate Criteria

- [x] `npm install yage` works and exposes all public APIs
- [ ] TypeDoc generates clean documentation for all packages
- [ ] README quick-start example runs without modification
- [ ] All CI checks pass on the release commit
- [ ] Packages published to npm (or ready to publish)

---

## Summary Table

| Phase | Name | Depends On | Status | Key Output |
|---|---|---|---|---|
| 0 | Project Setup | -- | ✅ Complete | Monorepo, build, CI |
| 1 | Core Kernel | 0 | ✅ Complete | `@yage/core` with 31 test files |
| 2 | Renderer | 1 | ✅ Complete | First visual output (PixiJS v8) |
| 3 | Input | 2 | ✅ Complete | Keyboard, mouse, touch (gamepad planned) |
| 4 | Physics | 2 | ✅ Complete | Rapier2D, raycasting, first playable example |
| 5 | Audio, Particles, Tilemap | 1 (audio), 2 (particles/tilemap) | ✅ Complete | Secondary plugins with asset handle factories |
| 6 | UI | 2 | ✅ Complete | Yoga layout, @pixi/ui wrappers, React reconciler |
| 7 | Debug | 4, 2 | ✅ Complete | Debug overlay, contributor system, stats store |
| 8 | E2E Tests + Examples | 5, 6, 7 | 🟡 Partial | 13 examples complete, E2E tests not started |
| 9 | Polish | 8 | 🟡 Partial | Meta-package done, docs/publish not started |

---

## References

- [PRD.md](./PRD.md) -- Product requirements driving this plan
- [TDD.md](./TDD.md) -- Technical design being implemented
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) -- Testing approach for each phase
- [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md) -- Plugin system guiding Phase 1 design
- [AGENT_GUIDE.md](./AGENT_GUIDE.md) -- Agent workflow for implementing phases
- [RECIPES_PLAN.md](./RECIPES_PLAN.md) -- Recipe roadmap and implementation details
