import RAPIER from "@dimforge/rapier2d";
import { devWarn, Vec2 } from "@yagejs/core";
import type { Entity, Vec2Like } from "@yagejs/core";
import { CollisionLayers } from "./CollisionLayers.js";
import {
  colliderRotation,
  getBoxColliderGeometry,
} from "./colliderGeometry.js";
import type {
  PhysicsConfig,
  RigidBodyConfig,
  ColliderConfig,
  ColliderPartConfig,
  ColliderShape,
  BodyType,
  RaycastHit,
  JointConfig,
  JointHandle,
  QuerySensorMode,
} from "./types.js";
import type { ColliderComponent } from "./ColliderComponent.js";
import type { RigidBodyComponent } from "./RigidBodyComponent.js";
import { MutableContactCandidate } from "./ContactCandidate.js";
import type { PreStepColliderState } from "./ContactCandidate.js";
import {
  assertColliderShape,
  assertFiniteNumber,
  assertPixelsPerMeter,
  assertPositiveNumber,
} from "./validate.js";
import { colliderPairKey, colliderPart } from "./colliderParts.js";

const DEFAULT_PIXELS_PER_METER = 50;
const DEFAULT_GRAVITY_X = 0;
const DEFAULT_GRAVITY_Y = 980; // pixels/s²

function flattenVertices(
  vertices: ReadonlyArray<Vec2Like>,
  transform: (v: number) => number,
): Float32Array {
  const flat = new Float32Array(vertices.length * 2);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i] as Vec2Like;
    flat[i * 2] = transform(v.x);
    flat[i * 2 + 1] = transform(v.y);
  }
  return flat;
}

/** Contact data shared by both sides of a started, non-sensor pair. */
interface ContactData {
  normal: Vec2;
  point: Vec2;
  penetrationDepth: number;
  impulse: number;
  impulseVector: Vec2;
}

/** One side of a drained collision, pinned to the life it was queued for. */
interface CollisionSide {
  readonly handle: number;
  readonly shapeIndex: number;
  readonly entity: Entity;
  readonly collider: ColliderComponent;
  readonly life: number;
}

/** A drained collision, captured before any handler runs. */
interface CollisionPair {
  readonly first: CollisionSide;
  readonly second: CollisionSide;
  readonly started: boolean;
  readonly contact: ContactData | undefined;
}

interface JointRecord {
  readonly rawHandle: number;
  readonly bodyA: number;
  readonly bodyB: number;
  attached: boolean;
}

class PhysicsJointHandle implements JointHandle {
  constructor(
    private readonly world: PhysicsWorld,
    private readonly record: JointRecord,
  ) {}

  get attached(): boolean {
    return this.record.attached;
  }

  remove(): void {
    this.world._removeJoint(this.record);
  }
}

/**
 * Central Rapier2D wrapper. All public API values are in pixels.
 * Pixel-to-meter conversion is handled internally.
 */
export class PhysicsWorld {
  /** Pixels per meter conversion factor. */
  readonly pixelsPerMeter: number;

  /** Map from Rapier body handle to Entity. */
  readonly bodyMap = new Map<number, Entity>();
  /** Map from Rapier collider handle to Entity. */
  readonly colliderMap = new Map<number, Entity>();

  /** @internal Map from collider handle to ColliderComponent. */
  readonly _colliderComponents = new Map<number, ColliderComponent>();
  /** @internal Map from collider handle to its component shape index. */
  readonly _colliderShapeIndices = new Map<number, number>();
  /** @internal Joint records indexed by each attached body handle. */
  readonly _jointsByBody = new Map<number, Set<JointRecord>>();

  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  /** Collider handle → its layer signature, so removal can decrement it. */
  private readonly _layerInfo = new Map<
    number,
    { layers: number; mask: number }
  >();
  /**
   * Live colliders grouped by `${layers}:${mask}`, so the asymmetric-mask
   * check compares a new collider against each distinct signature instead
   * of every collider. `entityName` is the first entity that used it.
   */
  private readonly _layerSignatures = new Map<
    string,
    { layers: number; mask: number; entityName: string; count: number }
  >();
  private readonly _warnedAsymmetricPairs = new Set<string>();
  private _elapsed = 0;
  /**
   * True when a collider was created, re-shaped, enabled, disabled or
   * teleported since the last step. Rapier's query index is rebuilt only by
   * a step, so a query while this is set first runs a zero-duration one.
   */
  private _queriesStale = false;
  /** Handles of colliders with an active contact filter. */
  private readonly _contactFiltered = new Set<number>();
  /** Collider handle → parent body handle, for pre-step velocity capture. */
  private readonly _colliderBody = new Map<number, number>();
  /** Pre-step snapshot per collider; see PreStepColliderState. */
  private readonly _preStepStates = new Map<number, PreStepColliderState>();
  private readonly _candidate = new MutableContactCandidate();
  private readonly _hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (c1, c2) => this._filterContactPair(c1, c2),
    filterIntersectionPair: () => true,
  };
  /** Pairs collected by `step()` and not yet delivered. */
  private _pendingPairs: CollisionPair[] = [];
  /**
   * Sides of colliders `_replaceCollider` removed since the last step, so
   * the `stop` Rapier queues for their pairs at that step still resolves
   * to the component that owned them.
   */
  private readonly _retiredColliders = new Map<number, CollisionSide>();

  constructor(config?: PhysicsConfig) {
    assertPixelsPerMeter("PhysicsWorld", config?.pixelsPerMeter);
    assertFiniteNumber("PhysicsWorld", "gravity.x", config?.gravity?.x);
    assertFiniteNumber("PhysicsWorld", "gravity.y", config?.gravity?.y);
    this.pixelsPerMeter = config?.pixelsPerMeter ?? DEFAULT_PIXELS_PER_METER;
    const gx = config?.gravity?.x ?? DEFAULT_GRAVITY_X;
    const gy = config?.gravity?.y ?? DEFAULT_GRAVITY_Y;
    this.world = new RAPIER.World({
      x: this.toMeters(gx),
      y: this.toMeters(gy),
    });
    // Auto-drain would discard events left from an earlier step; every
    // step drains its own events right after it, so auto-drain never has
    // anything to discard.
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  /** Convert pixels to meters. */
  toMeters(pixels: number): number {
    return pixels / this.pixelsPerMeter;
  }

  /** Convert meters to pixels. */
  toPixels(meters: number): number {
    return meters * this.pixelsPerMeter;
  }

  /**
   * Total simulated time in seconds — the sum of every step's dt. Tracks
   * the simulation, not the wall clock, so it respects pause and timeScale.
   */
  get elapsed(): number {
    return this._elapsed;
  }

  /**
   * Step the physics simulation by `dt` seconds and queue the step's
   * collision events, each captured with that step's contact data.
   * `processCollisionEvents()` delivers them; a caller that steps directly
   * must call it, or the queued pairs accumulate.
   *
   * `dt` must be finite and >= 0. A zero-duration step moves nothing and
   * advances no simulated time; it rebuilds Rapier's query index, which is
   * what the spatial queries use it for.
   */
  step(dt: number): void {
    assertFiniteNumber("PhysicsWorld.step", "dt", dt, 0);
    this.world.timestep = dt;
    // Hooks are passed only while a contact filter exists: Rapier consults
    // them per candidate pair, and a world with no filters should step
    // exactly as before the feature.
    const useHooks = this._contactFiltered.size > 0;
    if (useHooks) {
      this._capturePreStepState();
    }
    this.world.step(this.eventQueue, useHooks ? this._hooks : undefined);
    this._queriesStale = false;
    // Advanced after the step: to a contact filter running inside it,
    // `elapsed` is the time at the start of the step — matching the
    // pre-step position snapshot, and giving `dropThrough(seconds)` its
    // full window (a one-timestep request covers exactly one step).
    this._elapsed += dt;
    this._collectCollisionEvents();
    // A removed collider's pairs end at the step after the removal, so
    // that step's drain is the last one that can name it.
    this._retiredColliders.clear();
  }

  /**
   * Snapshot every collider's position/rotation and its body's velocity
   * into plain objects. Contact filters run while the WASM world is
   * mutably borrowed — a Rapier wrapper call from inside a filter throws
   * an aliasing error — so this snapshot is the only state they can read.
   * Entries are allocated with the collider and mutated in place here.
   */
  private _capturePreStepState(): void {
    for (const [handle, state] of this._preStepStates) {
      const collider = this.getCollider(handle);
      if (!collider) continue;
      const t = collider.translation();
      state.x = this.toPixels(t.x);
      state.y = this.toPixels(t.y);
      state.rotation = collider.rotation();
      const bodyHandle = this._colliderBody.get(handle);
      const body =
        bodyHandle !== undefined ? this.getBody(bodyHandle) : undefined;
      if (body) {
        const v = body.linvel();
        state.vx = this.toPixels(v.x);
        state.vy = this.toPixels(v.y);
      } else {
        state.vx = 0;
        state.vy = 0;
      }
    }
  }

  /**
   * Contact-pair hook: a pair is solid only if every registered contact
   * filter on its two colliders says so. Both filters run even when the
   * first vetoes — which side Rapier passes first is its handle order, and
   * a filter keeping per-step bookkeeping must see every pair. Runs inside
   * the WASM step, so filter exceptions must not unwind through here — the
   * component's `_evaluateContactFilter` catches, reports, and falls back
   * to solid.
   */
  private _filterContactPair(
    collider1: number,
    collider2: number,
  ): RAPIER.SolverFlags | null {
    const solid1 = this._filterSide(collider1, collider2);
    const solid2 = this._filterSide(collider2, collider1);
    return solid1 && solid2 ? RAPIER.SolverFlags.COMPUTE_IMPULSE : null;
  }

  /** Evaluate one collider's filter against the other side of the pair. */
  private _filterSide(selfHandle: number, otherHandle: number): boolean {
    const selfComponent = this._colliderComponents.get(selfHandle);
    if (!selfComponent?._contactFilter) return true;

    const otherComponent = this._colliderComponents.get(otherHandle);
    const selfShapeIndex = this._colliderShapeIndices.get(selfHandle);
    const otherShapeIndex = this._colliderShapeIndices.get(otherHandle);
    const otherEntity = this.colliderMap.get(otherHandle);
    const selfState = this._preStepStates.get(selfHandle);
    const otherState = this._preStepStates.get(otherHandle);
    if (
      !otherComponent ||
      !otherEntity ||
      selfShapeIndex === undefined ||
      otherShapeIndex === undefined ||
      !selfState ||
      !otherState
    ) {
      return true;
    }

    this._candidate._set(
      selfState,
      otherState,
      otherEntity,
      otherComponent,
      selfShapeIndex,
      otherShapeIndex,
      this.world.timestep,
    );
    return selfComponent._evaluateContactFilter(this._candidate);
  }

  /**
   * @internal Toggle contact filtering for a live collider — flips Rapier's
   * hook flag and the set that decides whether `step` passes hooks at all.
   */
  _setContactFilterEnabled(handle: number, enabled: boolean): void {
    const collider = this.getCollider(handle);
    if (!collider) return;
    collider.setActiveHooks(
      enabled
        ? RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS
        : RAPIER.ActiveHooks.NONE,
    );
    if (enabled) {
      this._contactFiltered.add(handle);
    } else {
      this._contactFiltered.delete(handle);
    }
  }

  /**
   * Deliver the collision events `step()` queued, plus anything still in
   * Rapier's queue, to their `ColliderComponent`s. Every step's events are
   * delivered, in order, each with the contact data of its own step.
   *
   * Collecting and dispatching are separate passes. A handler can retire an
   * entity, and a pooled one goes straight back out of its pool as something
   * else, so both sides of every pair are captured with the life they were
   * queued for before any handler runs. Each side is re-checked immediately
   * before its own callback: the first handler can retire the second side's
   * receiver. A pair naming a life that has ended, or a collider that was
   * removed mid-drain, is dropped rather than delivered against the changed
   * state.
   */
  processCollisionEvents(): void {
    // After a step Rapier's queue is already empty. This collect keeps a
    // queue filled without a step deliverable, as the mock-based tests do.
    this._collectCollisionEvents();
    const pairs = this._pendingPairs;
    this._pendingPairs = [];

    for (const pair of pairs) {
      // The normal points from the first collider toward the second, so the
      // second side gets it negated.
      this._dispatchSide(pair, pair.first, pair.second, false);
      this._dispatchSide(pair, pair.second, pair.first, true);
    }
  }

  /**
   * Drain Rapier's queue into the pending buffer, extracting contact data
   * while the narrow phase still holds this step's manifolds and no handler
   * has touched the world.
   */
  private _collectCollisionEvents(): void {
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const first = this._resolveSide(handle1);
      const second = this._resolveSide(handle2);
      if (!first || !second) return;
      const comp1 = first.collider;
      const comp2 = second.collider;

      // A one-way platform stays solid for a rider whose contact it holds,
      // whatever the position rule says — the landed set is kept from these
      // events so a deep first-impact penetration can't flip the pair back
      // to passable while the solver is still pushing the rider out.
      if (started) {
        comp1._oneWayLanded?.add(colliderPairKey(handle1, handle2));
        comp2._oneWayLanded?.add(colliderPairKey(handle2, handle1));
      } else {
        comp1._oneWayLanded?.delete(colliderPairKey(handle1, handle2));
        comp2._oneWayLanded?.delete(colliderPairKey(handle2, handle1));
      }

      const needsContact =
        started && (!comp1.config.sensor || !comp2.config.sensor);
      const contact = needsContact
        ? this._extractContact(handle1, handle2)
        : undefined;

      this._pendingPairs.push({ first, second, started, contact });
    });
  }

  /**
   * The side a queued handle names: a registered collider, or one
   * `_replaceCollider` retired since the last step, whose closing `stop`
   * still belongs to the component now living under a new handle.
   */
  private _resolveSide(handle: number): CollisionSide | undefined {
    const collider = this._colliderComponents.get(handle);
    const entity = this.colliderMap.get(handle);
    if (collider && entity) {
      const shapeIndex = this._colliderShapeIndices.get(handle);
      if (shapeIndex === undefined) return undefined;
      return {
        handle,
        shapeIndex,
        entity,
        collider,
        life: entity.generation,
      };
    }
    return this._retiredColliders.get(handle);
  }

  /**
   * Is this side still what the event was queued for — the component still
   * registered here, the entity still living that life? A handler earlier
   * in the dispatch can remove a collider or retire an entity; events still
   * queued against the old state are dropped rather than delivered. A
   * component whose collider was replaced is still registered, under the
   * handle it holds now.
   */
  private _sideStillLive(side: CollisionSide): boolean {
    const registered =
      this._colliderComponents.get(side.handle) === side.collider ||
      side.collider._colliderHandles.some(
        (handle) => this._colliderComponents.get(handle) === side.collider,
      );
    return (
      registered &&
      !side.entity.isDestroyed &&
      side.entity.generation === side.life
    );
  }

  /** Deliver one side of a drained pair, unless either side has since ended. */
  private _dispatchSide(
    pair: CollisionPair,
    self: CollisionSide,
    other: CollisionSide,
    flipNormal: boolean,
  ): void {
    if (!this._sideStillLive(self) || !this._sideStillLive(other)) return;

    if (self.collider.config.sensor) {
      self.collider._dispatchTrigger({
        other: other.entity,
        otherCollider: other.collider,
        selfShapeIndex: self.shapeIndex,
        otherShapeIndex: other.shapeIndex,
        entered: pair.started,
      });
      return;
    }

    const contact = pair.contact;
    self.collider._dispatchCollision({
      other: other.entity,
      otherCollider: other.collider,
      selfShapeIndex: self.shapeIndex,
      otherShapeIndex: other.shapeIndex,
      started: pair.started,
      ...(contact
        ? {
            contactNormal: flipNormal
              ? contact.normal.scale(-1)
              : contact.normal,
            contactPoint: contact.point,
            penetrationDepth: contact.penetrationDepth,
            contactImpulse: contact.impulse,
            contactImpulseVector: flipNormal
              ? contact.impulseVector.scale(-1)
              : contact.impulseVector,
          }
        : {}),
    });
  }

  /**
   * Extract contact data for a started, non-sensor collision pair. Geometry
   * (normal, point, depth) comes from the solver contact with the most
   * negative solver contact distance across every manifold in the pair.
   * Rapier orders a pair's manifolds by approach direction, so taking the
   * first would report an arbitrary one of the surfaces touched. The deepest
   * is the surface pushing hardest either way. Equally deep contacts stay in
   * the order Rapier gave them, since they describe the same push. The depth
   * is that contact's overlap in pixels, clamped to >= 0.
   *
   * The impulse accumulates as a vector along each manifold's own normal — a
   * pair against a polyline or compound collider solves one manifold per
   * segment, and their normals can differ. The vector and its magnitude are
   * both reported, so dividing by mass gives the speed change the solver
   * applied.
   *
   * Returns undefined for sensor pairs (no manifold exists) or pairs with no
   * solver contact yet (rare same-step start+stop). The returned normal and
   * impulse vector point from handle1 toward handle2; callers negate them for
   * the handle2-side event.
   */
  private _extractContact(
    handle1: number,
    handle2: number,
  ): ContactData | undefined {
    let hasGeometry = false;
    let bestNormalX = 0;
    let bestNormalY = 0;
    let bestPointX = 0;
    let bestPointY = 0;
    let bestSolverContactDist = 0;
    let impulseX = 0;
    let impulseY = 0;
    this.world.narrowPhase.contactPair(
      handle1,
      handle2,
      (manifold, flipped) => {
        const n = manifold.normal();
        const nx = flipped ? -n.x : n.x;
        const ny = flipped ? -n.y : n.y;
        let manifoldImpulse = 0;
        for (let i = 0; i < manifold.numContacts(); i++) {
          manifoldImpulse += manifold.contactImpulse(i);
        }
        impulseX += nx * manifoldImpulse;
        impulseY += ny * manifoldImpulse;
        for (let i = 0; i < manifold.numSolverContacts(); i++) {
          const solverContactDist = manifold.solverContactDist(i);
          if (hasGeometry && solverContactDist >= bestSolverContactDist) {
            continue;
          }
          const p = manifold.solverContactPoint(i);
          hasGeometry = true;
          bestNormalX = nx;
          bestNormalY = ny;
          bestPointX = this.toPixels(p.x);
          bestPointY = this.toPixels(p.y);
          bestSolverContactDist = solverContactDist;
        }
      },
    );
    if (!hasGeometry) return undefined;
    const normal = new Vec2(bestNormalX, bestNormalY);
    const point = new Vec2(bestPointX, bestPointY);
    const penetrationDepth = Math.max(0, this.toPixels(-bestSolverContactDist));
    const impulseVector = new Vec2(
      this.toPixels(impulseX),
      this.toPixels(impulseY),
    );
    return {
      normal,
      point,
      penetrationDepth,
      impulse: impulseVector.length(),
      impulseVector,
    };
  }

  /** Set gravity in pixels/s². */
  setGravity(x: number, y: number): void {
    this.world.gravity = { x: this.toMeters(x), y: this.toMeters(y) };
  }

  /** Create a rigid body and register it. Returns the Rapier handle. */
  createBody(entity: Entity, config: RigidBodyConfig): number {
    let desc: RAPIER.RigidBodyDesc;
    switch (config.type) {
      case "dynamic":
        desc = RAPIER.RigidBodyDesc.dynamic();
        break;
      case "static":
        desc = RAPIER.RigidBodyDesc.fixed();
        break;
      case "kinematic":
        desc = RAPIER.RigidBodyDesc.kinematicPositionBased();
        break;
    }

    if (config.linearDamping !== undefined) {
      desc.setLinearDamping(config.linearDamping);
    }
    if (config.angularDamping !== undefined) {
      desc.setAngularDamping(config.angularDamping);
    }
    if (config.fixedRotation) {
      desc.lockRotations();
    }
    if (config.gravityScale !== undefined) {
      desc.setGravityScale(config.gravityScale);
    }
    if (config.ccd) {
      desc.setCcdEnabled(true);
    }
    if (config.lockTranslationX || config.lockTranslationY) {
      desc.enabledTranslations(
        !config.lockTranslationX,
        !config.lockTranslationY,
      );
    }

    const body = this.world.createRigidBody(desc);
    this.bodyMap.set(body.handle, entity);
    return body.handle;
  }

  /**
   * Connect two live, active rigid bodies with a spring or rope joint. All
   * lengths and anchors are in pixels; every number must be finite, and
   * lengths, stiffness and damping at least 0.
   */
  addJoint(
    bodyA: RigidBodyComponent,
    bodyB: RigidBodyComponent,
    config: JointConfig,
  ): JointHandle {
    this._validateJointConfig(config);
    const bodyAHandle = this._requireLiveBody(bodyA, "bodyA");
    const bodyBHandle = this._requireLiveBody(bodyB, "bodyB");
    if (bodyAHandle === bodyBHandle) {
      throw new Error("Cannot add a joint between a body and itself.");
    }

    const rawBodyA = this.world.getRigidBody(bodyAHandle);
    const rawBodyB = this.world.getRigidBody(bodyBHandle);
    const anchorA = config.anchorA ?? { x: 0, y: 0 };
    const anchorB = config.anchorB ?? { x: 0, y: 0 };
    const rapierAnchorA = {
      x: this.toMeters(anchorA.x),
      y: this.toMeters(anchorA.y),
    };
    const rapierAnchorB = {
      x: this.toMeters(anchorB.x),
      y: this.toMeters(anchorB.y),
    };
    const data =
      config.type === "spring"
        ? RAPIER.JointData.spring(
            this.toMeters(config.restLength),
            config.stiffness,
            config.damping,
            rapierAnchorA,
            rapierAnchorB,
          )
        : RAPIER.JointData.rope(
            this.toMeters(config.length),
            rapierAnchorA,
            rapierAnchorB,
          );
    const joint = this.world.createImpulseJoint(data, rawBodyA, rawBodyB, true);
    const record: JointRecord = {
      rawHandle: joint.handle,
      bodyA: bodyAHandle,
      bodyB: bodyBHandle,
      attached: true,
    };
    this._linkJoint(record);
    return new PhysicsJointHandle(this, record);
  }

  /** Create a collider attached to a body. Returns the Rapier collider handle. */
  createCollider(
    entity: Entity,
    bodyHandle: number,
    config: ColliderConfig,
    component: ColliderComponent,
    shapeIndex = 0,
    effectivePart?: ColliderPartConfig,
  ): number {
    const body = this.world.getRigidBody(bodyHandle);
    const part = effectivePart ?? colliderPart(config, shapeIndex);
    const desc = this.buildColliderDesc(part.shape);

    if (part.offset) {
      desc.setTranslation(
        this.toMeters(part.offset.x),
        this.toMeters(part.offset.y),
      );
    }
    const rotation = colliderRotation(part);
    if (rotation !== 0) {
      desc.setRotation(rotation);
    }
    if (config.restitution !== undefined) {
      desc.setRestitution(config.restitution);
    }
    if (config.friction !== undefined) {
      desc.setFriction(config.friction);
    }
    desc.setDensity(this._effectiveDensity(config, part.shape));
    if (config.contactSkin !== undefined) {
      desc.setContactSkin(this.toMeters(config.contactSkin));
    }
    if (config.sensor) {
      desc.setSensor(true);
    }

    // Set collision groups
    const membership = config.layers ?? 0xffff;
    const filter = config.mask ?? 0xffff;
    if (config.layers !== undefined || config.mask !== undefined) {
      desc.setCollisionGroups(
        CollisionLayers.interactionGroups(membership, filter),
      );
    }

    // Enable collision events so we can dispatch them. ActiveCollisionTypes.ALL
    // is required because Rapier's DEFAULT mask excludes KINEMATIC_KINEMATIC and
    // KINEMATIC_FIXED, which would silently drop trigger events between two
    // kinematic bodies.
    desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    desc.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);

    // A filter installed before the collider exists (the oneWay preset, or a
    // pre-add setContactFilter) is armed at creation.
    if (component._contactFilter) {
      desc.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    }

    const collider = this.world.createCollider(desc, body);
    if (component._contactFilter) {
      this._contactFiltered.add(collider.handle);
    }
    this._colliderBody.set(collider.handle, bodyHandle);
    this._preStepStates.set(collider.handle, {
      x: 0,
      y: 0,
      rotation: 0,
      vx: 0,
      vy: 0,
    });
    this.colliderMap.set(collider.handle, entity);
    this._colliderComponents.set(collider.handle, component);
    this._colliderShapeIndices.set(collider.handle, shapeIndex);
    this._layerInfo.set(collider.handle, { layers: membership, mask: filter });
    this._checkAsymmetricMasks(entity, membership, filter);
    this._trackLayerSignature(entity, membership, filter);
    this._checkConvexHullVertexDrop(collider, part.shape, entity);
    this._queriesStale = true;
    return collider.handle;
  }

  private _trackLayerSignature(
    entity: Entity,
    layers: number,
    mask: number,
  ): void {
    const key = `${layers}:${mask}`;
    const signature = this._layerSignatures.get(key);
    if (signature) {
      signature.count++;
    } else {
      this._layerSignatures.set(key, {
        layers,
        mask,
        entityName: entity.name,
        count: 1,
      });
    }
  }

  private _untrackLayerSignature(handle: number): void {
    const info = this._layerInfo.get(handle);
    if (!info) return;
    this._layerInfo.delete(handle);
    const key = `${info.layers}:${info.mask}`;
    const signature = this._layerSignatures.get(key);
    if (!signature) return;
    signature.count--;
    if (signature.count === 0) this._layerSignatures.delete(key);
  }

  /**
   * Dev-mode check: a polygon collider built via Rapier's convex-hull
   * helper silently drops vertices when the input is concave. Compare
   * input vs. resulting vertex counts and warn on a mismatch.
   */
  private _checkConvexHullVertexDrop(
    collider: RAPIER.Collider,
    shape: ColliderShape,
    entity: Entity,
  ): void {
    if (shape.type !== "polygon") return;
    let resultCount: number;
    try {
      resultCount = collider.vertices().length / 2;
    } catch {
      return;
    }
    const inputCount = shape.vertices.length;
    if (resultCount >= inputCount) return;
    devWarn(
      `Polygon collider on <${entity.name}> with ${inputCount} input vertices ` +
        `reduced to ${resultCount} after convex hull — input was concave. ` +
        `Decompose to convex pieces, or use a polyline collider.`,
    );
  }

  /**
   * Dev-mode check: compare a new collider's layers/mask against every
   * distinct signature already in the world for asymmetric filtering (one
   * direction passes the layer test, the other doesn't). Rapier silently
   * drops collision events for those pairs, so without this warning the
   * user sees a trigger that never fires. Two colliders with the same
   * signature are symmetric by construction, so the scan is per signature,
   * not per collider, and the warning names the signature's first entity.
   */
  private _checkAsymmetricMasks(
    newEntity: Entity,
    newLayers: number,
    newMask: number,
  ): void {
    for (const info of this._layerSignatures.values()) {
      const aSeesB = (newLayers & info.mask) !== 0;
      const bSeesA = (info.layers & newMask) !== 0;
      if (aSeesB === bSeesA) continue;
      const a = `${newLayers}:${newMask}`;
      const b = `${info.layers}:${info.mask}`;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (this._warnedAsymmetricPairs.has(key)) continue;
      this._warnedAsymmetricPairs.add(key);
      const aName = newEntity.name;
      const bName = info.entityName;
      const blocked = aSeesB ? bName : aName;
      const blocker = aSeesB ? aName : bName;
      devWarn(
        `Asymmetric collision masks: <${blocker}> has layer in <${blocked}>'s ` +
          `mask, but <${blocked}>'s layer is not in <${blocker}>'s mask. ` +
          `Trigger will never fire.`,
      );
    }
  }

  /**
   * Remove a rigid body and all its colliders from the world. Each
   * collider's `ColliderComponent` is left holding no handle, so its own
   * teardown and every later call on it are inert; a handle Rapier reuses
   * for the next collider cannot be reached through the stale component.
   */
  removeBody(handle: number): void {
    const body = this.getBody(handle);
    if (!body) return;

    // Rapier frees attached joints as part of removing a body. Orphan their
    // handles first so a later handle.remove() cannot free them a second time.
    const joints = this._jointsByBody.get(handle);
    if (joints) {
      for (const record of [...joints]) {
        record.attached = false;
        this._unlinkJoint(record);
      }
    }

    // Clean up collider mappings
    const numColliders = body.numColliders();
    for (let i = 0; i < numColliders; i++) {
      const collider = body.collider(i);
      this._forgetColliderContacts(collider.handle);
      const component = this._colliderComponents.get(collider.handle);
      component?._detachColliderHandle(collider.handle);
      this.colliderMap.delete(collider.handle);
      this._colliderComponents.delete(collider.handle);
      this._colliderShapeIndices.delete(collider.handle);
      this._untrackLayerSignature(collider.handle);
      this._contactFiltered.delete(collider.handle);
      this._colliderBody.delete(collider.handle);
      this._preStepStates.delete(collider.handle);
    }

    this.world.removeRigidBody(body);
    this.bodyMap.delete(handle);
  }

  /**
   * Remove a single collider from the world, leaving its body (if any)
   * intact. No-ops if the handle is already gone — removing a body already
   * tears down its colliders, so this covers the case where that ran first.
   */
  removeCollider(handle: number): void {
    const collider = this.getCollider(handle);
    if (!collider) return;

    this._forgetColliderContacts(handle);
    this.world.removeCollider(collider, true);
    this.colliderMap.delete(handle);
    this._colliderComponents.delete(handle);
    this._colliderShapeIndices.delete(handle);
    this._untrackLayerSignature(handle);
    this._contactFiltered.delete(handle);
    this._colliderBody.delete(handle);
    this._preStepStates.delete(handle);
  }

  /**
   * @internal Replace a live collider with one built from `config`, keeping
   * the body's mass and the collider's enabled state, and return the new
   * handle. Rapier applies a sensor-flag change only to pairs formed after
   * it — an awake body's existing pairs keep their old kind — so a flip has
   * to be a new collider. Its current pairs end with a `stop` at the next
   * step, which `_resolveSide` still routes to `component` through the
   * retired handle, and re-form in the new kind.
   *
   * The handle changes, so nothing outside this class may cache one; the
   * component's ordered handle list is the only place it lives.
   */
  _replaceCollider(
    handle: number,
    entity: Entity,
    bodyHandle: number,
    config: ColliderConfig,
    component: ColliderComponent,
    shapeIndex: number,
    enabled: boolean,
  ): number {
    const mass = this.world.getCollider(handle).mass();
    this._retiredColliders.set(handle, {
      handle,
      shapeIndex,
      entity,
      collider: component,
      life: entity.generation,
    });
    this.removeCollider(handle);
    const newHandle = this.createCollider(
      entity,
      bodyHandle,
      config,
      component,
      shapeIndex,
      component._effectivePart(shapeIndex),
    );
    const created = this.world.getCollider(newHandle);
    // Explicit mass keeps `getMass()` unchanged across the flip, including
    // a mass a `setShape` without `recomputeMass` kept. The next
    // `setShape({ recomputeMass: true })` sets density again, which puts
    // the collider back on density × shape. Rapier applies the removal, the
    // creation and the explicit mass to the body at the next step; the
    // re-sum makes an immediate `getMass()` read correct. Rapier's re-sum
    // skips a disabled collider, so for a dormant entity the body reads 0
    // until `ColliderComponent.onEnable` sums it again.
    created.setMass(mass);
    created.setEnabled(enabled);
    this.world.getRigidBody(bodyHandle).recomputeMassPropertiesFromColliders();
    return newHandle;
  }

  /**
   * @internal Drop any landed-rider state naming this collider. Rapier
   * reuses collider handles, so a handle leaving the simulation (removed
   * or disabled) must not stay remembered as "landed" on a one-way
   * platform — the next collider with the same handle would inherit it.
   */
  _forgetColliderContacts(handle: number): void {
    for (const component of new Set(this._colliderComponents.values())) {
      const landed = component._oneWayLanded;
      if (!landed) continue;
      for (const pair of landed) {
        const [self, other] = pair.split(":").map(Number);
        if (self === handle || other === handle) landed.delete(pair);
      }
    }
  }

  /**
   * Replace a live collider's shape, keeping its handle, body attachment,
   * collision groups, and event subscriptions. `config` is the owning
   * component's config, already carrying the new shape.
   *
   * The body keeps its mass unless `recomputeMass` asks for it back from
   * density × the new shape.
   */
  setColliderShape(
    handle: number,
    config: ColliderConfig,
    options?: { recomputeMass?: boolean },
    shapeIndex = 0,
    effectivePart?: ColliderPartConfig,
  ): void {
    const collider = this.getCollider(handle);
    if (!collider) return;

    if (!options?.recomputeMass) {
      // Pin the mass the collider has now. A body that has not stepped yet,
      // or is asleep, otherwise gets its mass recomputed from density × the
      // new shape at the next step.
      collider.setMass(collider.mass());
    }
    const part = effectivePart ?? colliderPart(config, shapeIndex);
    collider.setShape(this.buildColliderDesc(part.shape).shape);
    collider.setTranslationWrtParent({
      x: this.toMeters(part.offset?.x ?? 0),
      y: this.toMeters(part.offset?.y ?? 0),
    });
    // The capsule axis:"x" turn is part of the shape, so a swap can change
    // the rotation a collider needs even when config.rotation did not move.
    collider.setRotationWrtParent(colliderRotation(part));

    if (options?.recomputeMass) {
      // The density carries the rounded-box factor for the shape being
      // weighed, so it is set again for the new shape; this also takes a
      // collider off a pinned mass.
      collider.setDensity(this._effectiveDensity(config, part.shape));
      collider.parent()?.recomputeMassPropertiesFromColliders();
    }

    const entity = this.colliderMap.get(handle);
    if (entity) {
      this._checkConvexHullVertexDrop(collider, part.shape, entity);
    }
    this._queriesStale = true;
  }

  /**
   * Get a Rapier rigid body by handle. A handle this world did not issue,
   * or has freed since — including the `-1` a `RigidBodyComponent` holds
   * before add and after destroy — resolves to `undefined`. Rapier itself
   * decodes such a handle to whichever body now sits at that index.
   */
  getBody(handle: number): RAPIER.RigidBody | undefined {
    if (!this.bodyMap.has(handle)) return undefined;
    return this.world.getRigidBody(handle);
  }

  /**
   * Get a Rapier collider by handle. A handle this world did not issue, or
   * has freed since — including the `-1` a `ColliderComponent` holds before
   * add and after removal — resolves to `undefined`.
   */
  getCollider(handle: number): RAPIER.Collider | undefined {
    if (!this.colliderMap.has(handle)) return undefined;
    return this.world.getCollider(handle);
  }

  /**
   * @internal Note that a live collider moved without a step (a teleport,
   * or a re-enable), so the next query rebuilds Rapier's index first.
   */
  _markQueriesStale(): void {
    this._queriesStale = true;
  }

  /**
   * Bring Rapier's query index up to date with every live collider by
   * running a zero-duration step, when something changed since the last
   * one. The zero step moves nothing and advances no simulated time; a
   * kinematic body's pending target would still be applied by it, so each
   * target is first reset to the body's current pose (`PhysicsSystem`
   * re-applies the component's captured target at the next real step).
   * A contact transition the zero step detects is queued like any other and
   * delivered with the next real step's batch — the same moment the next
   * real step would have detected and delivered it without the refresh.
   */
  private _refreshQueries(): void {
    if (!this._queriesStale) return;
    for (const handle of this.bodyMap.keys()) {
      const body = this.world.getRigidBody(handle);
      if (!body.isKinematic()) continue;
      body.setNextKinematicTranslation(body.translation());
      body.setNextKinematicRotation(body.rotation());
    }
    this.step(0);
  }

  /** Rapier's `filterFlags` for a query's sensor mode; the default excludes sensors. */
  private _queryFlags(
    sensors: QuerySensorMode | undefined,
  ): RAPIER.QueryFilterFlags | undefined {
    switch (sensors) {
      case "include":
        return undefined;
      case "only":
        return RAPIER.QueryFilterFlags.EXCLUDE_SOLIDS;
      default:
        return RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    }
  }

  /**
   * Cast a ray and return the first hit. All values in pixels.
   *
   * The direction is normalized internally, so any non-zero vector works —
   * e.g. `target.sub(origin)`. Throws on a zero-length direction.
   * `excludeEntity` skips every collider of that entity — pass the caster
   * when the ray starts inside its own collider. Sensors are skipped unless
   * `sensors` says otherwise.
   *
   * Reports every live collider at its current pose, including one created,
   * re-shaped, enabled, disabled or teleported since the last step, at the
   * cost of a zero-duration step before the query (see `step`).
   */
  raycast(
    origin: Vec2Like,
    direction: Vec2Like,
    maxDistance: number,
    options?: {
      filterGroups?: number;
      excludeEntity?: Entity;
      sensors?: QuerySensorMode;
    },
  ): RaycastHit | null {
    const length = Math.hypot(direction.x, direction.y);
    if (length === 0) {
      throw new Error("raycast direction must be a non-zero vector");
    }
    this._refreshQueries();
    const ray = new RAPIER.Ray(
      { x: this.toMeters(origin.x), y: this.toMeters(origin.y) },
      { x: direction.x / length, y: direction.y / length },
    );

    const maxToi = this.toMeters(maxDistance);
    const exclude = options?.excludeEntity;
    const result = this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      this._queryFlags(options?.sensors),
      options?.filterGroups,
      undefined,
      undefined,
      exclude
        ? (collider) => this.colliderMap.get(collider.handle) !== exclude
        : undefined,
    );

    if (!result) return null;

    const entity = this.colliderMap.get(result.collider.handle);
    if (!entity) return null;

    const hitPoint = ray.pointAt(result.timeOfImpact);
    return {
      entity,
      point: new Vec2(this.toPixels(hitPoint.x), this.toPixels(hitPoint.y)),
      normal: new Vec2(result.normal.x, result.normal.y),
      distance: this.toPixels(result.timeOfImpact),
    };
  }

  /**
   * Sweep `shape` from `origin` along `direction` and return the first thing
   * it would hit, or `null` if nothing is struck within `maxDistance`. All
   * values in pixels.
   *
   * This is the swept counterpart to `queryShape`, which only reports what a
   * shape overlaps where it already stands. Use it to test a move before
   * committing to it: carrying a rider on a moving platform, spotting a
   * closing platform before it traps the player, or checking clearance for a
   * fast fall.
   *
   * `distance` is how far the shape travelled, `point` the world contact
   * point, and `normal` the surface normal on the entity that was hit. A
   * shape already overlapping something at `origin` reports that hit at
   * `distance: 0`. The direction is normalized internally, so any non-zero
   * vector works; a zero-length direction throws, and so does a shape with
   * a dimension that is not finite and above 0. `excludeEntity` skips every
   * collider of that entity — pass the mover when the sweep starts inside its
   * own collider. Sensors are skipped unless `sensors` says otherwise.
   *
   * Reports every live collider at its current pose, running a
   * zero-duration step first when colliders changed since the last step.
   */
  castShape(
    shape: ColliderShape,
    origin: Vec2Like,
    direction: Vec2Like,
    maxDistance: number,
    options?: {
      rotation?: number;
      filterGroups?: number;
      excludeEntity?: Entity;
      sensors?: QuerySensorMode;
    },
  ): RaycastHit | null {
    const length = Math.hypot(direction.x, direction.y);
    if (length === 0) {
      throw new Error("castShape direction must be a non-zero vector");
    }
    assertColliderShape("PhysicsWorld.castShape", shape);
    this._refreshQueries();

    const desc = this.buildColliderDesc(shape);
    // buildColliderDesc leaves the capsule axis:"x" 90° turn to the caller.
    const axisRotation =
      shape.type === "capsule" && shape.axis === "x" ? Math.PI / 2 : 0;
    const exclude = options?.excludeEntity;

    // With a unit direction as the sweep velocity, Rapier's time of impact is
    // the distance travelled in meters.
    const hit = this.world.castShape(
      { x: this.toMeters(origin.x), y: this.toMeters(origin.y) },
      (options?.rotation ?? 0) + axisRotation,
      { x: direction.x / length, y: direction.y / length },
      desc.shape,
      0,
      this.toMeters(maxDistance),
      true,
      this._queryFlags(options?.sensors),
      options?.filterGroups,
      undefined,
      undefined,
      exclude
        ? (collider) => this.colliderMap.get(collider.handle) !== exclude
        : undefined,
    );

    if (!hit) return null;

    const entity = this.colliderMap.get(hit.collider.handle);
    if (!entity) return null;

    return {
      entity,
      // Rapier's typings document witness1/normal1 as local to the swept
      // shape. For this call they are not: checked against the real library,
      // witness1 is the world-space contact point and normal1 the world-space
      // surface normal on the collider that was hit. Don't "correct" these to
      // witness2/normal2 on the strength of the vendor doc comment.
      point: new Vec2(
        this.toPixels(hit.witness1.x),
        this.toPixels(hit.witness1.y),
      ),
      normal: new Vec2(hit.normal1.x, hit.normal1.y),
      distance: this.toPixels(hit.time_of_impact),
    };
  }

  /**
   * Return all entities with a collider overlapping the circle around
   * `center` (pixels). Sugar over `queryShape` with a circle; `radius` must
   * be finite and above 0.
   */
  queryRadius(
    center: Vec2Like,
    radius: number,
    options?: {
      filterGroups?: number;
      excludeEntity?: Entity;
      sensors?: QuerySensorMode;
    },
  ): Entity[] {
    assertPositiveNumber("PhysicsWorld.queryRadius", "radius", radius);
    return this.queryShape({ type: "circle", radius }, center, options);
  }

  /**
   * Return all entities with a collider overlapping `shape` placed at
   * `position` (pixels, `rotation` in radians). `excludeEntity` skips every
   * collider of that entity — pass the querying entity for "what's around
   * me" queries. Sensors are skipped unless `sensors` says otherwise. A
   * shape with a dimension that is not finite and above 0 throws.
   *
   * Reports every live collider at its current pose, running a
   * zero-duration step first when colliders changed since the last step —
   * a collider spawned this frame is already seen.
   */
  queryShape(
    shape: ColliderShape,
    position: Vec2Like,
    options?: {
      rotation?: number;
      filterGroups?: number;
      excludeEntity?: Entity;
      sensors?: QuerySensorMode;
    },
  ): Entity[] {
    assertColliderShape("PhysicsWorld.queryShape", shape);
    this._refreshQueries();
    const desc = this.buildColliderDesc(shape);
    const exclude = options?.excludeEntity;
    const result: Entity[] = [];
    const seen = new Set<Entity>();
    // buildColliderDesc leaves the capsule axis:"x" 90° turn to the caller.
    const axisRotation =
      shape.type === "capsule" && shape.axis === "x" ? Math.PI / 2 : 0;
    this.world.intersectionsWithShape(
      { x: this.toMeters(position.x), y: this.toMeters(position.y) },
      (options?.rotation ?? 0) + axisRotation,
      desc.shape,
      (collider) => {
        const entity = this.colliderMap.get(collider.handle);
        if (entity && entity !== exclude && !seen.has(entity)) {
          seen.add(entity);
          result.push(entity);
        }
        return true; // continue iteration
      },
      this._queryFlags(options?.sensors),
      options?.filterGroups,
    );
    return result;
  }

  /**
   * Return all entities whose colliders currently overlap the given
   * collider. Reports Rapier's intersection pairs, which exist only when
   * one side is a sensor. Reflects every live collider at its current pose,
   * running a zero-duration step first when colliders changed since the
   * last step.
   */
  queryOverlapping(colliderHandle: number): Entity[] {
    const collider = this.getCollider(colliderHandle);
    // A dormant entity is out of the simulation, so it overlaps nothing —
    // including the peers its stale narrow-phase pairs still name.
    const self = this.colliderMap.get(colliderHandle);
    if (!collider || !self?.isActive) return [];
    this._refreshQueries();
    const result: Entity[] = [];
    const seen = new Set<Entity>();
    this.world.intersectionPairsWith(collider, (other) => {
      const entity = this.colliderMap.get(other.handle);
      // Disabling a collider leaves the pair in the narrow phase until the
      // next step, so a same-frame query can still reach a dormant entity.
      if (entity && entity.isActive && !seen.has(entity)) {
        seen.add(entity);
        result.push(entity);
      }
      return true; // continue iteration
    });
    return result;
  }

  /** Inspector-facing snapshot of the current rigid bodies and active contacts. */
  snapshot(): {
    bodies: Array<{
      entityId: string;
      type: BodyType;
      position: { x: number; y: number };
      rotation: number;
      linvel: { x: number; y: number };
      angvel: number;
    }>;
    contacts: Array<{ a: string; b: string }>;
  } {
    const bodies = [...this.bodyMap.entries()]
      .map(([handle, entity]) => {
        const body = this.getBody(handle);
        if (!body) return null;

        const position = body.translation();
        const linvel = body.linvel();
        return {
          entityId: String(entity.id),
          type: this.bodyTypeToSnapshot(body.bodyType()),
          position: {
            x: this.toPixels(position.x),
            y: this.toPixels(position.y),
          },
          rotation: body.rotation(),
          linvel: {
            x: this.toPixels(linvel.x),
            y: this.toPixels(linvel.y),
          },
          angvel: body.angvel(),
        };
      })
      .filter((body): body is NonNullable<typeof body> => body !== null)
      .sort((a, b) =>
        a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0,
      );

    const contactPairs = new Set<string>();
    for (const handle of this.colliderMap.keys()) {
      const collider = this.getCollider(handle);
      if (!collider) continue;

      this.world.contactPairsWith(collider, (other) => {
        const first = this.colliderMap.get(handle);
        const second = this.colliderMap.get(other.handle);
        if (!first || !second) return;
        const [a, b] = [String(first.id), String(second.id)].sort((x, y) =>
          x < y ? -1 : x > y ? 1 : 0,
        );
        contactPairs.add(`${a}:${b}`);
      });

      this.world.intersectionPairsWith(collider, (other) => {
        const first = this.colliderMap.get(handle);
        const second = this.colliderMap.get(other.handle);
        if (!first || !second) return true;
        const [a, b] = [String(first.id), String(second.id)].sort((x, y) =>
          x < y ? -1 : x > y ? 1 : 0,
        );
        contactPairs.add(`${a}:${b}`);
        return true;
      });
    }

    const contacts = [...contactPairs]
      .map((pair) => {
        const [a, b] = pair.split(":");
        return { a: a!, b: b! };
      })
      .sort((left, right) => {
        if (left.a !== right.a) {
          return left.a < right.a ? -1 : 1;
        }
        return left.b < right.b ? -1 : left.b > right.b ? 1 : 0;
      });

    return { bodies, contacts };
  }

  /** Destroy the physics world and free resources. */
  destroy(): void {
    for (const joints of this._jointsByBody.values()) {
      for (const record of joints) record.attached = false;
    }
    this._jointsByBody.clear();
    this.eventQueue.free();
    this.world.free();
    this.bodyMap.clear();
    this.colliderMap.clear();
    this._colliderComponents.clear();
    this._colliderShapeIndices.clear();
    this._layerInfo.clear();
    this._layerSignatures.clear();
    this._warnedAsymmetricPairs.clear();
    this._contactFiltered.clear();
    this._colliderBody.clear();
    this._preStepStates.clear();
    this._pendingPairs = [];
    this._retiredColliders.clear();
  }

  // ---- Internal helpers ----

  /**
   * Density that gives a collider the mass its footprint covers. Rapier
   * weighs a rounded box by its inner rectangle alone, ignoring the
   * radius, so a rounded box's density is scaled up by the ratio of the
   * two areas. Angular inertia is the inner rectangle's, scaled by the same
   * factor — an approximation of the round-rectangle inertia.
   */
  private _effectiveDensity(
    config: ColliderConfig,
    shape: ColliderShape,
  ): number {
    const density = config.density ?? 1;
    if (shape.type !== "box") return density;
    return density * getBoxColliderGeometry(shape).areaScale;
  }

  private _validateJointConfig(config: JointConfig): void {
    const context = "PhysicsWorld.addJoint";
    if (config.type === "spring") {
      assertFiniteNumber(context, "restLength", config.restLength, 0);
      assertFiniteNumber(context, "stiffness", config.stiffness, 0);
      assertFiniteNumber(context, "damping", config.damping, 0);
    } else {
      assertFiniteNumber(context, "length", config.length, 0);
    }
    assertFiniteNumber(context, "anchorA.x", config.anchorA?.x);
    assertFiniteNumber(context, "anchorA.y", config.anchorA?.y);
    assertFiniteNumber(context, "anchorB.x", config.anchorB?.x);
    assertFiniteNumber(context, "anchorB.y", config.anchorB?.y);
  }

  private _requireLiveBody(
    component: RigidBodyComponent,
    label: "bodyA" | "bodyB",
  ): number {
    const handle = component._bodyHandle;
    if (handle === -1 || this.bodyMap.get(handle) !== component.entity) {
      throw new Error(
        `${label} must be added to this physics world first; bodies from a different scene's physics world cannot be jointed here.`,
      );
    }
    // Disabling a body detaches its joints; a joint added while the body is
    // already dormant would skip that and wake up tethered in the next life.
    if (!component.entity.isActive) {
      throw new Error(
        `PhysicsWorld.addJoint: ${label} must be active; add the joint after the entity is enabled.`,
      );
    }
    return handle;
  }

  private _linkJoint(record: JointRecord): void {
    this._addJointToBody(record.bodyA, record);
    this._addJointToBody(record.bodyB, record);
  }

  private _addJointToBody(handle: number, record: JointRecord): void {
    let joints = this._jointsByBody.get(handle);
    if (!joints) {
      joints = new Set<JointRecord>();
      this._jointsByBody.set(handle, joints);
    }
    joints.add(record);
  }

  private _unlinkJoint(record: JointRecord): void {
    for (const handle of [record.bodyA, record.bodyB]) {
      const joints = this._jointsByBody.get(handle);
      if (!joints) continue;
      joints.delete(record);
      if (joints.size === 0) this._jointsByBody.delete(handle);
    }
  }

  /** @internal Remove a live joint and unlink its record. */
  _removeJoint(record: JointRecord): void {
    if (!record.attached) return;
    const joint = this.world.getImpulseJoint(record.rawHandle);
    this.world.removeImpulseJoint(joint, true);
    record.attached = false;
    this._unlinkJoint(record);
  }

  /**
   * @internal Detach every joint touching this body. Called when the body is
   * disabled: a dormant entity may be reused as something else, and a joint
   * is cross-life state the same way momentum and landed contacts are — the
   * next life must not wake up tethered to the old partner. Unlike removal,
   * disabling leaves the body in Rapier, so the joints are freed here.
   */
  _detachJointsForBody(handle: number): void {
    const joints = this._jointsByBody.get(handle);
    if (!joints) return;
    for (const record of [...joints]) {
      this._removeJoint(record);
    }
  }

  private buildColliderDesc(shape: ColliderShape): RAPIER.ColliderDesc {
    switch (shape.type) {
      case "box": {
        const geometry = getBoxColliderGeometry(shape);
        if (geometry.borderRadius === 0) {
          return RAPIER.ColliderDesc.cuboid(
            this.toMeters(geometry.halfWidth),
            this.toMeters(geometry.halfHeight),
          );
        }
        return RAPIER.ColliderDesc.roundCuboid(
          this.toMeters(geometry.halfWidth),
          this.toMeters(geometry.halfHeight),
          this.toMeters(geometry.borderRadius),
        );
      }
      case "circle":
        return RAPIER.ColliderDesc.ball(this.toMeters(shape.radius));
      case "capsule":
        // The axis:"x" rotation is applied by createCollider via colliderRotation.
        return RAPIER.ColliderDesc.capsule(
          this.toMeters(shape.halfHeight),
          this.toMeters(shape.radius),
        );
      case "polygon": {
        const flat = flattenVertices(shape.vertices, (v) => this.toMeters(v));
        const desc = RAPIER.ColliderDesc.convexHull(flat);
        // Validated input always builds; this is the typed fallback for
        // Rapier's `| null` return.
        if (!desc) {
          throw new Error(
            "Rapier rejected the convex hull for the polygon vertices.",
          );
        }
        return desc;
      }
      case "polyline": {
        const flat = flattenVertices(shape.vertices, (v) => this.toMeters(v));
        return RAPIER.ColliderDesc.polyline(flat);
      }
    }
  }

  private bodyTypeToSnapshot(type: RAPIER.RigidBodyType): BodyType {
    if (type === RAPIER.RigidBodyType.Fixed) return "static";
    if (
      type === RAPIER.RigidBodyType.KinematicPositionBased ||
      type === RAPIER.RigidBodyType.KinematicVelocityBased
    ) {
      return "kinematic";
    }
    return "dynamic";
  }
}
