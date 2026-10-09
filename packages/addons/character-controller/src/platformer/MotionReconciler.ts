import { finite } from "../core/validate.js";
import { Component, ErrorBoundaryKey } from "@yagejs/core";
import { RigidBodyComponent } from "@yagejs/physics";

import {
  CHARACTER_CONTROLLER_PRIORITY,
  type DurableIntentHandle,
  type MotionIntent,
  type MotionResolver,
  type MotionResolution,
  type MotionIntentHandle,
  type RefusedIntent,
  resolveMotion,
} from "../core/MotionIntent.js";

import type { TerrainAssist, TerrainRequest } from "./TerrainAssist.js";
import { MotionQueue } from "../core/MotionQueue.js";

export class MotionReconciler extends Component {
  private readonly queue = new MotionQueue();
  private body!: RigidBodyComponent;
  private refused: readonly RefusedIntent[] = [];
  private yielded = false;
  private tookGravity = 0;
  private terrainRequest: TerrainRequest | undefined;

  private support: RigidBodyComponent | undefined;
  private surface = { x: 0, y: 0, previousX: 0, previousY: 0 };
  private applied = { x: 0, y: 0 };
  private launchSupportY = 0;

  get solverOwned(): boolean {
    return this.yielded;
  }

  get launchSurfaceY(): number {
    return this.launchSupportY;
  }

  setSupport(
    body: RigidBodyComponent | undefined,
    velocity: { readonly x: number; readonly y: number },
  ): void {
    finite("MotionReconciler.setSupport", "velocity.x", velocity.x);
    finite("MotionReconciler.setSupport", "velocity.y", velocity.y);
    const continuing = body !== undefined && this.support !== undefined;
    this.surface = {
      x: body ? velocity.x : 0,
      y: body ? velocity.y : 0,
      previousX: continuing ? this.applied.x : 0,
      previousY: continuing ? this.applied.y : 0,
    };
    this.support = body;
  }

  get ownVelocityX(): number {
    return this.velocityX - (this.support ? this.applied.x : 0);
  }

  constructor(
    private readonly terrain?: TerrainAssist,
    private readonly resolver: MotionResolver = resolveMotion,
  ) {
    super();
  }

  submitTerrain(request: TerrainRequest): void {
    finite("MotionReconciler.submitTerrain", "direction", request.direction);
    this.terrainRequest = { ...request };
  }

  onAdd(): void {
    this.body = this.entity.get(RigidBodyComponent);
  }

  /**
   * Write departure velocity and gravity, then let physics own the body.
   * Resolution pauses; submitted and durable claims are discarded while yielded.
   * reclaim() restores the body's previous gravity scale.
   */
  yieldToSolver(
    velocity: { x: number; y: number },
    gravityScale: number,
  ): void {
    finite("MotionReconciler.yieldToSolver", "velocity.x", velocity.x);
    finite("MotionReconciler.yieldToSolver", "velocity.y", velocity.y);
    finite("MotionReconciler.yieldToSolver", "gravityScale", gravityScale);
    if (!this.yielded) this.tookGravity = this.body.gravityScale;
    this.cancelAll();
    this.yielded = true;
    this.support = undefined;
    this.surface = { x: 0, y: 0, previousX: 0, previousY: 0 };
    this.applied = { x: 0, y: 0 };
    this.body.setGravityScale(gravityScale);
    this.body.setVelocity(velocity);
  }

  reclaim(at?: { x: number; y: number }): void {
    if (at) {
      finite("MotionReconciler.reclaim", "at.x", at.x);
      finite("MotionReconciler.reclaim", "at.y", at.y);
    }
    if (!this.yielded && !at) return;
    this.cancelAll();
    this.yielded = false;
    this.body.setGravityScale(this.tookGravity);
    if (at !== undefined) {
      this.body.setPosition(at.x, at.y);
      // Cleared rather than carried through the jump. It survives no steps —
      // this component resolves a fresh velocity lower down the same pass — but
      // what it resolves against is this rather than the speed the body had
      // somewhere else.
      this.body.setVelocity({ x: 0, y: 0 });
    }
  }

  /** For this step only. Not submitting next step means not wanting. */
  submit(intent: MotionIntent): void {
    this.queue.submit(intent);
  }

  /**
   * Compete once when simulation advances. Hitstop preserves the command;
   * winning or being refused consumes it. cancel() withdraws it beforehand.
   */
  submitOnce(intent: MotionIntent): MotionIntentHandle {
    return this.queue.submitOnce(intent);
  }

  /**
   * Hold until end(), with one advancing resolution guaranteed unless cancelled.
   * The producer owns its duration. end() and cancel() are idempotent.
   */
  submitDurable(intent: MotionIntent): DurableIntentHandle {
    return this.queue.submitDurable(intent);
  }

  /** Withdraw current commands and holds without changing body velocity. */
  cancelAll(): void {
    this.queue.cancelAll();
    this.terrainRequest = undefined;
  }

  onDisable(): void {
    this.cancelAll();
  }

  onEnable(): void {
    // Other producers may keep running while this component is disabled.
    this.cancelAll();
  }

  onDestroy(): void {
    this.cancelAll();
  }

  get velocityX(): number {
    return this.body.velocityX;
  }

  get velocityY(): number {
    return this.body.velocityY;
  }

  /** What was refused on the last step. Reported rather than dropped. */
  get refusedLastStep(): readonly RefusedIntent[] {
    return this.refused;
  }

  fixedUpdate(dt: number): void {
    finite("MotionReconciler.fixedUpdate", "dt", dt, 0);
    const terrainRequest = this.terrainRequest;
    this.terrainRequest = undefined;
    if (this.yielded) {
      this.cancelAll();
      return;
    }
    if (dt <= 0) {
      this.queue.discardContinuous();
      return;
    }
    const intents = this.queue.intents;
    let result: MotionResolution | undefined;
    const resolve = () => {
      result = this.resolver(
        intents,
        { x: this.velocityX, y: this.velocityY },
        dt,
        { ...this.surface },
      );
    };
    const boundary = this.context.tryResolve(ErrorBoundaryKey);
    if (boundary)
      boundary.wrapCallback(resolve, {
        kind: "Character motion resolver",
        entity: this.entity.name,
        scene: this.scene.name,
      });
    else resolve();
    if (!result)
      throw new Error(
        "MotionReconciler: resolver must return a MotionResolution synchronously",
      );
    const resolved = result;
    finite("MotionReconciler", "resolved.x", resolved.x);
    finite("MotionReconciler", "resolved.y", resolved.y);
    if (
      intents.some(
        (intent) =>
          intent.frame === "launch" &&
          !resolved.refused.some(
            (refused) =>
              refused.source === intent.source && refused.axis === intent.axis,
          ),
      )
    )
      this.launchSupportY = Math.min(this.surface.y, 0);
    this.applied = { x: this.surface.x, y: this.surface.y };
    this.queue.resolved();
    this.refused = resolved.refused;
    // Every winning move axis must permit ground following. A jump's vertical
    // claim therefore refuses correction even if a dash still owns horizontal.
    const owner = intents.find(
      (intent) =>
        intent.priority > CHARACTER_CONTROLLER_PRIORITY &&
        !resolved.refused.some(
          (refused) =>
            refused.source === intent.source && refused.axis === intent.axis,
        ) &&
        !(intent.terrain === "grounded" && terrainRequest?.grounded),
    );
    const refusedTerrain = owner !== undefined;
    if (terrainRequest && owner)
      this.refused = [
        ...this.refused,
        { source: "terrain", axis: owner.axis, outrankedBy: owner.source },
      ];
    const assisted =
      this.terrain && terrainRequest && dt > 0 && !refusedTerrain
        ? this.terrain.correct(
            {
              ...terrainRequest,
              direction: intents.some((intent) => intent.terrain === "grounded")
                ? Math.sign(resolved.x - this.surface.x)
                : terrainRequest.direction,
            },
            { x: resolved.x - this.surface.x, y: resolved.y - this.surface.y },
            dt,
          )
        : undefined;
    if (assisted?.offset) {
      this.body.setPosition(
        this.body.positionX + assisted.offset.x,
        this.body.positionY + assisted.offset.y,
      );
    }
    this.body.setVelocity(
      assisted
        ? {
            x: assisted.velocity.x + this.surface.x,
            y: assisted.velocity.y + this.surface.y,
          }
        : { x: resolved.x, y: resolved.y },
    );
  }

  serialize(): {
    velocityX: number;
    velocityY: number;
    refused: readonly RefusedIntent[];
  } {
    return {
      velocityX: this.velocityX,
      velocityY: this.velocityY,
      refused: this.refused,
    };
  }
}
