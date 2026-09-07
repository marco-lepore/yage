import type { EffectHandle } from "./EffectHandle.js";

/**
 * Keys `EffectHandle` itself defines. Every other own enumerable key on a
 * handle comes from a preset's `buildExtras`.
 */
const BASE_KEYS: ReadonlySet<string> = new Set([
  "remove",
  "setEnabled",
  "enabled",
  "setIntensity",
  "fadeIn",
  "fadeOut",
  "run",
]);

/** Call `invoke` on every handle; return the first handle's result. */
function fanOut<H, R>(handles: readonly H[], invoke: (handle: H) => R): R {
  let first: R | undefined;
  for (let i = 0; i < handles.length; i++) {
    const result = invoke(handles[i]!);
    if (i === 0) first = result;
  }
  return first as R;
}

/**
 * Merge several handles for the same effect into one. Methods fan out to
 * every handle; values (`enabled`, an extra's return value) come from the
 * first. Preset extras are discovered on the first handle and fan out the
 * same way.
 *
 * Used by `SceneRenderTree.addLayerEffect`, which attaches one effect per
 * listed layer and returns a single handle for all of them.
 *
 * @internal
 */
export function fanOutHandle<H extends EffectHandle>(handles: readonly H[]): H {
  const first = handles[0];
  if (!first) throw new Error("fanOutHandle: needs at least one handle.");

  const composite: EffectHandle = {
    remove: () => {
      for (const handle of handles) handle.remove();
    },
    setEnabled: (on) => {
      for (const handle of handles) handle.setEnabled(on);
    },
    get enabled() {
      return first.enabled;
    },
    setIntensity: (value) => {
      for (const handle of handles) handle.setIntensity(value);
    },
    fadeIn: (duration) => fanOut(handles, (h) => h.fadeIn(duration)),
    fadeOut: (duration) => fanOut(handles, (h) => h.fadeOut(duration)),
    run: (process) => fanOut(handles, (h) => h.run(process)),
  };
  const extras = first as unknown as Record<string, unknown>;
  for (const key of Object.keys(extras)) {
    if (BASE_KEYS.has(key)) continue;
    // Classifying reads the key once. `buildExtras` returns plain values and
    // closures, so this is the same read a caller would make.
    if (typeof extras[key] === "function") {
      Object.defineProperty(composite, key, {
        value: (...args: unknown[]) =>
          fanOut(handles, (handle) => {
            const method = (handle as unknown as Record<string, unknown>)[key];
            return (method as (...a: unknown[]) => unknown).apply(handle, args);
          }),
        enumerable: true,
      });
    } else {
      Object.defineProperty(composite, key, {
        get: () => extras[key],
        enumerable: true,
      });
    }
  }

  return composite as H;
}
