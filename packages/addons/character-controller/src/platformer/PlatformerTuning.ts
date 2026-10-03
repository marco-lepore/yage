export interface PlatformerTuning {
  /** Horizontal speed a held direction reaches, px/s. */
  readonly runSpeed: number;
  /** How fast horizontal speed closes on that while standing, px/s². */
  readonly groundAcceleration: number;
  /** The same while airborne, px/s². */
  readonly airAcceleration: number;
  /** How fast speed above run speed, held toward, comes back to it while standing, px/s². */
  readonly groundShed: number;
  /** The same while airborne, px/s². */
  readonly airShed: number;
  /** How fast crouched speed changes, toward zero or toward the exit speed, px/s². */
  readonly crouchAcceleration: number;
  /** The one speed a slide runs at, px/s. Faster speed brought into a crouch is cut to it. */
  readonly slideSpeed: number;

  readonly slideExitSpeed: number;
  /** Base downward acceleration, px/s². The three multipliers below scale it. */
  readonly gravity: number;
  /** Applied while the body is rising. */
  readonly riseMultiplier: number;
  /** Applied while vertical speed is within `apexSpeed` of zero. */
  readonly apexMultiplier: number;
  /** How near zero vertical speed must be to count as the apex, px/s. */
  readonly apexSpeed: number;
  /** Applied while the body is falling. */
  readonly fallMultiplier: number;
  /** Downward speed the fall stops accelerating at, px/s. */
  readonly terminalFallSpeed: number;
  /** Downward speed a body clinging to a wall falls at instead, px/s. */
  readonly wallSlideSpeed: number;
  /** Downward speed held while standing, so the solver keeps the body seated, px/s. */
  readonly groundPressSpeed: number;
  /** How fast the body may rise and still count as standing, px/s. */
  readonly groundedRiseTolerance: number;
}
