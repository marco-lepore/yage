import {
  Component,
  ErrorBoundaryKey,
  RandomKey,
  defineEvent,
} from "@yagejs/core";
import type {
  LootDiagnostics,
  LootModel,
  LootRandom,
  LootResult,
  LootRollOptions,
} from "./core/types.js";

/** A roll completed. Rewards are available through the component or return value. */
export const LootRolledEvent = defineEvent<{
  table: string;
  rewardCount: number;
}>("loot:rolled");

/** Optional entity host. No frame updates or durable state. */
export class LootComponent<
  T = unknown,
  C = void,
  K extends string = string,
> extends Component {
  static inspectExclude = ["model", "random", "result", "lastRoll"];
  private result: LootResult<T> | null = null;

  constructor(
    readonly model: LootModel<T, C, K>,
    private readonly random?: LootRandom,
  ) {
    super();
  }

  get tableIds(): readonly K[] {
    return this.model.tableIds;
  }
  /** Last completed roll. A failing roll leaves this reading unchanged. */
  get lastRoll(): LootResult<T> | null {
    return this.result;
  }

  /** Derived explanation that Inspector can read regardless of the item type. */
  get diagnostics(): LootDiagnostics | null {
    if (!this.result) return null;
    return Object.freeze({
      table: this.result.table,
      randomDraws: this.result.randomDraws,
      trace: this.result.trace,
      rewards: Object.freeze(
        this.result.rewards.map(({ quantity, source }) =>
          Object.freeze({ quantity, source }),
        ),
      ),
    });
  }

  roll(
    table: K,
    ...args: undefined extends C ? [context?: C] : [context: C]
  ): LootResult<T> {
    if (
      !this.entity?.tryScene ||
      !this.effectiveEnabled ||
      this.entity.isDestroyed
    )
      throw new Error(
        "LootComponent.roll: component must be attached and enabled on a live scene entity",
      );
    const options = {
      random: this.random ?? this.use(RandomKey),
      context: args[0],
      errorBoundary: this.use(ErrorBoundaryKey),
      errorContext: { entity: this.entity.name, scene: this.scene.name },
    } as LootRollOptions<C>;
    let result!: LootResult<T>;
    this.use(ErrorBoundaryKey).wrapCallback(
      () => {
        result = this.model.roll(table, options);
      },
      {
        kind: "Loot model",
        entity: this.entity.name,
        scene: this.scene.name,
        event: table,
      },
    );
    this.result = result;
    this.entity.emit(LootRolledEvent, {
      table: result.table,
      rewardCount: result.rewards.length,
    });
    return result;
  }
}
