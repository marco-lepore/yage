import type { ErrorBoundary, Scene } from "@yagejs/core";
import type { RendererPlugin } from "@yagejs/renderer";
import { LightingWorld } from "./LightingWorld.js";
import type {
  AmbientLightOptions,
  BounceLightOptions,
  LightingRenderer,
  LightingRendererFactory,
} from "./types.js";
import { assertBounce } from "./validation.js";

/** What a {@link LightingWorldManager} builds each scene's world from. */
export interface LightingWorldManagerOptions {
  /** Ambient light every world starts from. */
  readonly ambient: AmbientLightOptions;
  /** The renderers a scene picks from through `Scene.lighting`. */
  readonly renderers: Readonly<Record<string, LightingRendererFactory | null>>;
  /** Which entry draws a scene that names none. */
  readonly defaultRenderer: string;
  /** Bounced light for scenes that set none of their own, or `null`. */
  readonly bounce: BounceLightOptions | null;
  /** Engine error boundary, when one is installed. */
  readonly errorBoundary?: ErrorBoundary;
}

/** Owns every live scene's {@link LightingWorld}. */
export class LightingWorldManager {
  private readonly worlds = new Map<Scene, LightingWorld>();

  constructor(
    private readonly renderer: RendererPlugin,
    private readonly options: LightingWorldManagerOptions,
  ) {}

  /** Create the scene's world and renderer, or return the existing world. */
  getOrCreateWorld(scene: Scene): LightingWorld {
    const existing = this.worlds.get(scene);
    if (existing) return existing;

    const errorBoundary = this.options.errorBoundary;
    const world = new LightingWorld(scene, this.options.ambient, errorBoundary);
    const factory = this.resolveFactory(scene);
    const bounce = this.resolveBounce(scene);
    if (factory) {
      let backend: LightingRenderer | undefined;
      const create = (): void => {
        backend = factory({ scene, world, renderer: this.renderer, bounce });
      };
      if (errorBoundary) {
        errorBoundary.wrapCallback(create, {
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

  /** The factory the scene names, or the configured default. */
  private resolveFactory(scene: Scene): LightingRendererFactory | null {
    const { renderers, defaultRenderer } = this.options;
    const name = scene.lighting?.renderer ?? defaultRenderer;
    if (!Object.hasOwn(renderers, name)) {
      throw new Error(
        `Scene "${scene.name}" asks for lighting renderer "${name}", which is ` +
          `not configured. Configured renderers: ${describeNames(renderers)}.`,
      );
    }
    return renderers[name] ?? null;
  }

  /**
   * The scene's own bounce setting, or the configured default. An absent
   * property takes the default; `null` turns bounce off for this scene.
   */
  private resolveBounce(scene: Scene): BounceLightOptions | null {
    const own = scene.lighting?.bounce;
    if (own === undefined) return this.options.bounce;
    if (own !== null)
      assertBounce(own, `Scene "${scene.name}" lighting bounce`);
    return own;
  }
}

/** The configured renderer names, quoted, for an error message. */
export function describeNames(
  renderers: Readonly<Record<string, unknown>>,
): string {
  const names = Object.keys(renderers);
  if (names.length === 0) return "none";
  return names.map((name) => `"${name}"`).join(", ");
}
