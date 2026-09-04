import { devWarn, isDev } from "./dev.js";

const CORE_INSTANCE_KEY = Symbol.for("@yagejs/core/module-instance");
const MODULE_INSTANCE = {};

interface CoreInstanceRegistration {
  instance: object;
  warned: boolean;
}

type CoreGlobal = {
  [CORE_INSTANCE_KEY]?: CoreInstanceRegistration;
};

/**
 * Register one core module identity on a global-like object.
 *
 * Kept separate from the module side effect so duplicate-copy behavior can be
 * tested without loading a second physical package tree.
 *
 * @internal
 */
export function registerCoreModule(
  host: CoreGlobal,
  instance: object,
  warn: (message: string) => void,
): void {
  const registered = host[CORE_INSTANCE_KEY];
  if (!registered) {
    host[CORE_INSTANCE_KEY] = { instance, warned: false };
    return;
  }
  if (registered.instance === instance || registered.warned) return;

  registered.warned = true;
  warn(
    "Multiple copies of @yagejs/core are loaded. This can split engine " +
      "state and break instance checks. Deduplicate @yagejs/core and make " +
      "sure packages declare it as a peer dependency.",
  );
}

if (isDev()) {
  registerCoreModule(globalThis as CoreGlobal, MODULE_INSTANCE, devWarn);
}
