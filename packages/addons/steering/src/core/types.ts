import type { Entity, Vec2, Vec2Like } from "@yagejs/core";

/**
 * The agent's own kinematics, read by every behavior each `compute`.
 * `velocity` is the actual velocity when the agent drives a body (so
 * behaviors see collisions and knockback), else the last commanded one.
 * `entity` is set when a `SteeringAgent` hosts the model — behaviors that
 * query the world use it to exclude the agent itself; absent in manual
 * drive.
 */
export interface AgentState {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly maxSpeed: number;
  readonly entity?: Entity;
}

/** A moving point — a chase/flee target or a flock neighbor. */
export interface Kinematic {
  readonly position: Vec2Like;
  readonly velocity: Vec2Like;
}

/** A static circular obstacle for `avoidObstacles`. */
export interface Obstacle {
  readonly position: Vec2Like;
  readonly radius: number;
}

/**
 * A static point, or a provider read live each `compute` (a moving target).
 * Providers receive the agent's state — ignore it for a plain moving
 * target, use it for agent-relative sources (e.g. a physics query around
 * the agent).
 */
export type PointTarget = Vec2Like | ((agent: AgentState) => Vec2Like);

/** A static Kinematic, or a provider read live each `compute`. */
export type KinematicTarget = Kinematic | ((agent: AgentState) => Kinematic);

/** A static obstacle list, or a provider read live each `compute`. */
export type ObstaclesSource =
  | readonly Obstacle[]
  | ((agent: AgentState) => readonly Obstacle[]);

/** A static neighbor list, or a provider read live each `compute`. */
export type NeighborsSource =
  | readonly Kinematic[]
  | ((agent: AgentState) => readonly Kinematic[]);

/** One weighted contribution to a `Steering` blend. */
export interface SteeringBehavior {
  readonly weight: number;
  readonly priority: number;
  evaluate(agent: AgentState, dt: number): Vec2;
}

/** Options every behavior factory accepts. */
export interface SteeringOptions {
  /** Contribution weight within the behavior's priority tier. Defaults to 1. */
  weight?: number;
  /**
   * Arbitration tier. Tiers are consulted highest-first each frame; the
   * first tier whose weighted sum is non-zero wins outright and lower tiers
   * are not evaluated. Defaults to 0 (everything in one tier = plain
   * weighted sum). Raise it on a behavior that must override the blend when
   * it returns a non-zero steer — e.g. `avoidObstacles(rocks, { priority: 1 })`.
   */
  priority?: number;
}

export type SeekOptions = SteeringOptions;

export interface FleeOptions extends SteeringOptions {
  /** Only flee when within this distance of the target. Omit to always flee. */
  radius?: number;
}

export interface ArriveOptions extends SteeringOptions {
  /** Distance at which speed starts ramping down toward the target. Default 120. */
  slowRadius?: number;
  /** Distance at which the agent is considered settled (desired = ZERO). Default 4. */
  arriveRadius?: number;
  /** Fires once on the frame distance first drops below `arriveRadius`. */
  onArrive?: () => void;
  /** Fires once on the frame distance climbs back above `arriveRadius`. */
  onDepart?: () => void;
}

export interface WanderOptions extends SteeringOptions {
  /** Distance the wander circle sits ahead of the agent, along its heading. Default 60. */
  distance?: number;
  /** Radius of the wander circle. Default 30. */
  radius?: number;
  /** Max wander-angle change, in radians/second. Default 3. */
  jitter?: number;
  /** Random source, injectable for deterministic tests. Default `Math.random`. */
  random?: () => number;
}

export interface PursueOptions extends SteeringOptions {
  /** Max look-ahead time (seconds) used to predict the target's future position. Default 1. */
  maxPrediction?: number;
}

export interface AvoidObstaclesOptions extends SteeringOptions {
  /** Look-ahead ray length in pixels. Default 100. */
  lookAhead?: number;
  /** Extra radius added to every obstacle to model the agent's own size. Default 0. */
  agentRadius?: number;
}

export interface FlockOptions extends SteeringOptions {
  /** Neighbor radius. Default depends on the behavior (separation 40, alignment/cohesion 80). */
  radius?: number;
}

export interface FollowPathOptions extends SteeringOptions {
  /** Distance at which a waypoint counts as reached and the next one is targeted. Default 16. */
  waypointRadius?: number;
  /** Wrap back to the first waypoint after the last (patrol). Default false: settle at the end. */
  loop?: boolean;
  /**
   * Waypoint to start from: an index (restore a saved `waypointIndex`), or
   * `"nearest"` to enter the path at the closest waypoint (mid-route
   * attach). Default 0.
   */
  startAt?: number | "nearest";
  /** Slow-down distance for the final waypoint (as in `arrive`). Default 120. */
  slowRadius?: number;
  /** Settle distance for the final waypoint (as in `arrive`). Default 4. */
  arriveRadius?: number;
  /** Fires once when the agent settles at the final waypoint (non-loop only). */
  onArrive?: () => void;
  /** Fires once if the agent is pushed back out of the final waypoint's settle radius. */
  onDepart?: () => void;
}

/** The behavior `followPath` returns — progress is readable for saving. */
export interface FollowPathBehavior extends SteeringBehavior {
  /** Index of the currently targeted waypoint. Snapshot it; restore via `startAt`. */
  readonly waypointIndex: number;
}

/** A world-pixel rectangle for `contain`. */
export interface ContainBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ContainOptions extends SteeringOptions {
  /** How far ahead (px, along the heading) to check for leaving the bounds. Default 60. */
  lookAhead?: number;
}
