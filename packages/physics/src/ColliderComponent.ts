import {
  Component,
  devWarn,
  filterEntities,
  ErrorBoundaryKey,
  Transform,
} from "@yagejs/core";
import type {
  Entity,
  ComponentClass,
  EntityFilter,
  TraitToken,
  ErrorBoundary,
} from "@yagejs/core";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { createOneWayFilter } from "./oneWay.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { PhysicsWorldKey } from "./types.js";
import type {
  ColliderConfig,
  ColliderShape,
  CollisionEvent,
  ContactCandidate,
  ContactFilter,
  TriggerEvent,
  ColliderPartConfig,
} from "./types.js";
import { assertColliderShape, assertFiniteNumber } from "./validate.js";
import { colliderPart, colliderParts } from "./colliderParts.js";
import { scaleColliderPart } from "./colliderScale.js";

/**
 * Wraps a Rapier collider. Attach after RigidBodyComponent.
 *
 * Component ordering: Transform → RigidBodyComponent → ColliderComponent.
 */
export class ColliderComponent extends Component {
  /** Collider configuration (shape, sensor, etc.). */
  readonly config: ColliderConfig;

  /** @internal Ordered Rapier collider handles, set during onAdd. */
  readonly _colliderHandles: number[] = [];

  /** @internal First Rapier handle for single-shape access. */
  get _colliderHandle(): number {
    return this._colliderHandles[0] ?? -1;
  }

  /** @internal Active contact filter, read by PhysicsWorld's pair hook. */
  _contactFilter: ContactFilter | null = null;

  /**
   * @internal Directed Rapier-handle pairs whose contact with this one-way
   * platform has started and not yet ended. While a pair is in here the
   * platform stays solid for it regardless of the position rule — a deep
   * first-impact penetration must not flip an established landing back to
   * passable while the solver is still pushing the rider out. Maintained by
   * PhysicsWorld from collision start/end events and collider removal;
   * `null` unless the collider is configured `oneWay`.
   */
  _oneWayLanded: Set<string> | null = null;

  private readonly rb = this.sibling(RigidBodyComponent);
  private readonly transform = this.sibling(Transform);
  private physicsWorld!: PhysicsWorld;
  private errorBoundary: ErrorBoundary | undefined;
  private collisionHandlers: Array<(e: CollisionEvent) => void> = [];
  private triggerHandlers: Array<(e: TriggerEvent) => void> = [];
  private _warnedSensorMismatch = false;
  /** Simulated-time deadline (PhysicsWorld.elapsed) for drop-through. */
  private _dropThroughUntil = -1;
  /** Drop-through seconds requested before the collider existed. */
  private _pendingDropThrough = 0;
  /** True once the current filter's failure has been reported. */
  private _reportedFilterError = false;
  /** The filter `config.oneWay` installed, to tell it apart from a custom one. */
  private _oneWayFilter: ContactFilter | null = null;
  private _scaleX = 1;
  private _scaleY = 1;
  private _effectiveParts: ColliderPartConfig[];

  constructor(config: ColliderConfig) {
    super();
    const context = "ColliderComponent";
    if ("parts" in config && "shape" in config) {
      throw new Error(`${context}: provide either shape or parts, not both.`);
    }
    assertFiniteNumber(context, "restitution", config.restitution, 0);
    assertFiniteNumber(context, "friction", config.friction, 0);
    assertFiniteNumber(context, "density", config.density, 0);
    assertFiniteNumber(context, "contactSkin", config.contactSkin, 0);
    const parts = colliderParts(config);
    if (parts.length === 0) {
      throw new Error(`${context}: parts must contain at least one collider.`);
    }
    for (const part of parts) {
      assertColliderShape(context, part.shape);
    }
    this._effectiveParts = parts.map((part) =>
      scaleColliderPart(part, this._scaleX, this._scaleY),
    );
    if (config.oneWay) {
      assertFiniteNumber(context, "oneWay.margin", config.oneWay.margin);
      const direction = config.oneWay.direction;
      if (direction) {
        assertFiniteNumber(context, "oneWay.direction.x", direction.x);
        assertFiniteNumber(context, "oneWay.direction.y", direction.y);
        if (direction.x === 0 && direction.y === 0) {
          throw new Error(
            `${context}: oneWay.direction must be a non-zero vector, got {x: 0, y: 0}.`,
          );
        }
      }
    }
    this.config = config;
    if (config.oneWay) {
      this._oneWayLanded = new Set();
      this._oneWayFilter = createOneWayFilter(this);
      this._contactFilter = this._oneWayFilter;
    }
  }

  /** Number of collider shapes attached to this component's rigid body. */
  get colliderCount(): number {
    return this._effectiveParts.length;
  }

  /** @internal Geometry and placement for one ordered collider shape. */
  _part(index: number): ReturnType<typeof colliderPart> {
    return colliderPart(this.config, index);
  }

  /** @internal Scaled geometry and placement for one ordered shape. */
  _effectivePart(index: number): ColliderPartConfig {
    return this._effectiveParts[index] as ColliderPartConfig;
  }

  /** @internal Forget one handle after PhysicsWorld removes its body. */
  _detachColliderHandle(handle: number): void {
    const index = this._colliderHandles.indexOf(handle);
    if (index !== -1) this._colliderHandles.splice(index, 1);
  }

  /**
   * @internal True while the collider's active filter is still the one
   * `config.oneWay` installed — the debug overlay draws one-way visuals
   * only then, so a custom filter set over the preset isn't shown as
   * one-way.
   */
  get _oneWayFilterActive(): boolean {
    return (
      this._contactFilter !== null && this._contactFilter === this._oneWayFilter
    );
  }

  onAdd(): void {
    // Resolve before creating the Rapier collider: an optional lookup can't
    // throw, so a hand-built test context with no boundary registered still
    // leaves onAdd fully completed rather than half-done.
    this.errorBoundary = this.context.tryResolve(ErrorBoundaryKey);
    this.physicsWorld = this.use(PhysicsWorldKey);
    this._readInitialScale();

    if (this.config.oneWay && this.config.sensor) {
      devWarn(
        `ColliderComponent at ${this.entity.name}: oneWay has no effect on a ` +
          `sensor — contact filters only run for solid contact pairs.`,
      );
    }

    for (let index = 0; index < this.colliderCount; index++) {
      this._colliderHandles.push(
        this.physicsWorld.createCollider(
          this.entity,
          this.rb._bodyHandle,
          this.config,
          this,
          index,
          this._effectivePart(index),
        ),
      );
    }

    if (this._pendingDropThrough > 0) {
      this._dropThroughUntil =
        this.physicsWorld.elapsed + this._pendingDropThrough;
      this._pendingDropThrough = 0;
    }

    // A component is never effectively enabled during `onAdd` — `onEnable`
    // runs right after, and only for an active entity. Rapier creates a
    // collider enabled, so without this a collider added to a dormant entity
    // would stay in the simulation and report contacts.
    for (const handle of this._colliderHandles) {
      this.physicsWorld.getCollider(handle)?.setEnabled(false);
    }
    if (!this._scaleHasArea) {
      this.physicsWorld
        .getBody(this.rb._bodyHandle)
        ?.recomputeMassPropertiesFromColliders();
    }
  }

  /**
   * Take the collider out of the simulation, keeping its Rapier allocation.
   * Rapier does not re-emit a collision-start for a collider disabled and
   * re-enabled while still overlapping something — a reused entity dropped
   * onto an existing contact gets no `onCollision` for it.
   */
  onDisable(): void {
    for (const handle of this._colliderHandles) {
      this.physicsWorld.getCollider(handle)?.setEnabled(false);
    }
    // A pooled entity keeps its components; a drop-through window from the
    // previous life must not carry into the next one.
    this._dropThroughUntil = -1;
    this._pendingDropThrough = 0;
    // Landing state must not survive a dormancy either — neither this
    // platform's remembered riders nor any platform remembering this
    // collider. Contacts end silently on disable, so clean up here.
    this._oneWayLanded?.clear();
    for (const handle of this._colliderHandles) {
      this.physicsWorld._forgetColliderContacts(handle);
    }
    // Out of the simulation, but still in Rapier's query index until a step.
    this.physicsWorld._markQueriesStale();
  }

  onEnable(): void {
    this._syncScale();
    if (!this._scaleHasArea) return;
    for (const handle of this._colliderHandles) {
      const collider = this.physicsWorld.getCollider(handle);
      if (!collider) continue;
      collider.setEnabled(true);
    }
    // Rapier's mass re-sum skips a disabled collider, so a re-sum run while
    // this one was disabled (`setSensor`, `setShape` with `recomputeMass`)
    // sums to 0, and Rapier sums again only at the next step. Summing here
    // keeps `getMass()` correct before that step.
    this.physicsWorld
      .getBody(this.rb._bodyHandle)
      ?.recomputeMassPropertiesFromColliders();
    // Back in the simulation, but not in Rapier's query index until a step.
    this.physicsWorld._markQueriesStale();
  }

  onDestroy(): void {
    for (const handle of this._colliderHandles) {
      this.physicsWorld.removeCollider(handle);
    }
    this._colliderHandles.length = 0;
    this.collisionHandlers.length = 0;
    this.triggerHandlers.length = 0;
  }

  /** Subscribe to collision events. Returns an unsubscribe function. */
  onCollision(handler: (e: CollisionEvent) => void): () => void {
    this._warnSensorMismatch("onCollision");
    this.collisionHandlers.push(handler);
    return () => {
      const idx = this.collisionHandlers.indexOf(handler);
      if (idx !== -1) this.collisionHandlers.splice(idx, 1);
    };
  }

  /** Subscribe to trigger events (sensor). Returns an unsubscribe function. */
  onTrigger(handler: (e: TriggerEvent) => void): () => void {
    this._warnSensorMismatch("onTrigger");
    this.triggerHandlers.push(handler);
    return () => {
      const idx = this.triggerHandlers.indexOf(handler);
      if (idx !== -1) this.triggerHandlers.splice(idx, 1);
    };
  }

  private _warnSensorMismatch(handler: "onCollision" | "onTrigger"): void {
    if (this._warnedSensorMismatch) return;
    const sensor = this.config.sensor === true;
    if (sensor && handler === "onCollision") {
      this._warnedSensorMismatch = true;
      const name = this.entity?.name ?? "<unbound>";
      devWarn(
        `ColliderComponent at ${name}: sensor: true colliders fire onTrigger, ` +
          `not onCollision. Did you mean .onTrigger(...)?`,
      );
    } else if (!sensor && handler === "onTrigger") {
      this._warnedSensorMismatch = true;
      const name = this.entity?.name ?? "<unbound>";
      devWarn(
        `ColliderComponent at ${name}: solid colliders fire onCollision, ` +
          `not onTrigger. Did you mean .onCollision(...), or set sensor: true on the collider?`,
      );
    }
  }

  /**
   * After a `setSensor` flip, name the handlers of the kind the new flag
   * silences. A dead handler is a legal state (a collider whose handlers
   * should go quiet on death is one intended use), so this warns rather
   * than throws, once per flip.
   */
  private _warnSilencedHandlers(sensor: boolean): void {
    this._warnedSensorMismatch = false;
    const silenced = sensor ? this.collisionHandlers : this.triggerHandlers;
    if (silenced.length === 0) return;
    const name = this.entity?.name ?? "<unbound>";
    const count = silenced.length;
    devWarn(
      sensor
        ? `ColliderComponent at ${name}: now a sensor; its ${count} onCollision ` +
            `handler(s) will not fire. Use onTrigger, or unsubscribe them.`
        : `ColliderComponent at ${name}: now solid; its ${count} onTrigger ` +
            `handler(s) will not fire. Use onCollision, or unsubscribe them.`,
    );
  }

  /** Return all entities whose colliders currently overlap this one, optionally filtered. */
  getOverlapping<T>(
    filter: EntityFilter & { trait: TraitToken<T> },
  ): (Entity & T)[];
  getOverlapping(filter?: EntityFilter): Entity[];
  getOverlapping(filter?: EntityFilter): Entity[] {
    const entities = [
      ...new Set(
        this._colliderHandles.flatMap((handle) =>
          this.physicsWorld.queryOverlapping(handle),
        ),
      ),
    ];
    return filter ? filterEntities(entities, filter) : entities;
  }

  /** Return components of type C from all overlapping entities that have one. */
  getOverlappingComponents<C extends Component>(cls: ComponentClass<C>): C[] {
    const result: C[] = [];
    for (const entity of this.getOverlapping()) {
      const comp = entity.tryGet(cls);
      if (comp) result.push(comp);
    }
    return result;
  }

  /**
   * Make this collider a sensor, or solid again. Callable before the
   * component is added — the updated config is applied at collider creation.
   *
   * On a live collider the Rapier collider is recreated with the new flag:
   * every pair it is currently in ends with a `stop` (or `exit`) at the next
   * step and re-forms as the new kind, so a solid box flipped to a sensor
   * falls through what it was resting on. The body's `getMass()` is
   * unchanged, the contact filter and every subscription survive, and the
   * collider handle changes. A call that does not change the flag does
   * nothing. Dev builds warn when the flip leaves handlers of the silenced
   * kind (`onCollision` on a sensor, `onTrigger` on a solid) registered.
   */
  setSensor(sensor: boolean): void {
    // Event routing and the sensor-mismatch warning read config.sensor, so it
    // must track the live collider.
    if (this._colliderHandles.length === 0) {
      this.config.sensor = sensor;
      return;
    }
    if (sensor === (this.config.sensor === true)) return;
    this.config.sensor = sensor;
    for (let index = 0; index < this._colliderHandles.length; index++) {
      const handle = this._colliderHandles[index] as number;
      this._colliderHandles[index] = this.physicsWorld._replaceCollider(
        handle,
        this.entity,
        this.rb._bodyHandle,
        this.config,
        this,
        index,
        this.effectiveEnabled && this._scaleHasArea,
      );
    }
    this._warnSilencedHandlers(sensor);
  }

  /**
   * Replace the collider's shape in place, in pixels like the rest of
   * `ColliderConfig`. The Rapier collider, its body attachment, and every
   * `onCollision`/`onTrigger` subscription survive the swap, so a crouch or
   * slide can shrink the collider and restore it without removing and
   * re-adding the component.
   *
   * The body keeps the mass it already had. A collider is a collision proxy,
   * not a measure of how much matter is there, so a character that crouches
   * takes the same knockback from `applyImpulse` as one standing up. Pass
   * `recomputeMass: true` when the new shape means genuinely more or less
   * matter, and the body's mass should come back from density × the new
   * shape.
   *
   * Shrinking never pushes anything out of the way, and growing can leave the
   * collider overlapping geometry it clears at the smaller size. Check
   * clearance (`PhysicsWorld.queryShape` at the target size) before growing
   * back.
   *
   * Callable before the component is added — the updated config is applied at
   * collider creation. A pre-add call cannot recompute mass: the body takes
   * its mass from the new shape at creation anyway.
   *
   * A shape with a dimension that is not finite and above 0 throws before
   * anything is stored, so the selected config part still describes the live
   * collider.
   */
  setShape(
    shape: ColliderShape,
    options?: { index?: number; recomputeMass?: boolean },
  ): void {
    assertColliderShape("ColliderComponent.setShape", shape);
    const index = options?.index ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= this.colliderCount) {
      throw new Error(
        `ColliderComponent.setShape: index must name an existing collider shape, got ${index}.`,
      );
    }
    // Shape-dependent diagnostics read the selected authored part.
    this._part(index).shape = shape;
    this._effectiveParts[index] = this._scaleHasArea
      ? scaleColliderPart(this._part(index), this._scaleX, this._scaleY)
      : this._part(index);
    if (this._colliderHandles.length === 0) return;
    this.physicsWorld.setColliderShape(
      this._colliderHandles[index] as number,
      this.config,
      options,
      index,
      this._effectivePart(index),
    );
  }

  /**
   * Set (or clear, with `null`) this collider's contact filter — a per-pair
   * veto that decides each physics step whether a candidate contact with
   * another collider is solid (`true`) or passes through (`false`). Replaces
   * the built-in filter a `oneWay` config installed. Callable before the
   * component is added — the filter is armed at collider creation.
   *
   * The filter runs inside the physics step, so no contact normal exists
   * yet; the `ContactCandidate` exposes the two sides' positions and
   * velocities instead. The candidate is a single reused instance — read
   * what you need inside the filter and copy it; a stored reference shows
   * other pairs' values after the call returns. A filter that throws is
   * reported through the error boundary once (per installed filter) and
   * the pair stays solid.
   *
   * The component does not own a custom filter's lifetime. Reinstall it when
   * game code reconstructs the collider.
   */
  setContactFilter(filter: ContactFilter | null): void {
    this._contactFilter = filter;
    this._reportedFilterError = false;
    for (const handle of this._colliderHandles) {
      this.physicsWorld._setContactFilterEnabled(handle, filter !== null);
    }
  }

  /**
   * Let this body fall through one-way platforms for the next `seconds`
   * seconds of simulated time — the standard down-jump. Only this body is
   * affected; other bodies standing on the same platform stay supported.
   * When the window expires mid-platform, the body keeps falling until it
   * is clear and lands on the next solid side it reaches from above.
   *
   * Callable before the component is added; the window then starts when the
   * collider is created.
   */
  dropThrough(seconds: number): void {
    if (this._colliderHandles.length === 0) {
      this._pendingDropThrough = seconds;
      return;
    }
    this._dropThroughUntil = this.physicsWorld.elapsed + seconds;
    // A body that has been resting long enough is asleep, and sleeping
    // pairs are never re-filtered — wake it so the window can take effect.
    this.physicsWorld.getBody(this.rb._bodyHandle)?.wakeUp();
  }

  /** True while a `dropThrough` window is active for this collider. */
  get isDroppingThrough(): boolean {
    return (
      this._colliderHandles.length > 0 &&
      this.physicsWorld.elapsed < this._dropThroughUntil
    );
  }

  /** @internal Apply the Transform's world scale before a physics step. */
  _syncScale(): void {
    const scale = this.transform.worldScale;
    if (scale.x === this._scaleX && scale.y === this._scaleY) return;
    this._assertFiniteScale(scale.x, scale.y);

    this._scaleX = scale.x;
    this._scaleY = scale.y;
    this._rebuildEffectiveParts();
    if (this._colliderHandles.length === 0) return;

    if (!this._scaleHasArea) {
      for (const handle of this._colliderHandles) {
        this.physicsWorld.getCollider(handle)?.setEnabled(false);
        this.physicsWorld._forgetColliderContacts(handle);
      }
      this._oneWayLanded?.clear();
      this.physicsWorld
        .getBody(this.rb._bodyHandle)
        ?.recomputeMassPropertiesFromColliders();
      this.physicsWorld._markQueriesStale();
      return;
    }

    for (let index = 0; index < this._colliderHandles.length; index++) {
      this.physicsWorld.setColliderShape(
        this._colliderHandles[index] as number,
        this.config,
        { recomputeMass: true },
        index,
        this._effectivePart(index),
      );
    }
    if (this.effectiveEnabled) {
      for (const handle of this._colliderHandles) {
        this.physicsWorld.getCollider(handle)?.setEnabled(true);
      }
    }
    this.physicsWorld
      .getBody(this.rb._bodyHandle)
      ?.recomputeMassPropertiesFromColliders();
  }

  /** @internal Apply signed world scale to a body-local direction. */
  _scaleDirection(direction: { x: number; y: number }): {
    x: number;
    y: number;
  } {
    return {
      x: direction.x * this._scaleX,
      y: direction.y * this._scaleY,
    };
  }

  private get _scaleHasArea(): boolean {
    return this._scaleX !== 0 && this._scaleY !== 0;
  }

  private _readInitialScale(): void {
    const scale = this.transform.worldScale;
    this._assertFiniteScale(scale.x, scale.y);
    this._scaleX = scale.x;
    this._scaleY = scale.y;
    this._rebuildEffectiveParts();
  }

  private _rebuildEffectiveParts(): void {
    this._effectiveParts = colliderParts(this.config).map((part) =>
      this._scaleHasArea
        ? scaleColliderPart(part, this._scaleX, this._scaleY)
        : part,
    );
  }

  private _assertFiniteScale(scaleX: number, scaleY: number): void {
    if (!Number.isFinite(scaleX)) {
      throw new Error(
        `ColliderComponent: Transform.worldScale.x must be finite, got ${scaleX}.`,
      );
    }
    if (!Number.isFinite(scaleY)) {
      throw new Error(
        `ColliderComponent: Transform.worldScale.y must be finite, got ${scaleY}.`,
      );
    }
  }

  /**
   * @internal Run the contact filter for a candidate pair.
   *
   * Deliberate exception to the report-and-rethrow rule for developer
   * callbacks: this is called from inside Rapier's WASM step, and a throw
   * unwinding through WASM mid-step leaves the physics world in an
   * undefined state. The error is caught, reported through the boundary,
   * and the pair falls back to solid — the conservative default.
   *
   * Reported once per installed filter, not per throw: the filter runs for
   * every candidate pair every step, and a persistently throwing one would
   * otherwise log at frame rate and evict everything else from the error
   * snapshot. `setContactFilter` re-arms the report.
   */
  _evaluateContactFilter(contact: ContactCandidate): boolean {
    const filter = this._contactFilter;
    if (!filter) return true;
    try {
      return filter(contact);
    } catch (err) {
      if (this._reportedFilterError) return true;
      this._reportedFilterError = true;
      const sceneName = this.entity?.tryScene?.name;
      this.errorBoundary?.reportLifecycleError(err, {
        kind: "Contact filter",
        entity: this.entity?.name,
        ...(sceneName !== undefined ? { scene: sceneName } : {}),
      });
      return true;
    }
  }

  /**
   * @internal Called by PhysicsWorld during event dispatch.
   */
  _dispatchCollision(event: CollisionEvent): void {
    this._dispatch(
      this.collisionHandlers,
      (h) => h(event),
      "Collision handler",
    );
  }

  /**
   * @internal Called by PhysicsWorld during event dispatch.
   */
  _dispatchTrigger(event: TriggerEvent): void {
    this._dispatch(this.triggerHandlers, (h) => h(event), "Trigger handler");
  }

  /** Shared dispatch for collision/trigger handlers. */
  private _dispatch<H>(
    live: H[],
    invoke: (handler: H) => void,
    kind: string,
  ): void {
    // Events are drained after each step, so a collider disabled between the
    // step and the delivery can still have queued events naming it. A
    // dormant entity must not see them.
    if (this.entity?.isActive === false) return;
    const sceneName = this.entity?.tryScene?.name;
    // Copy the handlers: `onCollision`/`onTrigger` hand back an unsubscribe that
    // splices this array, so a handler removing itself mid-dispatch would
    // otherwise shift the next one past the iterator.
    for (const handler of [...live]) {
      if (this.errorBoundary) {
        this.errorBoundary.wrapCallback(() => invoke(handler), {
          kind,
          entity: this.entity?.name,
          ...(sceneName !== undefined ? { scene: sceneName } : {}),
        });
      } else {
        invoke(handler);
      }
    }
  }
}
