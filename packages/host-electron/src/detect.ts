/**
 * Whether the page runs in a shell that loaded the @yagejs/host-electron
 * preload script. A game that ships one bundle for every target reads this
 * before it imports the rest of the package.
 * @experimental
 */
export function isElectronHost(): boolean {
  const exposed: unknown = (globalThis as { __yageHost__?: unknown })
    .__yageHost__;
  return exposed !== undefined && exposed !== null;
}
