import { ErrorBoundaryKey, SceneHookRegistryKey } from "@yagejs/core";
import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import { LightingSystem } from "./LightingSystem.js";
import { LightingWorldManager, describeNames } from "./LightingWorldManager.js";
import { overlayLighting } from "./OverlayLightingRenderer.js";
import { LightingWorldKey, LightingWorldManagerKey } from "./types.js";
import type { LightingConfig, LightingRendererFactory } from "./types.js";
import { assertBounce } from "./validation.js";

/** Name the built-in overlay is registered under when nothing replaces it. */
const DEFAULT_RENDERER_NAME = "overlay";

/** Installs per-scene lighting worlds and the render-phase lighting system. */
export class LightingPlugin implements Plugin {
  readonly name = "lighting";
  readonly version = "1.0.0";
  readonly dependencies = ["renderer"] as const;

  private readonly config: LightingConfig;
  private manager: LightingWorldManager | undefined;
  private unregisterHooks: (() => void) | null = null;

  constructor(config: LightingConfig = {}) {
    this.config = config;
  }

  install(context: EngineContext): void {
    const renderer = context.resolve(RendererKey);
    const configured = this.config.renderers;
    const renderers: Readonly<Record<string, LightingRendererFactory | null>> =
      configured ?? { [DEFAULT_RENDERER_NAME]: overlayLighting() };
    const defaultRenderer = resolveDefaultRenderer(
      this.config.defaultRenderer,
      configured !== undefined,
      renderers,
    );
    const bounce = this.config.bounce ?? null;
    if (bounce) assertBounce(bounce, "LightingPlugin bounce");
    const errorBoundary = context.tryResolve(ErrorBoundaryKey);
    const manager = new LightingWorldManager(renderer, {
      ambient: this.config.ambient ?? {},
      renderers,
      defaultRenderer,
      bounce,
      ...(errorBoundary !== undefined ? { errorBoundary } : undefined),
    });
    this.manager = manager;
    context.register(LightingWorldManagerKey, manager);

    const hooks = context.resolve(SceneHookRegistryKey);
    this.unregisterHooks = hooks.register({
      beforeEnter: (scene) => {
        const world = manager.getOrCreateWorld(scene);
        scene.registerScoped(LightingWorldKey, world);
      },
      afterExit: (scene) => {
        manager.destroyWorld(scene);
      },
    });
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new LightingSystem());
  }

  onDestroy(): void {
    this.unregisterHooks?.();
    this.unregisterHooks = null;
    this.manager?.destroy();
    this.manager = undefined;
  }
}

/**
 * Which renderer draws a scene that names none. A game that configures its own
 * `renderers` says which of them that is; leaving the whole map out takes the
 * built-in overlay.
 */
function resolveDefaultRenderer(
  named: string | undefined,
  hasOwnRenderers: boolean,
  renderers: Readonly<Record<string, LightingRendererFactory | null>>,
): string {
  if (named === undefined) {
    if (hasOwnRenderers) {
      throw new Error(
        "LightingPlugin has its own renderers, so defaultRenderer must name " +
          `one of them: ${describeNames(renderers)}.`,
      );
    }
    return DEFAULT_RENDERER_NAME;
  }
  if (!Object.hasOwn(renderers, named)) {
    throw new Error(
      `LightingPlugin defaultRenderer "${named}" is not one of the configured ` +
        `renderers: ${describeNames(renderers)}.`,
    );
  }
  return named;
}
