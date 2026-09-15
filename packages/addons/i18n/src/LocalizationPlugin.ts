import {
  Component,
  ErrorBoundaryKey,
  SceneManagerKey,
  type EngineContext,
  type Plugin,
} from "@yagejs/core";
import {
  isRelocalizable,
  LocalizationKey,
  type Localization,
} from "./core/Localization.js";
import type { MessageResolver } from "./core/message.js";

/**
 * Registers a {@link Localization} under `LocalizationKey` and, on every
 * locale change, re-resolves the localized text the engine is showing: each
 * component implementing {@link Relocalizable} on every entity of every
 * scene, paused scenes and inactive entities included, so text is already
 * current when an entity is enabled. Runs synchronously inside `setLocale`,
 * so the caller sees the new language when the call returns.
 */
export class LocalizationPlugin implements Plugin {
  readonly name = "localization";
  readonly version = "0.1.0";
  private context: EngineContext | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(readonly localization: Localization) {}

  install(context: EngineContext): void {
    this.context = context;
    context.register(LocalizationKey, this.localization);
    const boundary = context.tryResolve(ErrorBoundaryKey);
    const pass = (): void => this.relocalizeAll();
    this.unsubscribe = this.localization.subscribe(() =>
      boundary
        ? boundary.wrapCallback(pass, { kind: "Localization update pass" })
        : pass(),
    );
  }

  /**
   * Re-resolve every relocalizable component on every entity in every scene. Runs on each
   * locale change; call it directly after replacing catalog contents.
   */
  relocalizeAll(): void {
    const scenes = this.context?.tryResolve(SceneManagerKey);
    if (!scenes) return;
    const resolve: MessageResolver = (message, values) =>
      this.localization.resolve(message, values);
    for (const scene of scenes.all) {
      for (const entity of scene.getEntities()) {
        for (const component of entity.getAll(Component)) {
          if (isRelocalizable(component)) component.relocalize(resolve);
        }
      }
    }
  }

  onDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.context?.unregister(LocalizationKey);
    this.context = undefined;
  }
}
