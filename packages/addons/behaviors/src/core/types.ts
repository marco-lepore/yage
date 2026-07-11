import type { Vec2, Vec2Like } from "@yagejs/core";

/** The agent's own kinematics, read by every behavior each `compute`. */
export interface AgentState {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly maxSpeed: number;
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

/** A static point, or a provider read live each `compute` (a moving target). */
export type PointTarget = Vec2Like | (() => Vec2Like);

/** A static Kinematic, or a provider read live each `compute`. */
export type KinematicTarget = Kinematic | (() => Kinematic);

/** A static obstacle list, or a provider read live each `compute`. */
export type ObstaclesSource =
  | readonly Obstacle[]
  | (() => readonly Obstacle[]);

/** A static neighbor list, or a provider read live each `compute`. */
export type NeighborsSource =
  | readonly Kinematic[]
  | (() => readonly Kinematic[]);

/** One weighted contribution to a `Steering` blend. */
export interface SteeringBehavior {
  readonly weight: number;
  evaluate(agent: AgentState, dt: number): Vec2;
}

/** Option every behavior factory accepts. */
export interface SteeringOptions {
  /** Contribution weight in the weighted-sum blend. Defaults to 1. */
  weight?: number;
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
