/** The object a Capacitor app injects into every page it loads. */
interface InjectedCapacitor {
  isNativePlatform?: () => boolean;
}

/**
 * Whether the page runs inside a Capacitor app on a device or simulator. A
 * game that ships one bundle for every target reads this before it imports
 * the rest of the package.
 */
export function isCapacitorHost(): boolean {
  const capacitor = (globalThis as { Capacitor?: InjectedCapacitor }).Capacitor;
  if (typeof capacitor?.isNativePlatform !== "function") return false;
  return capacitor.isNativePlatform() === true;
}
