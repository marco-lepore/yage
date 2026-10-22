import {
  Component,
  ErrorBoundaryKey,
  RandomKey,
  defineEvent,
} from "@yagejs/core";
import type {
  LootModel,
  LootRandom,
  LootResult,
  LootReward,
  LootRollOptions,
} from "./core/types.js";

/**
 * A roll completed on this entity. Item values are the game's own type; the
 * event token is shared by every loot component, so they arrive as `unknown`.
 */
export const LootRolledEvent = defineEvent<{
  table: string;
  rewards: readonly LootReward<unknown>[];
}>("loot:rolled");

export interface LootComponentOptions<
  T,
  C = unknown,
  K extends string = string,
> {
  readonly model: LootModel<T, C, K>;
  /** Default: the scene's random generator (`RandomKey`). */
  readonly random?: LootRandom;
}

/**
 * Optional entity host. No frame updates or durable state. The type
 * parameters come from the model; a component found with `entity.get` has
 * unknown items and accepts any context.
 */
export class LootComponent<
  T = unknown,
  C = unknown,
  K extends string = string,
> extends Component {
  static inspectExclude = ["model", "random", "result"];
  readonly model: LootModel<T, C, K>;
  private readonly random: LootRandom | undefined;
  private result: LootResult<T> | null = null;

  constructor(options: LootComponentOptions<T, C, K>) {
    super();
    this.model = options.model;
    this.random = options.random;
  }

  /** Last completed roll. A failing roll leaves this reading unchanged. */
  get lastRoll(): LootResult<T> | null {
    return this.result;
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
      rewards: result.rewards,
    });
    return result;
  }
}
