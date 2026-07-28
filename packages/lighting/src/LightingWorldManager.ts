import type { ErrorBoundary, Scene } from "@yagejs/core";
import type { RendererPlugin } from "@yagejs/renderer";
import { LightingWorld } from "./LightingWorld.js";
import type {
  AmbientLightOptions,
  LightingRenderer,
  LightingRendererFactory,
} from "./types.js";

/** Owns every live scene's {@link LightingWorld}. */
export class LightingWorldManager {
  private readonly worlds = new Map<Scene, LightingWorld>();

  constructor(
    private readonly renderer: RendererPlugin,
    private readonly ambient: AmbientLightOptions,
    private readonly rendererFactory: LightingRendererFactory | null,
    private readonly errorBoundary?: ErrorBoundary,
  ) {}

  /** Create the scene's world and renderer, or return the existing world. */
  getOrCreateWorld(scene: Scene): LightingWorld {
    const existing = this.worlds.get(scene);
    if (existing) return existing;

    const world = new LightingWorld(scene, this.ambient, this.errorBoundary);
    const factory = this.rendererFactory;
    if (factory) {
      let backend: LightingRenderer | undefined;
      const create = (): void => {
        backend = factory({ scene, world, renderer: this.renderer });
      };
      if (this.errorBoundary) {
        this.errorBoundary.wrapCallback(create, {
          kind: "Lighting renderer factory",
          scene: scene.name,
        });
      } else {
        create();
      }
      if (!backend) {
        throw new Error(
          `Lighting renderer factory returned no renderer for scene "${scene.name}".`,
        );
      }
      world._attachRenderer(backend);
    }

    this.worlds.set(scene, world);
    return world;
  }

  /** Get a scene's world, or `undefined` before entry or after exit. */
  getWorld(scene: Scene): LightingWorld | undefined {
    return this.worlds.get(scene);
  }

  /** Iterate every live scene and lighting world. */
  getAllWorlds(): IterableIterator<[Scene, LightingWorld]> {
    return this.worlds.entries();
  }

  /** Destroy one scene's world and renderer. */
  destroyWorld(scene: Scene): void {
    const world = this.worlds.get(scene);
    if (!world) return;
    try {
      world.destroy();
    } finally {
      this.worlds.delete(scene);
    }
  }

  /** Destroy every world and renderer. */
  destroy(): void {
    let firstError: unknown;
    for (const [scene, world] of this.worlds) {
      try {
        world.destroy();
      } catch (error) {
        firstError ??= error;
      } finally {
        this.worlds.delete(scene);
      }
    }
    if (firstError !== undefined) throw firstError;
  }
}
