# YAGE v2 -- Product Requirements Document

## Vision & Mission

**YAGE** (Yet Another Game Engine) is a lightweight, modular, TypeScript-first 2D game engine for the browser. It favors composition over inheritance, developer ergonomics over raw flexibility, and doing common things easily over supporting every possible use case.

**v2 Mission**: Rewrite YAGE from scratch to deliver a best-in-class DX for solo and indie developers building 2D browser games. Preserve v1's spirit -- small, hackable, TS-native -- while eliminating every pain point, filling every feature gap, and upgrading to modern dependencies.

### Guiding Principles

1. **DX-first**: The API should feel obvious. Common operations should be short. Boilerplate is a bug.
2. **Modular by default**: The core is tiny. Every feature (physics, audio, particles) is an opt-in plugin. You don't pay for what you don't use.
3. **TypeScript-native**: Full type safety, autocompletion, and zero `any` in the public API. Types are documentation.
4. **Composition over inheritance**: Entities are bags of components. Systems drive behavior. Class hierarchies stay shallow.
5. **Test-friendly**: The engine exposes first-class inspection and structured logging APIs. Games are testable with Playwright out of the box.

---

## Target Audience

### Primary: Solo & Indie Developers

- Working alone or in teams of 1-3
- Comfortable with TypeScript/JavaScript
- Building 2D games: platformers, top-down RPGs, puzzle games, shmups, visual novels, game jam entries
- Value fast iteration over engine-level customization
- Want to ship to the browser (itch.io, Newgrounds, own site)

### Secondary: Game Jam Participants

- Need to go from zero to playable in hours
- Require a minimal learning curve
- Benefit from built-in primitives (physics, input, audio, UI) that just work

### Non-Audience

- AAA / large studio teams (use Unity, Godot, Unreal)
- 3D game developers
- Server-side game logic authors
- Developers who need a visual editor as a primary workflow

---

## Feature Matrix

### P0 -- Launch (v2.0)

| Feature | Description |
|---|---|
| **Core ECS** | Engine, EngineContext (DI), Entity, Component, System, SystemScheduler, QueryCache |
| **Game Loop** | PixiJS v8 Ticker-driven, deterministic phases (earlyUpdate > fixedUpdate > update > lateUpdate > render > endOfFrame), fixed timestep with accumulator |
| **Scene Management** | Scene stack with push/pop/replace, overlay support, pause-below semantics, asset manifests, lifecycle hooks |
| **Rendering** | PixiJS v8 integration: SpriteComponent, GraphicsComponent, AnimatedSpriteComponent, render layers, virtual resolution |
| **Camera** | Follow target, deadzone, zoom, shake, bounds clamping |
| **Physics** | Rapier2D wrapper: RigidBodyComponent, ColliderComponent (separated), collision layers/masks, event routing, internal pixel-to-meter conversion, interpolation |
| **Input** | Keyboard, mouse, touch, gamepad. Action map system (plain objects). Axis/vector queries. Configurable preventDefault |
| **Audio** | AudioManager with channels (sfx, music, ambient). SoundComponent for entity-bound audio. Per-channel volume/mute |
| **Prefabs** | Declarative entity templates with builder pattern. Spawn from template with overrides |
| **Process/Tween** | Coroutine system with tween, sequence, parallel, delay. Chainable API. Promise interop |
| **EventBus** | Typed pub/sub. Returns unsubscribe function. No DOM dependency |
| **Error Boundaries** | Wraps system/component execution. Disables offending components. Game loop never crashes |
| **Inspector API** | Programmatic state queries: `snapshot()`, `getEntityByName()`, `getEntityPosition()`, `hasComponent()`, `getComponentData()`. Exposed on `window.__yage__` in debug mode |
| **Structured Logging** | Logger with levels, categories, ring buffer, JSON-friendly format. `formatRecentLogs()` for agent consumption |
| **Debug Overlay** | Physics shapes, entity labels, FPS/entity count, system timing |
| **Math Utilities** | Vec2 (immutable value type), Transform, MathUtils (lerp, clamp, remap, random range) |

### P1 -- Fast-Follow (v2.1-v2.3)

| Feature | Description |
|---|---|
| **Tilemap / Tiled Support** | Load Tiled JSON maps, render tile layers, extract collision shapes from object layers |
| **Particle System** | GPU-friendly particle emitter with common presets (fire, smoke, sparks, rain) |
| **UI Layout System** | Flexbox-inspired layout with anchoring, text, buttons, panels. Responsive to virtual resolution |
| **Camera Effects** | Smooth follow algorithms, screen transitions (fade, wipe, iris), letterboxing |
| **Animation Controller** | State machine for sprite animations (idle > walk > jump) with transition conditions |
| **Object Pooling** | Integrated pool with prefab system. Auto-recycle for bullets, particles, etc. |

### P2 -- Future (v2.x+)

| Feature | Description |
|---|---|
| **Pathfinding** | A* / navmesh with obstacle avoidance |
| **Networking Primitives** | Client-server state sync, authoritative server hooks, lobby/room management |
| **Serialization / Save-Load** | Entity and scene state serialization to JSON. Snapshot/restore for undo and persistence |
| **Visual Editor** | Browser-based scene editor with drag-and-drop entity placement, component inspector, live preview |
| **Sprite Packing** | Build-time texture atlas generation from loose sprites |

---

## Non-Goals

These are explicitly out of scope for v2.0 and have no planned timeline:

1. **3D rendering or 3D physics**: YAGE is a 2D engine. Use Three.js, Babylon.js, or PlayCanvas for 3D.
2. **Server-side game logic**: YAGE runs in the browser. Server sync is a future primitive, not a core feature.
3. **Visual editor at launch**: v2.0 is code-first. A visual editor is P2.
4. **Mobile native builds**: Browser only. PWA is the deployment model for mobile.
5. **Backward compatibility with v1**: v2 is a clean break. A migration guide will be provided, but v1 API shapes are not preserved.
6. **Framework lock-in avoidance**: We commit to PixiJS v8 for rendering and Rapier2D for physics. These are hard dependencies of their respective plugins, not abstractable backends.

---

## Success Criteria

### Ergonomics

- **Bouncing ball in <10 lines**: A complete physics-enabled bouncing ball demo should require fewer than 10 lines of user code (excluding imports).
- **Zero mandatory dependencies beyond core**: `@yage/core` has zero runtime dependencies. Physics, audio, and rendering are opt-in plugins.
- **No `pu()` in user code**: Physics coordinate conversion is internal. Users work in pixels everywhere.
- **No Map for input bindings**: Action maps are plain objects: `{ jump: ['Space', 'KeyW'] }`.
- **No mandatory physics**: A rendering-only game never downloads Rapier WASM.

### Quality

- **100% unit test coverage on `@yage/core`**: Every public API path is tested.
- **Playwright integration tests**: At least one E2E test per plugin verifying real browser behavior.
- **Zero `any` in public API**: Full type inference from `engine.create()` to `entity.get(SpriteComponent)`.
- **Error resilience**: A thrown exception in any user component never crashes the game loop.

### Performance

- **60 FPS with 1000 entities**: Core loop overhead (excluding rendering and physics) under 2ms per frame with 1000 active entities.
- **O(1) component lookup**: `entity.get(ComponentClass)` is a Map lookup, not a linear scan.
- **Incremental query cache**: System queries update on archetype changes only, not per frame.

---

## Competitive Landscape

| Engine | Strengths | YAGE v2 Differentiator |
|---|---|---|
| **Phaser 3/4** | Massive ecosystem, huge community, mature | YAGE is TypeScript-first (Phaser is JS-first), modular (Phaser is monolithic), and has proper ECS (Phaser uses scene-level containers). YAGE's testing story is first-class. |
| **Excalibur.js** | TypeScript-native, good DX, actor model | YAGE offers a hybrid ECS (not pure actor model), optional physics (Excalibur bundles its own), and Rapier2D for high-performance simulation. |
| **PlayCanvas (2D)** | Powerful editor, WebGPU-ready | YAGE is code-first (no editor dependency), lighter weight, and focused purely on 2D. PlayCanvas is primarily a 3D engine. |
| **Kaboom.js/Kaplay** | Incredible simplicity, game-jam friendly | YAGE offers more structure for larger projects while matching Kaboom's simplicity for small ones. Proper scene management, prefabs, and type safety. |
| **LittleJS** | Ultra-lightweight, zero dependencies | YAGE offers more features (physics, ECS, plugins) while remaining modular. LittleJS is intentionally minimal. |

YAGE v2's positioning: **The TypeScript-native engine for solo devs who want Phaser's features without Phaser's baggage, with an ECS that stays out of your way and a testing story that AI agents can actually use.**

---

## References

- [PAIN_POINTS.md](../../PAIN_POINTS.md) -- Complete catalog of v1 issues driving v2 design
- [TDD.md](./TDD.md) -- Technical Design Document with full architecture and API sketches
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) -- Phased build roadmap
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) -- Testing and debugging approach
- [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md) -- Plugin system specification
- [AGENT_GUIDE.md](./AGENT_GUIDE.md) -- AI agent development guide
