import { System, Phase, QueryCacheKey } from "@yagejs/core";
import type { EngineContext, QueryResult, Scene } from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import { UIRoot } from "./UIRoot.js";
import { FloatingOverlayKey } from "./floating.js";

/**
 * Runs Yoga layout / anchor positioning for every `UIRoot`, then re-anchors
 * the scene's floating overlay (tooltips/popovers). Lives in `LateUpdate`
 * so `Transform` writes from `Phase.Update` components (e.g. `ScreenFollow`)
 * are visible, and the overlay tick runs *after* trigger layout so floats
 * read up-to-date geometry.
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
    const scenes = new Set<Scene>();
    for (const entity of this.rootQuery) {
      const root = entity.get(UIRoot);
      if (!root.enabled) continue;
      root._layoutAndAnchor();
      scenes.add(entity.scene);
    }

    if (scenes.size === 0) return;
    const viewport = this.context.resolve(RendererKey).virtualSize;
    for (const scene of scenes) {
      scene._resolveScoped(FloatingOverlayKey)?.update(viewport);
    }
  }
}
