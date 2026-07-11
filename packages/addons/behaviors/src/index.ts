/**
 * @yagejs-addons/behaviors — headless entry (the only entry point).
 *
 * Pure `@yagejs/core`: no pixi, no physics, no input. The `Steering` model
 * and behavior factories compute a desired velocity; `SteeringAgent` hosts
 * the model per-entity and applies it — by default via kinematic Transform
 * integration, or through a one-line `apply` callback for a physics body.
 * There is no `./presenters` subpath (no bundled presentation) and no
 * `events.ts` (consequences are the readable `velocity` + callbacks like
 * `arrive`'s `onArrive`/`onDepart`, not an entity-event stream).
 */

// --- Headless model (L1) ---
export { Steering } from "./core/Steering.js";
export {
  alignment,
  arrive,
  avoidObstacles,
  cohesion,
  evade,
  flee,
  pursue,
  seek,
  separation,
  wander,
} from "./core/behaviors.js";
export type {
  AgentState,
  ArriveOptions,
  AvoidObstaclesOptions,
  FleeOptions,
  FlockOptions,
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
export type { SteeringAgentOptions, SteeringApplyContext } from "./SteeringAgent.js";
