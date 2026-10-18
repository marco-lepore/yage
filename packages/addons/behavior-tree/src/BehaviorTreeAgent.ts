import { Component, ErrorBoundaryKey } from "@yagejs/core";
import type { ProcessClock } from "@yagejs/core";
import type { BehaviorTree } from "./core/BehaviorTree.js";
import type { BehaviorInspection, BehaviorNodeStatus } from "./core/types.js";

export interface BehaviorTreeAgentOptions {
  /** Default fixed: decisions precede sibling steering on the same fixed step. */
  readonly clock?: ProcessClock;
}

/** Entity-owned tree. Disable cancels work; re-enable starts from the root. */
export class BehaviorTreeAgent<C> extends Component {
  static updatePriority = -10;
  static inspectExclude = ["tree"];
  readonly clock: ProcessClock;

  constructor(
    readonly tree: BehaviorTree<C>,
    options: BehaviorTreeAgentOptions = {},
  ) {
    super();
    this.clock = options.clock ?? "fixed";
    if (this.clock !== "fixed" && this.clock !== "frame")
      throw new Error(`BehaviorTreeAgent: unknown clock ${String(this.clock)}`);
  }

  get status(): BehaviorNodeStatus {
    return this.tree.status;
  }
  get execution(): BehaviorInspection {
    return this.tree.inspect();
  }

  onAdd(): void {
    this.tree.bindOwner(this, this.use(ErrorBoundaryKey), {
      entity: this.entity.name,
      scene: this.scene.name,
    });
  }

  fixedUpdate(dt: number): void {
    if (this.effectiveEnabled && this.clock === "fixed") this.tree.tick(dt);
  }

  update(dt: number): void {
    if (this.effectiveEnabled && this.clock === "frame") this.tree.tick(dt);
  }

  onDisable(): void {
    this.tree.cancel("disabled");
  }
  onDestroy(): void {
    this.tree.cancel("destroyed");
  }
}
