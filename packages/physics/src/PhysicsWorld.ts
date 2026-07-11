import RAPIER from "@dimforge/rapier2d";
import { devWarn, Vec2 } from "@yagejs/core";
import type { Entity, Vec2Like } from "@yagejs/core";
import { CollisionLayers } from "./CollisionLayers.js";
import { colliderRotation } from "./toRapierColliders.js";
import type {
  PhysicsConfig,
  RigidBodyConfig,
  ColliderConfig,
  ColliderShape,
  BodyType,
  RaycastHit,
} from "./types.js";
import type { ColliderComponent } from "./ColliderComponent.js";

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

  private readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly _layerInfo = new Map<
    number,
    { layers: number; mask: number }
  >();
  private readonly _warnedAsymmetricPairs = new Set<string>();

  constructor(config?: PhysicsConfig) {
    this.pixelsPerMeter = config?.pixelsPerMeter ?? DEFAULT_PIXELS_PER_METER;
    const gx = config?.gravity?.x ?? DEFAULT_GRAVITY_X;
    const gy = config?.gravity?.y ?? DEFAULT_GRAVITY_Y;
    this.world = new RAPIER.World({
      x: this.toMeters(gx),
      y: this.toMeters(gy),
    });
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

  /** Step the physics simulation. dt is in seconds. */
  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
  }

  /** Drain collision events and dispatch to ColliderComponents. */
  processCollisionEvents(): void {
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const comp1 = this._colliderComponents.get(handle1);
      const comp2 = this._colliderComponents.get(handle2);
      const entity1 = this.colliderMap.get(handle1);
      const entity2 = this.colliderMap.get(handle2);

      const needsContact =
        started &&
        ((comp1 && !comp1.config.sensor) || (comp2 && !comp2.config.sensor));
      const contact = needsContact
        ? this._extractContact(handle1, handle2)
        : undefined;

      if (comp1 && entity2 && comp2) {
        if (comp1.config.sensor) {
          comp1._dispatchTrigger({
            other: entity2,
            otherCollider: comp2,
            entered: started,
          });
        } else {
          comp1._dispatchCollision({
            other: entity2,
            otherCollider: comp2,
            started,
            ...(contact
              ? {
                  contactNormal: contact.normal,
                  contactPoint: contact.point,
                  penetrationDepth: contact.penetrationDepth,
                }
              : {}),
          });
        }
      }

      if (comp2 && entity1 && comp1) {
        if (comp2.config.sensor) {
          comp2._dispatchTrigger({
            other: entity1,
            otherCollider: comp1,
            entered: started,
          });
        } else {
          comp2._dispatchCollision({
            other: entity1,
            otherCollider: comp1,
            started,
            ...(contact
              ? {
                  // Self (entity2) toward other (entity1): opposite of the
                  // handle1-toward-handle2 normal extracted below.
                  contactNormal: contact.normal.scale(-1),
                  contactPoint: contact.point,
                  penetrationDepth: contact.penetrationDepth,
                }
              : {}),
          });
        }
      }
    });
  }

  /**
   * Extract contact data for a started, non-sensor collision pair from the
   * first manifold Rapier's narrow phase has on hand. Returns undefined for
   * sensor pairs (no manifold exists) or pairs with no solver contact yet
   * (rare same-step start+stop). The returned normal points from handle1
   * toward handle2; callers negate it for the handle2-side event.
   */
  private _extractContact(
    handle1: number,
    handle2: number,
  ): { normal: Vec2; point: Vec2; penetrationDepth: number } | undefined {
    let contact: { normal: Vec2; point: Vec2; penetrationDepth: number } | undefined;
    let handled = false;
    this.world.narrowPhase.contactPair(handle1, handle2, (manifold, flipped) => {
      if (handled) return;
      handled = true;
      if (manifold.numSolverContacts() === 0) return;

      const n = manifold.normal();
      const normal = flipped ? new Vec2(-n.x, -n.y) : new Vec2(n.x, n.y);
      const p = manifold.solverContactPoint(0);
      const point = new Vec2(this.toPixels(p.x), this.toPixels(p.y));
      const penetrationDepth = Math.max(
        0,
        this.toPixels(-manifold.solverContactDist(0)),
      );
      contact = { normal, point, penetrationDepth };
    });
    return contact;
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
      desc.enabledTranslations(!config.lockTranslationX, !config.lockTranslationY);
    }

    const body = this.world.createRigidBody(desc);
    this.bodyMap.set(body.handle, entity);
    return body.handle;
  }

  /** Create a collider attached to a body. Returns the Rapier collider handle. */
  createCollider(
    entity: Entity,
    bodyHandle: number,
    config: ColliderConfig,
    component: ColliderComponent,
  ): number {
    const body = this.world.getRigidBody(bodyHandle);
    const desc = this.buildColliderDesc(config.shape);

    if (config.offset) {
      desc.setTranslation(
        this.toMeters(config.offset.x),
        this.toMeters(config.offset.y),
      );
    }
    const rotation = colliderRotation(config);
    if (rotation !== 0) {
      desc.setRotation(rotation);
    }
    if (config.restitution !== undefined) {
      desc.setRestitution(config.restitution);
    }
    if (config.friction !== undefined) {
      desc.setFriction(config.friction);
    }
    if (config.density !== undefined) {
      desc.setDensity(config.density);
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

    const collider = this.world.createCollider(desc, body);
    this.colliderMap.set(collider.handle, entity);
    this._colliderComponents.set(collider.handle, component);
    this._layerInfo.set(collider.handle, { layers: membership, mask: filter });
    this._checkAsymmetricMasks(collider.handle, entity, membership, filter);
    this._checkConvexHullVertexDrop(collider, config.shape, entity);
    return collider.handle;
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
   * Dev-mode check: when a new collider lands with explicit layers/mask,
   * scan existing colliders for asymmetric filtering (one direction
   * passes the layer test, the other doesn't). Rapier silently drops
   * collision events for those pairs, so without this warning the user
   * sees a trigger that never fires.
   */
  private _checkAsymmetricMasks(
    newHandle: number,
    newEntity: Entity,
    newLayers: number,
    newMask: number,
  ): void {
    for (const [otherHandle, info] of this._layerInfo) {
      if (otherHandle === newHandle) continue;
      const aSeesB = (newLayers & info.mask) !== 0;
      const bSeesA = (info.layers & newMask) !== 0;
      if (aSeesB === bSeesA) continue;
      const a = `${newLayers}:${newMask}`;
      const b = `${info.layers}:${info.mask}`;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (this._warnedAsymmetricPairs.has(key)) continue;
      this._warnedAsymmetricPairs.add(key);
      const otherEntity = this.colliderMap.get(otherHandle);
      const aName = newEntity.name;
      const bName = otherEntity?.name ?? "<unknown>";
      const blocked = aSeesB ? bName : aName;
      const blocker = aSeesB ? aName : bName;
      devWarn(
        `Asymmetric collision masks: <${blocker}> has layer in <${blocked}>'s ` +
          `mask, but <${blocked}>'s layer is not in <${blocker}>'s mask. ` +
          `Trigger will never fire.`,
      );
    }
  }

  /** Remove a rigid body and all its colliders from the world. */
  removeBody(handle: number): void {
    const body = this.world.getRigidBody(handle);
    if (!body) return;

    // Clean up collider mappings
    const numColliders = body.numColliders();
    for (let i = 0; i < numColliders; i++) {
      const collider = body.collider(i);
      this.colliderMap.delete(collider.handle);
      this._colliderComponents.delete(collider.handle);
      this._layerInfo.delete(collider.handle);
    }

    this.world.removeRigidBody(body);
    this.bodyMap.delete(handle);
  }

  /** Get a Rapier rigid body by handle. */
  getBody(handle: number): RAPIER.RigidBody | undefined {
    try {
      return this.world.getRigidBody(handle);
    } catch {
      return undefined;
    }
  }

  /** Get a Rapier collider by handle. */
  getCollider(handle: number): RAPIER.Collider | undefined {
    try {
      return this.world.getCollider(handle);
    } catch {
      return undefined;
    }
  }

  /**
   * Cast a ray and return the first hit. All values in pixels.
   *
   * The direction is normalized internally, so any non-zero vector works —
   * e.g. `target.sub(origin)`. Throws on a zero-length direction.
   */
  raycast(
    origin: Vec2Like,
    direction: Vec2Like,
    maxDistance: number,
    options?: { filterGroups?: number },
  ): RaycastHit | null {
    const length = Math.hypot(direction.x, direction.y);
    if (length === 0) {
      throw new Error("raycast direction must be a non-zero vector");
    }
    const ray = new RAPIER.Ray(
      { x: this.toMeters(origin.x), y: this.toMeters(origin.y) },
      { x: direction.x / length, y: direction.y / length },
    );

    const maxToi = this.toMeters(maxDistance);
    const result = this.world.castRayAndGetNormal(
      ray,
      maxToi,
      true,
      undefined,
      options?.filterGroups,
    );

    if (!result) return null;

    const entity = this.colliderMap.get(result.collider.handle);
    if (!entity) return null;

    const hitPoint = ray.pointAt(result.timeOfImpact);
    return {
      entity,
      point: new Vec2(
        this.toPixels(hitPoint.x),
        this.toPixels(hitPoint.y),
      ),
      normal: new Vec2(result.normal.x, result.normal.y),
      distance: this.toPixels(result.timeOfImpact),
    };
  }

  /** Return all entities whose colliders currently overlap the given collider. */
  queryOverlapping(colliderHandle: number): Entity[] {
    const collider = this.getCollider(colliderHandle);
    if (!collider) return [];
    const result: Entity[] = [];
    const seen = new Set<Entity>();
    this.world.intersectionPairsWith(collider, (other) => {
      const entity = this.colliderMap.get(other.handle);
      if (entity && !seen.has(entity)) {
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
    this.eventQueue.free();
    this.world.free();
    this.bodyMap.clear();
    this.colliderMap.clear();
    this._colliderComponents.clear();
    this._layerInfo.clear();
    this._warnedAsymmetricPairs.clear();
  }

  // ---- Internal helpers ----

  private buildColliderDesc(shape: ColliderShape): RAPIER.ColliderDesc {
    switch (shape.type) {
      case "box":
        return RAPIER.ColliderDesc.cuboid(
          this.toMeters(shape.width / 2),
          this.toMeters(shape.height / 2),
        );
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
        if (!desc) {
          throw new Error("Failed to create convex hull from vertices.");
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
