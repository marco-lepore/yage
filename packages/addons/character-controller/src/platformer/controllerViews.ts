export interface PlatformerDemand {
  /** -1 through 1 — which way the body is asking to go. */
  readonly direction: number;
  /** Whether the body is asking to be low. */
  readonly down: boolean;
  /** Optional permission for the continuous wall-cling rule; defaults to true. */
  readonly wallClingAllowed?: boolean;
}

export interface SpeedLimitView {
  readonly speedScale: number;
}

export interface FallHoldView {
  readonly holdingFall: boolean;
  /** How hard the fall is arrested, px/s². Read only while `holdingFall`. */
  readonly fallHoldRate: number;
}
