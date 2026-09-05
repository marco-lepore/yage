import { ServiceKey } from "@yagejs/core";
import type { Scene, SceneManager } from "@yagejs/core";
import { syncCameraTransform } from "@yagejs/renderer";
import type { SceneRenderTreeProvider } from "@yagejs/renderer";
import { Container } from "pixi.js";
import { findSceneCamera, findTopmostCamera } from "./cameraSelection.js";
import type {
  WorldDebugApi,
  SceneWorldDebugApi,
  DebugGraphics,
} from "./types.js";
import type { GraphicsPool } from "./GraphicsPool.js";
import type { DebugRegistryImpl } from "./DebugRegistryImpl.js";

const DebugWorldTargetKey = new ServiceKey<Container>("debugWorldTarget", {
  scope: "scene",
});

/** One graphics pool serves visible scenes and the default camera target. */
export class WorldDebugApiImpl implements WorldDebugApi {
  private _contributorName = "";
  private readonly defaultTarget = new Container();
  private zoom = 1;

  constructor(
    private readonly pool: GraphicsPool,
    private readonly registry: DebugRegistryImpl,
    private readonly scenes: SceneManager,
    private readonly provider: SceneRenderTreeProvider,
    private readonly root: Container,
  ) {
    root.addChild(this.defaultTarget);
  }

  prepareFrame(): void {
    const defaultCamera = findTopmostCamera(
      this.scenes.all.filter(
        (scene) => this.provider.getTree(scene)?.root.visible,
      ),
    );
    for (const scene of this.scenes.all) {
      const visible = this.provider.getTree(scene)?.root.visible === true;
      const target = scene._resolveScoped(DebugWorldTargetKey);
      if (target) {
        target.visible = visible;
        this.root.addChild(target);
        if (visible) syncCameraTransform(target, findSceneCamera(scene));
      }
    }
    syncCameraTransform(this.defaultTarget, defaultCamera);
    this.zoom = defaultCamera?.effectiveZoom ?? 1;
    this.root.addChild(this.defaultTarget);
  }

  forScene(scene: Scene): SceneWorldDebugApi | undefined {
    if (
      !this.scenes.all.includes(scene) ||
      !this.provider.getTree(scene)?.root.visible
    )
      return undefined;
    let target = scene._resolveScoped(DebugWorldTargetKey);
    if (!target) {
      target = new Container();
      target.eventMode = "none";
      scene._registerScoped(DebugWorldTargetKey, target);
      this.root.addChild(target);
      this.prepareFrame();
    }
    const camera = findSceneCamera(scene);
    syncCameraTransform(target, camera);
    const container = target;
    return {
      acquireGraphics: () =>
        this.pool.acquire(container) as unknown as DebugGraphics | undefined,
      cameraZoom: camera?.effectiveZoom ?? 1,
    };
  }

  releaseScene(scene: Scene): void {
    const target = scene._resolveScoped(DebugWorldTargetKey);
    if (!target) return;
    this.pool.releaseTarget(target);
    target.destroy();
  }

  /** Set the current contributor name (called before each contributor's drawWorld). */
  setContributor(name: string): void {
    this._contributorName = name;
  }

  acquireGraphics(): DebugGraphics | undefined {
    return this.pool.acquire(this.defaultTarget) as unknown as
      | DebugGraphics
      | undefined;
  }

  isFlagEnabled(flag: string): boolean {
    return this.registry.isFlagEnabled(this._contributorName, flag);
  }

  get cameraZoom(): number {
    return this.zoom;
  }
}
