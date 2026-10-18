import { SpriteLightingKey } from "@yagejs/renderer/api";
import type { ErrorBoundary, Scene } from "@yagejs/core";
import type { RendererPlugin } from "@yagejs/renderer";
import { drawnBounceBlend, requestedBounceBlend } from "./LightingComposite.js";
import { LightingWorld } from "./LightingWorld.js";
import type {
  AmbientLightOptions,
  BounceLightOptions,
  LightingRenderer,
  LightingRendererFactory,
  LightingSceneDiagnostics,
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

/** One live scene's world and what it is drawn from. */
interface SceneLighting {
  readonly world: LightingWorld;
  /** The configured renderer name the scene drew with. */
  readonly renderer: string;
  /** The bounce the scene drew with, or `null` when nothing draws it. */
  readonly bounce: BounceLightOptions | null;
}

/** Owns every live scene's {@link LightingWorld}. */
export class LightingWorldManager {
  private readonly worlds = new Map<Scene, SceneLighting>();

  constructor(
    private readonly renderer: RendererPlugin,
    private readonly options: LightingWorldManagerOptions,
  ) {}

  /** Create the scene's world and renderer, or return the existing world. */
  getOrCreateWorld(scene: Scene): LightingWorld {
    const existing = this.worlds.get(scene);
    if (existing) return existing.world;

    const errorBoundary = this.options.errorBoundary;
    const world = new LightingWorld(scene, this.options.ambient, errorBoundary);
    const { name, factory } = this.resolveFactory(scene);
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
      if (!scene.tryResolveScoped(SpriteLightingKey))
        scene.registerScoped(SpriteLightingKey, { kind: "composite" });
      world._attachRenderer(backend);
    }

    this.worlds.set(scene, {
      world,
      renderer: name,
      // A scene no renderer draws has no bounce to report.
      bounce: factory ? bounce : null,
    });
    return world;
  }

  /** @internal One entry per live scene, oldest first. */
  _describe(): LightingSceneDiagnostics[] {
    const entries: LightingSceneDiagnostics[] = [];
    for (const [scene, lighting] of this.worlds) {
      const bounce = lighting.bounce;
      const requested = bounce ? requestedBounceBlend(bounce) : null;
      entries.push({
        scene: scene.name,
        renderer: lighting.renderer,
        fallback: lighting.world._fallbackRecord,
        bounce:
          requested === null
            ? null
            : {
                requested,
                // A renderer that draws its own composite reports the blend
                // it set; one that draws the bounce another way is read from
                // the context the renderer draws with.
                drawn:
                  lighting.world._bounceBlend ??
                  drawnBounceBlend(requested, this.renderer.capabilities),
              },
      });
    }
    return entries;
  }

  /**
   * @internal Read the bounce blend again in every live scene, after a lost
   * graphics context was replaced by one that may blend differently.
   */
  _followGraphicsContext(): void {
    for (const lighting of this.worlds.values()) {
      lighting.world._followGraphicsContext();
    }
  }

  /** Get a scene's world, or `undefined` before entry or after exit. */
  getWorld(scene: Scene): LightingWorld | undefined {
    return this.worlds.get(scene)?.world;
  }

  /** Iterate every live scene and lighting world. */
  *getAllWorlds(): IterableIterator<[Scene, LightingWorld]> {
    for (const [scene, lighting] of this.worlds) yield [scene, lighting.world];
  }

  /** Destroy one scene's world and renderer. */
  destroyWorld(scene: Scene): void {
    const lighting = this.worlds.get(scene);
    if (!lighting) return;
    try {
      lighting.world.destroy();
    } finally {
      this.worlds.delete(scene);
    }
  }

  /** Destroy every world and renderer. */
  destroy(): void {
    let firstError: unknown;
    for (const [scene, lighting] of this.worlds) {
      try {
        lighting.world.destroy();
      } catch (error) {
        firstError ??= error;
      } finally {
        this.worlds.delete(scene);
      }
    }
    if (firstError !== undefined) throw firstError;
  }

  /** The factory the scene names, or the configured default, and its name. */
  private resolveFactory(scene: Scene): {
    readonly name: string;
    readonly factory: LightingRendererFactory | null;
  } {
    const { renderers, defaultRenderer } = this.options;
    const name = scene.lighting?.renderer ?? defaultRenderer;
    if (!Object.hasOwn(renderers, name)) {
      throw new Error(
        `Scene "${scene.name}" asks for lighting renderer "${name}", which is ` +
          `not configured. Configured renderers: ${describeNames(renderers)}.`,
      );
    }
    return { name, factory: renderers[name] ?? null };
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
