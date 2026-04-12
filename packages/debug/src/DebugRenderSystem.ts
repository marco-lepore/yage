import { System, Phase } from "@yagejs/core";
import type { Container } from "pixi.js";
import type { DebugRegistryImpl } from "./DebugRegistryImpl.js";
import type { GraphicsPool } from "./GraphicsPool.js";
import type { TextPool } from "./TextPool.js";
import type { WorldDebugApiImpl } from "./WorldDebugApiImpl.js";
import type { HudDebugApiImpl } from "./HudDebugApiImpl.js";
import type { StatsStore } from "./StatsStore.js";

/** Renders all debug contributors. Runs after DisplaySystem in the Render phase. */
export class DebugRenderSystem extends System {
  readonly phase = Phase.Render;
  readonly priority = 9999;

  constructor(
    private readonly registry: DebugRegistryImpl,
    private readonly graphicsPool: GraphicsPool,
    private readonly textPool: TextPool,
    private readonly worldApi: WorldDebugApiImpl,
    private readonly hudApi: HudDebugApiImpl,
    private readonly stats: StatsStore,
    private readonly worldContainer: Container,
    private readonly hudContainer: Container,
  ) {
    super();
  }

  update(dt: number): void {
    if (!this.registry.enabled) {
      this.worldContainer.visible = false;
      this.hudContainer.visible = false;
      return;
    }

    this.worldContainer.visible = true;
    this.hudContainer.visible = true;
    this.graphicsPool.resetFrame();
    this.textPool.resetFrame();

    for (const [name, contributor] of this.registry.contributors) {
      contributor.sample?.(this.stats, dt);

      if (contributor.drawWorld) {
        this.worldApi.setContributor(name);
        contributor.drawWorld(this.worldApi);
      }

      if (contributor.drawHud) {
        this.hudApi.setContributor(name);
        contributor.drawHud(this.hudApi);
      }
    }
  }
}
