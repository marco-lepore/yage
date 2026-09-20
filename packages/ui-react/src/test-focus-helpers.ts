import {
  EngineContext,
  ErrorBoundary,
  ErrorBoundaryKey,
  Logger,
  LogLevel,
  Scene,
} from "@yagejs/core";
import { FloatingOverlayKey, UIFocusStackKey } from "@yagejs/ui";
import type { UIFocusStack } from "@yagejs/ui";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import { UIRoot } from "./UIRoot.js";
import type { UIRootOptions } from "./UIRoot.js";
import { UIReactPlugin, UIReactPluginKey } from "./UIReactPlugin.js";

class TestScene extends Scene {
  readonly name = "test-scene";
}

/**
 * Test helper: a `UIRoot` on an entity named `entityName`, in a scene whose
 * render layer is `layer` (a stand-in Pixi container) and whose focus stack is
 * `focusStack` when one is given. The caller destroys the root.
 */
export function mountTestUIRoot(
  layer: object,
  entityName: string,
  opts?: UIRootOptions,
  focusStack?: UIFocusStack,
): UIRoot {
  const context = new EngineContext();
  context.register(
    ErrorBoundaryKey,
    new ErrorBoundary(new Logger({ level: LogLevel.Debug })),
  );
  context.register(UIReactPluginKey, new UIReactPlugin());

  const scene = new TestScene();
  scene._setContext(context);
  scene.registerScoped(SceneRenderTreeKey, {
    tryGet: () => ({ container: layer }),
  } as never);
  scene.registerScoped(FloatingOverlayKey, {} as never);
  if (focusStack) scene.registerScoped(UIFocusStackKey, focusStack);

  return scene.spawn(entityName).add(new UIRoot(opts));
}

/** Give the keys to the scope shown most recently and run one frame. */
export function driveFocus(stack: UIFocusStack): void {
  stack._observe();
  stack._drive(null);
}
