import { System, Phase, QueryCacheKey } from "@yagejs/core";
import type { EngineContext, QueryResult } from "@yagejs/core";
import { UIRoot } from "./UIRoot.js";

/**
 * Runs Yoga layout and anchor/transform positioning for every `UIRoot`.
 * Lives in `LateUpdate` so `Transform` writes from `Phase.Update`
 * components (e.g. `ScreenFollow`) are already visible when
 * `positioning: "transform"` reads `worldPosition`.
 */
export class UIRootLayoutSystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 200;

  private rootQuery!: QueryResult;

  onRegister(context: EngineContext): void {
    const queryCache = context.resolve(QueryCacheKey);
    this.rootQuery = queryCache.register([UIRoot]);
  }

  update(): void {
    for (const entity of this.rootQuery) {
      const root = entity.get(UIRoot);
      if (!root.enabled) continue;
      root._layoutAndAnchor();
    }
  }
}
