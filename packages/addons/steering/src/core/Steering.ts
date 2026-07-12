import { Vec2 } from "@yagejs/core";
import type { AgentState, SteeringBehavior } from "./types.js";
import { clampMagnitude } from "./math.js";

/**
 * Headless weighted-sum steering blend — the L1 model. Drive it directly
 * (headless / manual integration) or host it in a `SteeringAgent` Component.
 */
export class Steering {
  behaviors: SteeringBehavior[];

  constructor(behaviors: SteeringBehavior[] = []) {
    this.behaviors = behaviors;
  }

  add(behavior: SteeringBehavior): this {
    this.behaviors.push(behavior);
    return this;
  }

  remove(behavior: SteeringBehavior): this {
    const index = this.behaviors.indexOf(behavior);
    if (index !== -1) this.behaviors.splice(index, 1);
    return this;
  }

  clear(): this {
    this.behaviors.length = 0;
    return this;
  }

  /**
   * Arbitrate by priority tier, blend by weight within the tier: tiers are
   * consulted highest-first, and the first one whose weighted sum is
   * non-zero wins, clamped to `agent.maxSpeed`. Behaviors in lower tiers
   * are not evaluated on frames a higher tier wins (an overridden
   * path-follower pauses instead of advancing blind). With every behavior
   * on the default priority 0 this is a plain weighted sum. Zero behaviors,
   * or all returning ZERO, yields ZERO.
   */
  compute(agent: AgentState, dt: number): Vec2 {
    const priorities = [...new Set(this.behaviors.map((b) => b.priority))].sort(
      (a, b) => b - a,
    );
    for (const priority of priorities) {
      let sum: Vec2 = Vec2.ZERO;
      for (const behavior of this.behaviors) {
        if (behavior.priority !== priority) continue;
        sum = sum.add(behavior.evaluate(agent, dt).scale(behavior.weight));
      }
      if (sum.lengthSq() > 0) return clampMagnitude(sum, agent.maxSpeed);
    }
    return Vec2.ZERO;
  }
}
