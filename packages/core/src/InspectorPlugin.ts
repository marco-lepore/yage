import { EngineKey, InspectorKey } from "./EngineContext.js";
import type { EngineContext } from "./EngineContext.js";
import { Inspector } from "./Inspector.js";
import { SceneHookRegistryKey } from "./SceneHooks.js";
import type { Plugin } from "./types.js";

/**
 * Install an {@link Inspector} on the engine that owns `context`, and return
 * the function that removes it again.
 *
 * The installer registers the Inspector under {@link InspectorKey}, records
 * each scene's events while the event log is on, and expires
 * `events.waitFor` deadlines at the end of every frame. With `debug: true`,
 * `window.__yage__.inspector` reads it.
 *
 * When an Inspector is already registered, nothing is installed and the
 * returned function does nothing: the installer that created it removes it.
 * `DebugPlugin` and {@link InspectorPlugin} both go through here, so an engine
 * that uses both gets one Inspector whichever installs first.
 */
export function installInspector(context: EngineContext): () => void {
  if (context.has(InspectorKey)) return () => undefined;

  const engine = context.resolve(EngineKey);
  const inspector = new Inspector(engine);
  context.register(InspectorKey, inspector);

  const unregisterHooks = context.resolve(SceneHookRegistryKey).register({
    beforeEnter: (scene) => inspector.attachSceneEventObserver(scene),
    afterExit: (scene) => inspector.detachSceneEventObserver(scene),
  });
  const stopObserving = engine._observeFrameEnd(() =>
    inspector._completeFrame(),
  );

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    stopObserving();
    unregisterHooks();
    inspector.dispose();
    context.unregister(InspectorKey);
  };
}

/**
 * Installs an {@link Inspector}, reachable through
 * `context.resolve(InspectorKey)` and, with `debug: true`, as
 * `window.__yage__.inspector`.
 *
 * `DebugPlugin` installs one too, so an engine with `DebugPlugin` does not
 * need this plugin. Use it for an Inspector without the debug overlay: a
 * headless test, a tool, or a build that has no renderer.
 */
export class InspectorPlugin implements Plugin {
  readonly name = "inspector";
  readonly version = "1.0.0";

  private uninstall: (() => void) | undefined;

  install(context: EngineContext): void {
    this.uninstall = installInspector(context);
  }

  onDestroy(): void {
    this.uninstall?.();
    this.uninstall = undefined;
  }
}
