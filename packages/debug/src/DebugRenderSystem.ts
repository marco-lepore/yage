import { System, Phase, ErrorBoundaryKey } from "@yagejs/core";
import type { EngineContext, ErrorBoundary } from "@yagejs/core";
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
  private boundary!: ErrorBoundary;

  onRegister(context: EngineContext): void {
    this.boundary = context.resolve(ErrorBoundaryKey);
  }

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
    this.worldApi.prepareFrame();
    this.textPool.resetFrame();

    for (const [name, contributor] of this.registry.contributors) {
      if (contributor.sample)
        this.boundary.wrapCallback(() => contributor.sample!(this.stats, dt), {
          kind: "Debug contributor sample",
          event: name,
        });

      if (contributor.drawWorld) {
        this.worldApi.setContributor(name);
        this.boundary.wrapCallback(
          () => contributor.drawWorld!(this.worldApi),
          { kind: "Debug contributor drawWorld", event: name },
        );
      }

      if (contributor.drawHud) {
        this.hudApi.setContributor(name);
        this.boundary.wrapCallback(() => contributor.drawHud!(this.hudApi), {
          kind: "Debug contributor drawHud",
          event: name,
        });
      }
    }
  }
}
