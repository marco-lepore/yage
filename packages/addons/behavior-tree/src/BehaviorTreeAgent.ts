import { Component, ErrorBoundaryKey, RandomKey } from "@yagejs/core";
import type { ProcessClock } from "@yagejs/core";
import { BehaviorTree } from "./core/BehaviorTree.js";
import type {
  BehaviorInspection,
  BehaviorNode,
  BehaviorNodeStatus,
  BehaviorTreeOptions,
} from "./core/types.js";

export interface BehaviorTreeAgentOptions extends Pick<
  BehaviorTreeOptions,
  "historyLimit" | "random"
> {
  /** Default fixed: decisions precede sibling steering on the same fixed step. */
  readonly clock?: ProcessClock;
}

/**
 * Runs one entity's execution of a shared definition. Random nodes use the
 * scene's generator unless `random` is passed. Disable cancels work;
 * re-enable starts from the root.
 */
export class BehaviorTreeAgent<C> extends Component {
  static updatePriority = -10;
  static inspectExclude = ["definition", "treeContext", "treeOptions"];
  readonly clock: ProcessClock;
  private readonly treeOptions: Pick<
    BehaviorTreeOptions,
    "historyLimit" | "random"
  >;
  private runner: BehaviorTree<C> | undefined;

  constructor(
    private readonly definition: BehaviorNode<C>,
    private readonly treeContext: C,
    options: BehaviorTreeAgentOptions = {},
  ) {
    super();
    const { clock = "fixed", ...treeOptions } = options;
    this.clock = clock;
    this.treeOptions = treeOptions;
  }

  /** This entity's runner: inspect, cancel, snapshot or restore it. */
  get tree(): BehaviorTree<C> {
    if (!this.runner)
      throw new Error(
        "BehaviorTreeAgent.tree: add the agent to an entity first",
      );
    return this.runner;
  }

  get status(): BehaviorNodeStatus {
    return this.tree.status;
  }
  get execution(): BehaviorInspection {
    return this.tree.inspect();
  }

  onAdd(): void {
    const random = this.use(RandomKey);
    this.runner = new BehaviorTree(this.definition, this.treeContext, {
      random: () => random.float(),
      ...this.treeOptions,
      errorBoundary: this.use(ErrorBoundaryKey),
      owner: { entity: this.entity.name, scene: this.scene.name },
    });
  }

  fixedUpdate(dt: number): void {
    if (this.clock === "fixed") this.tree.tick(dt);
  }

  update(dt: number): void {
    if (this.clock === "frame") this.tree.tick(dt);
  }

  onDisable(): void {
    this.tree.cancel("disabled");
  }
}
