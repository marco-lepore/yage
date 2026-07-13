/**
 * @yagejs-addons/steering — headless root entry.
 *
 * Pure `@yagejs/core`: no pixi, no physics, no input. The `Steering` model
 * and behavior factories compute a desired velocity; `SteeringAgent` hosts
 * the model per-entity and applies it — kinematic Transform integration by
 * default, or a structural `body` (`VelocityBody`/`ImpulseBody`, satisfied
 * by `RigidBodyComponent` without an import) for physics-driven agents.
 * `@yagejs-addons/steering/physics` adds the sibling-detecting
 * `PhysicsSteeringAgent`. There is no `./presenters` subpath (no bundled
 * presentation) and no `events.ts` (consequences are the readable
 * `velocity` + callbacks like `arrive`'s `onArrive`/`onDepart`, not an
 * entity-event stream).
 */

// --- Headless model (L1) ---
export { Steering } from "./core/Steering.js";
export {
  alignment,
  arrive,
  avoidObstacles,
  cohesion,
  contain,
  evade,
  flee,
  followPath,
  pursue,
  seek,
  separation,
  wander,
} from "./core/behaviors.js";
export type {
  AgentState,
  ArriveOptions,
  AvoidObstaclesOptions,
  ContainBounds,
  ContainOptions,
  FleeOptions,
  FlockOptions,
  FollowPathBehavior,
  FollowPathOptions,
  Kinematic,
  KinematicTarget,
  NeighborsSource,
  Obstacle,
  ObstaclesSource,
  PointTarget,
  PursueOptions,
  SeekOptions,
  SteeringBehavior,
  SteeringOptions,
  WanderOptions,
} from "./core/types.js";

// --- YAGE integration (L2a) ---
export { SteeringAgent } from "./SteeringAgent.js";
export type {
  ImpulseBody,
  SteeringAgentOptions,
  SteeringApplyContext,
  VelocityBody,
} from "./SteeringAgent.js";
