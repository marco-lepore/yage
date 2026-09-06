# YAGE Architecture

This document states the constraints that changes to YAGE must preserve and
why they matter. For package layout and modification steps, use the
[agent development guide](./AGENT_GUIDE.md). For plugin authoring, use
[Engine and plugins](./src/content/docs/concepts/engine-and-plugins.mdx).
Public API signatures live in the [core reference](./llms/packages/core.md).

## Package boundaries

Core has zero runtime dependencies. It owns the ECS, scene lifecycle,
scheduler, service container, state primitives and diagnostics contracts.
Rendering and physics remain optional so a headless game or test does not
load PixiJS or Rapier.

An optional integration belongs in an explicit entry point. For example,
`@yagejs/tilemap/physics` depends on physics; the tilemap root does not.
Addon model entries must remain usable without their rendering adapters.
Check built imports as well as source imports: a barrel can introduce a
runtime dependency through a re-export.

Public rendering signatures use the renderer's aliases, such as
`DisplayContainer`, `GraphicsContext` and `ColorValue`. Implementations
may construct PixiJS objects directly. The aliases make the types discoverable
without requiring consumers to import PixiJS; they are not an encapsulation
boundary.

## Ownership and shared mechanisms

Components own game logic. Systems implement cross-entity engine work with
explicit scheduler ordering. An entity's `setup()` runs after attachment;
component constructors accept configuration, while `onAdd()` can resolve
scene services.

Extend the mechanism that already owns an invariant. Do not maintain a
parallel registry for entity participation, a second camera projection, or
another clock counter. Two mechanisms that derive the same fact can disagree
at activation, removal or teardown.

The creator of a resource owns its release, or explicitly transfers that
ownership. Apply this to subscriptions, renderer objects, asset references
and diagnostic leases. Ownership follows the resource's actual lifetime,
not whichever callback is most convenient.

### Services are infrastructure, not game state

Plugins register infrastructure through `ServiceKey<T>`. Engine services
live in the engine container; per-scene services such as `PhysicsWorldKey`
and `SceneRenderTreeKey` live in the scene container. Scene setup installs
those services before `onEnter()`; exit disposes the scene resources.
Do not retain a resolved scene service across scene entries.

A service key's id string is its identity. Re-declaring the same id is valid
only for the same contract when avoiding an optional runtime dependency.
Name the owning package in a nearby comment. Optional debug integration
uses this rule without making debug a runtime dependency.

Game-owned score, inventory and quest state are explicit model references
or entity components, not self-registered services. Construct a shared
state root once and pass it to each consumer. This makes ownership visible
and permits independent games and scenes in the same process.

Plugins declare their required dependencies and expose the required
`name` and `version` fields. Register each engine service once, from its
owning plugin. A missing required plugin is not an optional capability to
silently replace.

## Entity and component lifetime

Use `entity.isActive` for simulation participation. It includes ancestor
activity and excludes destroyed entities. Use `component.effectiveEnabled`
when component participation matters: it also includes attachment and the
component's own enabled flag. Queries maintain active membership; a raw
entity collection can also contain dormant entities.

Ordinary entity destruction deactivates immediately. The end-of-frame flush
frees resources; it is not the point at which simulation stops.
`isDestroyed` answers whether the entity has been destroyed, not whether it
should update.

Pool release ends the current lease, detaches the entity and cancels its
scheduled processes. It keeps inert state, such as position, health and
animation frame, for `onAcquire()` to initialize. Ordinary deactivation
pauses processes; it is not pool release.

`onDisable()` is reversible sleep. `onDestroy()` is terminal cleanup.
Removing a component destroys that instance; it cannot be moved to another
entity. Component uniqueness is per exact class. Base-class lookup and
queries include subclasses; use `getAll()` when several matches are valid,
because a singular ambiguous lookup throws.

## Time and scheduler ordering

Simulation advances through supplied delta time, `SceneTime`, and
processes. Wall-clock timers do not respect scene pause, time scaling or
deterministic stepping. Reserve wall time for infrastructure such as host
frame scheduling, profiling and external IO deadlines.

Scene `elapsed` and `fixedElapsed` measure different update streams.
Compare timestamps from the same clock; neither reading is a universal
replacement for the other. Entity time scale affects component updates,
not the scene clock readings. Component update delta time is already scaled;
do not multiply by the same scene or entity scale again. A body's entity
scale does not independently scale the shared physics world.

The canonical [frame-order table](./llms/packages/core.md#frame-order)
defines phases, priorities, tie ordering and runtime registration behavior.
Use it when adding a system; do not copy its inventory into another table.
The human [game-loop guide](./src/content/docs/concepts/game-loop.mdx)
explains the same ordering for game authors.

`GameLoop.frameCount` is the frame identity for the Inspector, logs and
events. `Inspector.time` owns public clock control. Drivers acquire an
`InspectorTimeLease` and use it for every mutation until release.
Async stepping holds ownership for the whole operation. The internal debug
clock implements control; it is not a second public driver API or frame
counter.

## Events and subscriptions

An event token's name is its channel identity. Define tokens once with an
owning game or package prefix. Repeating a name joins the same channel and
warns in development; it does not create an isolated token.

A component owns the subscriptions it takes. Use `listen()`,
`listenScene()` and `listenBus()`, or register another API's unsubscribe
function with `addCleanup()`. A destroyed consumer must not remain
subscribed to a longer-lived scene, bus or model.

New token dispatch paths notify the scene's token observer, as
`Entity.emit()` and `Scene.emit()` do, so Inspector event history includes
game-visible dispatch. Developer callbacks still need error attribution.
Events can announce a state change; they do not justify a second mutable
copy of that state in the UI.

## Coordinates, vectors and rendering

Public coordinates, distances and velocities use pixels. `PhysicsWorld`
alone converts to and from Rapier's units. Conversion in a component or game
recipe risks applying the scale twice.

`Vec2` values are immutable, including vectors returned by `Transform`.
A mutable `Transform` can replace its state without changing a snapshot
already returned to a caller. Repeated calculations may use explicit
`Into` methods and a caller-owned `Vec2Buffer`. Never return shared
internal scratch as a public value or use a `Vec2` as an output buffer.

Use `SceneRenderTree.ensureLayer()` to provision a shared layer. An
existing game-defined layer is authoritative; addons do not replace its
settings. The [addon layer rules](../packages/addons/AGENTS.md#default-render-layer-orders)
own the default order bands.

Camera transforms apply to layers, not the scene root that carries viewport
fit and letterboxing. Rendering, lighting and debug drawing use the shared
camera projection. Pooled debug graphics must leave a scene's layer before
that layer is destroyed, because the pool outlives the scene.

## Physics ownership

A collider component owns an ordered set of collider parts. A sensor change
recreates the underlying colliders; callers must not cache their handles.
`PhysicsWorld` owns body and collider lookup, including the component and
part associated with a handle and retired ownership needed for queued stop
events. Resolve only handles the world issued and still holds; do not look
up arbitrary numbers through Rapier.

Material, damping and shape changes update configuration and live objects
through their owning APIs. Validate authored physics inputs at their public
entry through the shared physics validation functions. Internal builders
consume the validated values.

Collect and deliver collision transitions per physics step, not after a
batch of steps. Otherwise intermediate transitions disappear. Pooled lease
identity must prevent a contact from reaching a different use of the same
entity.

A spatial query reflects live colliders even before the next simulation
step. The world's zero-duration refresh owns this synchronization, including
preserving pending kinematic targets. Do not add a second query cache.
Solid casts can hit the body containing their origin; exclude the casting
body when that is not the intended result.

Physics writes an active dynamic body's `Transform`. Dormant transform
writes teleport dynamic and kinematic bodies on enable. Move a static body
through its rigid body's `setPosition()`, which also writes the transform.

Rounded-box mass uses the rounded footprint area
`width * height - (4 - Math.PI) * radius * radius` at the configured
density. Density compensation corrects Rapier's inner-rectangle mass.
Angular inertia remains the inner rectangle's inertia scaled by that
compensation, not an exact rounded-footprint calculation.

## Assets and durable state

An asset reference is counted by its type and path. `loadAll()` acquires
each distinct entry only after the whole call succeeds; a failed call takes
no references. Scene preloading has one manifest acquisition, which scene
entry claims instead of loading it twice.

Manifest acquisition does not imply automatic unloading on scene exit.
The game may retain assets for reuse or release the acquired handles
explicitly. An unused preload remains retained until released or the asset
manager is cleared. Do not add another manifest owner beside
`SceneManager.preload()`.

A loader owns any nested handles it acquires. Derived renderer resources
need an owner too: tilemap frame textures belong to the component that
creates and destroys them, not an unowned global sub-texture cache.

Persist only explicit `Serializable<TEncoded>` roots, including the core
state factories. Restore durable facts before reconstructing scene,
component, UI and plugin resources. ECS objects, callbacks and renderer or
Rapier objects are not traversed automatically.

Addon persistence must use the domain's shipped snapshot and restore APIs.
For dialogue, saved variables do not restore an active dialogue cursor.
Do not promise cursor continuation through variable storage alone.

## Errors and numeric inputs

Attribute developer callbacks through `ErrorBoundary.wrapCallback`,
system and component updates through their dedicated wrappers, and scene
hooks through `wrapLifecycleHook`. The boundary records the culprit,
logs the error and rethrows synchronous failures. Attribution does not
disable or unsubscribe the offender.

An unhandled frame error stops the game loop. A throwing hook aborts its
engine-owned sequence; later teardown or event handlers do not run.
Do not add recovery collectors, rollback or `finally` blocks to complete
a failed sequence. The [error-handling model](./AGENT_GUIDE.md#10-error-handling-model)
documents async reporting and the two explicit exceptions:
`Engine.destroy()` and plugin `afterExit` hooks.

Predictable authored failures should name the invalid input at the entry,
before mutation. Numeric behavior depends on the boundary:

- A game-supplied non-finite number entering simulation state throws at the
  write site with the context, constraint and offending value.
- Two documented-legal inputs that produce a non-finite result get a defined
  result. Emit a one-shot `devWarn` only if that result discards requested
  behavior.
- A non-finite argument to a read-only query remains unguarded and its result
  is documented as undefined.

`devWarn` is exported from core for engine packages. Browser builds require
a bundler that replaces bare `process.env.NODE_ENV`; unbundled browser
imports are not supported.
