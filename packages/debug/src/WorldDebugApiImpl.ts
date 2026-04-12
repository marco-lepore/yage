import type { WorldDebugApi, DebugGraphics } from "./types.js";
import type { GraphicsPool } from "./GraphicsPool.js";
import type { DebugRegistryImpl } from "./DebugRegistryImpl.js";

/** WorldDebugApi backed by a GraphicsPool. Contributor name is swapped per iteration. */
export class WorldDebugApiImpl implements WorldDebugApi {
  private _contributorName = "";

  constructor(
    private readonly pool: GraphicsPool,
    private readonly registry: DebugRegistryImpl,
    private readonly _camera: { zoom: number },
  ) {}

  /** Set the current contributor name (called before each contributor's drawWorld). */
  setContributor(name: string): void {
    this._contributorName = name;
  }

  acquireGraphics(): DebugGraphics | undefined {
    return this.pool.acquire() as unknown as DebugGraphics | undefined;
  }

  isFlagEnabled(flag: string): boolean {
    return this.registry.isFlagEnabled(this._contributorName, flag);
  }

  get cameraZoom(): number {
    return this._camera.zoom;
  }
}
