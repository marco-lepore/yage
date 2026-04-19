import { System, Phase } from "@yagejs/core";
import type { Container } from "pixi.js";
import type { CameraComponent } from "@yagejs/renderer";
import type { DebugRegistryImpl } from "./DebugRegistryImpl.js";
import type { GraphicsPool } from "./GraphicsPool.js";
import type { TextPool } from "./TextPool.js";
import type { WorldDebugApiImpl } from "./WorldDebugApiImpl.js";
import type { HudDebugApiImpl } from "./HudDebugApiImpl.js";
import type { StatsStore } from "./StatsStore.js";

export interface DebugCameraAccessor {
  findCamera(): CameraComponent | undefined;
  viewportWidth: number;
  viewportHeight: number;
}

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
    private readonly cameraAccessor: DebugCameraAccessor,
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

    // Apply camera transform to the debug world container so that
    // world-space debug drawing (collision shapes, etc.) aligns with
    // the active scene's camera.
    this.syncWorldCamera();

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

  private syncWorldCamera(): void {
    const cam = this.cameraAccessor.findCamera();
    if (!cam) {
      this.worldContainer.position.set(0, 0);
      this.worldContainer.scale.set(1, 1);
      this.worldContainer.rotation = 0;
      return;
    }

    const vw = this.cameraAccessor.viewportWidth;
    const vh = this.cameraAccessor.viewportHeight;
    const rotatedPos = cam.effectivePosition
      .scale(cam.zoom)
      .rotate(-cam.rotation);
    this.worldContainer.position.x = vw / 2 - rotatedPos.x;
    this.worldContainer.position.y = vh / 2 - rotatedPos.y;
    this.worldContainer.scale.set(cam.zoom);
    this.worldContainer.rotation = -cam.rotation;
  }
}
