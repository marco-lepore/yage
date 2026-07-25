import { devWarn, isDev } from "@yagejs/core";

const RENDERER_INSTANCE_KEY = Symbol.for("@yagejs/renderer/module-instance");
const MODULE_INSTANCE = {};

interface RendererInstanceRegistration {
  instance: object;
  warned: boolean;
}

type RendererGlobal = typeof globalThis & {
  [RENDERER_INSTANCE_KEY]?: RendererInstanceRegistration;
};

/**
 * Register one renderer module identity on a global-like object.
 *
 * Kept separate from the module side effect so the duplicate-copy behavior
 * can be tested without loading a second physical package tree.
 *
 * @internal
 */
export function registerRendererModule(
  host: RendererGlobal,
  instance: object,
  warn: (message: string) => void,
): void {
  const registered = host[RENDERER_INSTANCE_KEY];
  if (!registered) {
    host[RENDERER_INSTANCE_KEY] = { instance, warned: false };
    return;
  }
  if (registered.instance === instance || registered.warned) return;

  registered.warned = true;
  warn(
    "Multiple copies of @yagejs/renderer are loaded. This can break " +
      "instance checks and surface unrelated Pixi errors. Deduplicate " +
      "@yagejs/renderer and pixi.js, and make sure addons declare them as " +
      "peer dependencies.",
  );
}

if (isDev()) {
  registerRendererModule(
    globalThis as RendererGlobal,
    MODULE_INSTANCE,
    devWarn,
  );
}
