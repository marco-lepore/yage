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
   * Sum every behavior's contribution weighted by `behavior.weight`, then
   * clamp the result to `agent.maxSpeed`. Zero behaviors, or all returning
   * ZERO, yields ZERO.
   */
  compute(agent: AgentState, dt: number): Vec2 {
    let sum: Vec2 = Vec2.ZERO;
    for (const behavior of this.behaviors) {
      sum = sum.add(behavior.evaluate(agent, dt).scale(behavior.weight));
    }
    return clampMagnitude(sum, agent.maxSpeed);
  }
}
