import { System, Phase, QueryCacheKey } from "@yagejs/core";
import type { EngineContext, QueryResult } from "@yagejs/core";
import { UIRoot } from "./UIRoot.js";

/**
 * Runs Yoga layout / anchor positioning for every `UIRoot`. Lives in
 * `LateUpdate` so `Transform` writes from `Phase.Update` components (e.g.
 * `ScreenFollow`) are visible. The scene's floating overlay is re-anchored
 * separately by `@yagejs/ui`'s `FloatingOverlaySystem` (priority `201`,
 * after this system at `200`), so floats read up-to-date trigger geometry
 * whether or not a `UIRoot` is present.
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
